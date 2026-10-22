/**
 * Sync.audio — host-side engine ("the TV")
 *
 * Captures the master audio of playing media elements through the Web Audio
 * graph (mono, 48 kHz), batches it into ~21 ms Int16 PCM frames and streams
 * them to the relay, which fans them out to every listener in the session
 * room.
 *
 * v2: capture runs in an AudioWorklet on the dedicated audio thread (immune
 * to main-thread UI jank — the #1 host-side cause of listener starvation),
 * with a ScriptProcessor fallback. Batches halved 2048→1024 samples and the
 * wire payload halved Float32→Int16, cutting air latency ~22 ms and Wi-Fi
 * airtime ~50%.
 */
import { encodeFrame } from '@/lib/sync-protocol'
import { createRelaySocket } from '@/lib/relay-socket'
import type { Socket } from 'socket.io-client'

export interface TrackMeta {
  id: string
  name: string
}

export interface ListenerRow {
  id: string
  name: string
  rtt: number | null
  bufferMs: number | null
  drift: number | null
}

export interface HostStats {
  framesSent: number
  bytesSent: number
  bitrateKbps: number
  listeners: ListenerRow[]
}

interface TrackSlot {
  id: string
  name: string
  element: HTMLMediaElement
  source: MediaElementAudioSourceNode
  capture: AudioWorkletNode | ScriptProcessorNode
  monitorGain: GainNode
  pending: Float32Array
  pendingFill: number
  seq: number
}

const BATCH_SAMPLES = 1024 // ~21 ms @ 48 kHz

export class SyncHost {
  socket: Socket | null = null
  ctx: AudioContext | null = null
  sessionCode = ''
  sampleRate = 48000
  tracks = new Map<string, TrackSlot>()
  broadcasting = false
  startedAt = 0

  private zeroGain: GainNode | null = null
  private captureModule: Promise<boolean> | null = null
  private onListenersCb: (rows: ListenerRow[]) => void = () => {}
  private onSessionCb: (info: { count: number }) => void = () => {}
  private onRelayCb: (connected: boolean) => void = () => {}
  private onWizardRequestCb: (name: string) => void = () => {}
  private bitrateWindow: { t: number; bytes: number } = { t: 0, bytes: 0 }
  private bitrateKbps = 0

  init(sessionCode: string, cbs: {
    onListeners?: (rows: ListenerRow[]) => void
    onSession?: (info: { count: number }) => void
    onRelay?: (connected: boolean) => void
    onWizardRequest?: (name: string) => void
  }) {
    this.sessionCode = sessionCode
    this.onListenersCb = cbs.onListeners || this.onListenersCb
    this.onSessionCb = cbs.onSession || this.onSessionCb
    this.onRelayCb = cbs.onRelay || this.onRelayCb
    this.onWizardRequestCb = cbs.onWizardRequest || this.onWizardRequestCb

    this.ctx = new AudioContext({ sampleRate: this.sampleRate })
    this.zeroGain = this.ctx.createGain()
    this.zeroGain.gain.value = 0
    this.zeroGain.connect(this.ctx.destination)

    // warm the capture worklet module so attachTrack can use it synchronously
    this.ensureCaptureModule()

    void createRelaySocket().then((socket) => {
      this.socket = socket
      this.bindSocket()
    }).catch((e) => console.error('relay unreachable', e))
  }

  private bindSocket() {
    const socket = this.socket
    if (!socket) return
    socket.on('connect', () => { this.onRelayCb(true); this.onConnect() })
    socket.on('disconnect', () => this.onRelayCb(false))
    socket.on('sync:listener-joined', (d: { count: number }) => this.onSessionCb({ count: d.count }))
    socket.on('sync:listener-left', (d: { count: number; id?: string }) => {
      if (d.id) { this.statsRows.delete(d.id); this.emitRows() }
      this.onSessionCb({ count: d.count })
    })
    socket.on('sync:listener-stats', (d: { id: string; rtt?: number; bufferMs?: number; drift?: number }) => {
      this.statsRows.set(d.id, { ...this.statsRows.get(d.id), ...d } as ListenerRow)
      this.emitRows()
    })
    socket.on('sync:listener-joined-full', (d: { listener: ListenerRow }) => {
      this.statsRows.set(d.listener.id, d.listener)
      this.emitRows()
    })
    socket.on('sync:wizard', (d: { kind: string; name?: string }) => {
      if (d?.kind === 'request') this.onWizardRequestCb(d.name || 'Listener')
    })
    if (socket.connected) { this.onRelayCb(true); this.onConnect() }
  }

