/**
 * Sync.audio — host-side engine ("the TV")
 *
 * Captures the master audio of playing media elements through the Web Audio
 * graph (mono, 48 kHz), batches it into ~43 ms PCM frames, stamps each frame
 * with the host session clock and streams it to the relay, which fans it out
 * to every listener in the session room.
 */
import { encodeFrame } from '@/lib/sync-protocol'
import { createRelaySocket } from '@/lib/relay-socket'

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
  processor: ScriptProcessorNode
  monitorGain: GainNode
  pending: Float32Array
  pendingFill: number
  seq: number
}

const BATCH_SAMPLES = 2048 // ~43 ms @ 48 kHz

export class SyncHost {
  socket: Socket | null = null
  ctx: AudioContext | null = null
  sessionCode = ''
  sampleRate = 48000
  tracks = new Map<string, TrackSlot>()
  broadcasting = false
  startedAt = 0

  private zeroGain: GainNode | null = null
  private onListenersCb: (rows: ListenerRow[]) => void = () => {}
  private onSessionCb: (info: { count: number }) => void = () => {}
  private onRelayCb: (connected: boolean) => void = () => {}
  private bitrateWindow: { t: number; bytes: number } = { t: 0, bytes: 0 }
  private bitrateKbps = 0

  init(sessionCode: string, cbs: {
    onListeners?: (rows: ListenerRow[]) => void
    onSession?: (info: { count: number }) => void
    onRelay?: (connected: boolean) => void
  }) {
    this.sessionCode = sessionCode
    this.onListenersCb = cbs.onListeners || this.onListenersCb
    this.onSessionCb = cbs.onSession || this.onSessionCb
    this.onRelayCb = cbs.onRelay || this.onRelayCb

    this.ctx = new AudioContext({ sampleRate: this.sampleRate })
    this.zeroGain = this.ctx.createGain()
    this.zeroGain.gain.value = 0
    this.zeroGain.connect(this.ctx.destination)

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

  /** Attach a media element as a broadcast track. One source node per element, ever. */
  attachTrack(id: string, name: string, element: HTMLMediaElement) {
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

    const processor = this.ctx.createScriptProcessor(BATCH_SAMPLES / 2, 1, 1)
    const monitorGain = this.ctx.createGain()
    monitorGain.gain.value = 0
    source.connect(processor)
    source.connect(monitorGain)
    monitorGain.connect(this.ctx.destination)
    processor.connect(this.zeroGain)

    const slot: TrackSlot = {
      id, name, element, source, processor, monitorGain,
      pending: new Float32Array(BATCH_SAMPLES),
      pendingFill: 0,
      seq: 0,
    }

    processor.onaudioprocess = (ev) => {
      if (!this.broadcasting) return
      const input = ev.inputBuffer.getChannelData(0)
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

    this.tracks.set(id, slot)
    this.pushTracks()
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
    const frame = encodeFrame({
      track: Number(slot.id),
      seq: slot.seq++,
      tsMs: performance.now(),
      sampleRate: this.sampleRate,
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
    this.tracks.forEach((t) => { frames += t.seq; bytes += t.seq * (24 + BATCH_SAMPLES * 4) })
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
      // @ts-expect-error experimental API
      this.wakeLock = await navigator.wakeLock.request('screen')
    } catch { /* not supported */ }
  }

  destroy() {
    this.stop()
    try { this.wakeLock?.release() } catch { /* */ }
    this.socket?.disconnect()
    this.tracks.forEach((t) => { t.processor.disconnect(); t.source.disconnect() })
    this.tracks.clear()
    this.ctx?.close()
  }
}