  private onConnect() {
    this.socket?.emit('sync:join', {
      role: 'host',
      session: this.sessionCode,
      sampleRate: this.sampleRate,
    }, (resp: { ok: boolean; session?: { listeners: ListenerRow[] } }) => {
      if (resp?.ok && resp.session) {
        const rows = resp.session.listeners || []
        this.statsRows.clear()
        rows.forEach((r) => this.statsRows.set(r.id, r))
        this.emitRows()
        this.onSessionCb({ count: rows.length })
      }
    })
    this.pushTracks()
    if (this.broadcasting) this.socket?.emit('sync:state', { state: 'playing' })
  }

  private statsRows = new Map<string, ListenerRow>()
  private emitRows() {
    this.onListenersCb(Array.from(this.statsRows.values()))
  }

  private ensureCaptureModule(): Promise<boolean> {
    if (!this.captureModule) {
      this.captureModule = this.ctx!.audioWorklet
        .addModule('/worklets/capture-worklet.js')
        .then(() => true)
        .catch(() => false)
    }
    return this.captureModule
  }

  /** Attach a media element as a broadcast track. One source node per element, ever. */
  async attachTrack(id: string, name: string, element: HTMLMediaElement) {
    if (!this.ctx || !this.zeroGain) return
    if (this.tracks.has(id)) {
      this.pushTracks()
      return
    }
    const source = this.ctx.createMediaElementSource(element)
    // force a mono downmix so every listener gets an identical stream
    source.channelCount = 1
    source.channelCountMode = 'explicit'
    source.channelInterpretation = 'speakers'

    const monitorGain = this.ctx.createGain()
    monitorGain.gain.value = 0
    source.connect(monitorGain)
    monitorGain.connect(this.ctx.destination)

    const slot: TrackSlot = {
      id, name, element, source, monitorGain,
      capture: null as unknown as AudioWorkletNode | ScriptProcessorNode,
      pending: new Float32Array(BATCH_SAMPLES),
      pendingFill: 0,
      seq: 0,
    }

    // Preferred: audio-thread capture (glitch-free under UI load).
    let capture: AudioWorkletNode | ScriptProcessorNode | null = null
    if (await this.ensureCaptureModule()) {
      try {
        const node = new AudioWorkletNode(this.ctx, 'sync-capture', {
          numberOfInputs: 1,
          numberOfOutputs: 0,
          channelCount: 1,
          channelCountMode: 'explicit',
          processorOptions: { batch: BATCH_SAMPLES },
        })
        node.port.onmessage = (e) => this.ingest(slot, e.data as Float32Array)
        source.connect(node)
        capture = node
      } catch { /* fall through to ScriptProcessor */ }
    }
    // Fallback: main-thread ScriptProcessor (old WebViews / headless CI).
    if (!capture) {
      const sp = this.ctx.createScriptProcessor(BATCH_SAMPLES / 2, 1, 1)
      sp.onaudioprocess = (ev) => this.ingest(slot, ev.inputBuffer.getChannelData(0))
      source.connect(sp)
      sp.connect(this.zeroGain)
      capture = sp
    }
    slot.capture = capture

    this.tracks.set(id, slot)
    this.pushTracks()
  }

  /** Accumulate captured samples into BATCH_SAMPLES frames and ship them. */
  private ingest(slot: TrackSlot, input: Float32Array) {
    if (!this.broadcasting) return
    let copied = 0
    while (copied < input.length) {
      const room = BATCH_SAMPLES - slot.pendingFill
      const take = Math.min(room, input.length - copied)
      slot.pending.set(input.subarray(copied, copied + take), slot.pendingFill)
      slot.pendingFill += take
      copied += take
      if (slot.pendingFill === BATCH_SAMPLES) {
        this.flushBatch(slot)
      }
    }
  }

  setTrackName(id: string, name: string) {
    const t = this.tracks.get(id)
    if (t) t.name = name
    this.pushTracks()
  }

  private pushTracks() {
    const list: TrackMeta[] = []
    this.tracks.forEach((t, id) => list.push({ id, name: t.name }))
    this.socket?.emit('sync:tracks', { tracks: list })
  }

  private flushBatch(slot: TrackSlot) {
    if (!this.socket) return
    // media-timeline position of the FIRST sample in this batch: the element's
    // playhead minus the batch duration. Audio and video share this timeline,
    // which is what lets listeners auto-align lips without any clock math.
    const el = slot.element.currentTime
    const mediaTsMs = Number.isFinite(el) && el > 0
      ? Math.max(0, el * 1000 - (BATCH_SAMPLES / this.sampleRate) * 1000)
      : 0
    const frame = encodeFrame({
      track: Number(slot.id),
      seq: slot.seq++,
      tsMs: performance.now(),
      sampleRate: this.sampleRate,
      mediaTsMs,
      samples: slot.pending.slice(),
    })
    this.socket.emit('sync:audio', frame)
    slot.pendingFill = 0
    // rough bitrate estimate (EMA)
    const now = performance.now()
    this.bitrateWindow.bytes += frame.byteLength
    if (!this.bitrateWindow.t) this.bitrateWindow.t = now
    const dt = now - this.bitrateWindow.t
    if (dt > 1000) {
      const inst = (this.bitrateWindow.bytes * 8) / (dt / 1000) / 1000
      this.bitrateKbps = this.bitrateKbps ? this.bitrateKbps * 0.7 + inst * 0.3 : inst
      this.bitrateWindow = { t: now, bytes: 0 }
    }
  }

  getStats(): HostStats {
    let frames = 0, bytes = 0
    this.tracks.forEach((t) => { frames += t.seq; bytes += t.seq * (24 + BATCH_SAMPLES * 2) })
    return {
      framesSent: frames,
      bytesSent: bytes,
      bitrateKbps: this.bitrateKbps,
      listeners: Array.from(this.statsRows.values()),
    }
  }

  setMonitor(enabled: boolean) {
    this.tracks.forEach((t) => {
      if (t.monitorGain.gain.value !== (enabled ? 1 : 0)) {
        t.monitorGain.gain.value = enabled ? 1 : 0
      }
    })
  }

  /** Media-timeline position (ms) of the visible track's playhead right now. */
  getVisibleMediaTime(): number | null {
    const t = this.tracks.get('0')
    if (!t) return null
    const el = t.element.currentTime
    return Number.isFinite(el) && el > 0 ? el * 1000 : null
  }

  async start() {
    if (!this.ctx) return
    await this.ctx.resume()
    const elements: HTMLMediaElement[] = []
    this.tracks.forEach((t) => elements.push(t.element))
    try { await Promise.all(elements.map((el) => el.play())) } catch { /* gesture */ }
    this.tracks.forEach((t) => { t.seq = 0; t.pendingFill = 0 })
    this.broadcasting = true
    this.startedAt = Date.now()
    this.socket?.emit('sync:state', { state: 'playing' })
    this.requestWakeLock()
  }

  pause() {
    this.tracks.forEach((t) => t.element.pause())
    this.broadcasting = false
    this.socket?.emit('sync:state', { state: 'paused' })
  }

  stop() {
    this.tracks.forEach((t) => {
      t.element.pause()
      try { t.element.currentTime = 0 } catch { /* */ }
    })
    this.broadcasting = false
    this.socket?.emit('sync:state', { state: 'idle' })
  }

  private wakeLock: { release: () => Promise<void> } | null = null
  private async requestWakeLock() {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }
      this.wakeLock = await nav.wakeLock?.request('screen') ?? null
    } catch { /* not supported */ }
  }

  destroy() {
    this.stop()
    try { this.wakeLock?.release() } catch { /* */ }
    this.socket?.disconnect()
    this.tracks.forEach((t) => { try { t.capture.disconnect() } catch { /* */ }; t.source.disconnect() })
    this.tracks.clear()
    this.ctx?.close()
  }
}
