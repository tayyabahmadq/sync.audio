/**
 * Sync.audio — listener-side engine ("the earbud receiver")
 *
 * Joins a session over the relay, then:
 *  1. runs an NTP-style clock sync against the relay (offset + RTT display)
 *  2. receives binary PCM frames and feeds the AudioWorklet jitter buffer
 *  3. reports buffer health back to the host console
 */
import { decodeFrame } from '@/lib/sync-protocol'
import { createRelaySocket } from '@/lib/relay-socket'

export interface TrackMeta {
  id: string
  name: string
}

export interface ClientStatus {
  connected: boolean
  joined: boolean
  streaming: boolean
  hostState: 'idle' | 'playing' | 'paused'
  sampleRate: number
  tracks: TrackMeta[]
  rtt: number | null
  offsetMs: number | null
  bufferMs: number | null
  starving: boolean
  frames: number
  drops: number
}

export class SyncClient {
  socket: Socket | null = null
  ctx: AudioContext | null = null
  node: AudioWorkletNode | null = null
  gain: GainNode | null = null
  analyser: AnalyserNode | null = null
  sessionCode = ''
  listenerName = 'Listener'
  streamSampleRate = 48000
  currentTrack = 0
  targetMs = 160
  userOffsetMs = 0
  audioStarted = false
  private lastSeq = new Map<number, number>()
  private statsTimer: ReturnType<typeof setInterval> | null = null
  private frames = 0
  private drops = 0
  private offsetEma: number | null = null
  private rttEma: number | null = null

  onStatus: (s: Partial<ClientStatus>) => void = () => {}
  onAudioFrame: () => void = () => {}

  status(): ClientStatus {
    return {
      connected: !!this.socket?.connected,
      joined: this.joined,
      streaming: this.audioStarted && !this.starvingNow,
      hostState: this.hostState,
      sampleRate: this.streamSampleRate,
      tracks: this.tracks,
      rtt: this.rttEma,
      offsetMs: this.offsetEma,
      bufferMs: this.bufferNow,
      starving: this.starvingNow,
      frames: this.frames,
      drops: this.drops,
    }
  }

  private joined = false
  private hostState: 'idle' | 'playing' | 'paused' = 'idle'
  private tracks: TrackMeta[] = []
  private bufferNow: number | null = null
  private starvingNow = true

  connect(sessionCode: string, listenerName: string) {
    this.sessionCode = sessionCode.toUpperCase().trim()
    this.listenerName = listenerName.slice(0, 24) || 'Listener'
    void createRelaySocket().then((socket) => {
      if (this.destroyed) {
        socket.disconnect()
        return
      }
      this.socket = socket
      socket.on('connect', () => {
        this.onStatus({ connected: true })
        this.join()
      })
      socket.on('disconnect', () => this.onStatus({ connected: false, joined: false }))
      socket.on('sync:audio', (buf: ArrayBuffer) => this.handleAudio(buf))
      socket.on('sync:state', (d: { state: 'idle' | 'playing' | 'paused' }) => {
        this.hostState = d.state
        this.onStatus({ hostState: d.state })
      })
      socket.on('sync:tracks', (d: { tracks: TrackMeta[] }) => {
        this.tracks = d.tracks || []
        this.onStatus({ tracks: this.tracks })
      })
      socket.on('sync:host-gone', () => {
        this.hostState = 'idle'
        this.onStatus({ hostState: 'idle' })
      })
      if (socket.connected) {
        this.onStatus({ connected: true })
        this.join()
        this.startTimers()
      }
    }).catch((e) => {
      this.joinError = 'Could not reach the broadcast relay. Check the network.'
      this.onJoinError(this.joinError)
      console.error('relay unreachable', e)
    })
  }

  private destroyed = false
  joinError: string | null = null
  onJoinError: (msg: string) => void = () => {}

  private join() {
    this.socket?.emit('sync:join', {
      role: 'listener',
      session: this.sessionCode,
      name: this.listenerName,
    }, (resp: { ok: boolean; session?: { tracks: TrackMeta[]; state: 'idle' | 'playing' | 'paused'; sampleRate: number }; message?: string }) => {
      if (resp?.ok && resp.session) {
        this.joined = true
        this.tracks = resp.session.tracks || []
        this.hostState = resp.session.state
        this.streamSampleRate = resp.session.sampleRate || 48000
        this.onStatus({ joined: true, tracks: this.tracks, hostState: this.hostState, sampleRate: this.streamSampleRate })
      } else {
        this.onStatus({ joined: false })
        this.joinError = resp?.message || 'Could not join session'
        this.onJoinError?.(this.joinError)
      }
    })
  }

  /** Must be called from a user gesture (mobile autoplay policy). */
  async startAudio(): Promise<boolean> {
    if (this.audioStarted) return true
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    let ctx: AudioContext
    try {
      ctx = new Ctx({ sampleRate: this.streamSampleRate })
    } catch {
      ctx = new Ctx()
    }

    let ok = false
    // Headless browsers (CI / automated checks) can crash on the worklet's
    // dedicated audio thread — skip straight to the main-thread fallback there.
    const headless = typeof navigator !== 'undefined' && /HeadlessChrome/.test(navigator.userAgent)
    if (!headless) {
      try {
        ok = await this.startWorkletPath(ctx)
      } catch (e) {
        console.warn('AudioWorklet path failed, falling back', e)
        ok = false
      }
    }
    if (!ok) ok = this.startFallbackPath(ctx)
    if (!ok) {
      try { void ctx.close() } catch { /* */ }
      return false
    }

    this.ctx = ctx
    this.audioStarted = true

    // iOS: silent-switch workaround — an inaudible looping element keeps the
    // audio session in "playback" mode on some iOS versions.
    try {
      const silent = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=')
      silent.loop = true
      silent.volume = 0.01
      void silent.play().catch(() => {})
    } catch { /* best effort */ }

    try { await ctx.resume() } catch { /* */ }
    this.onStatus({ streaming: !this.starvingNow })
    return true
  }

  /** Primary path — AudioWorklet jitter buffer (audio thread, glitch-free). */
  private async startWorkletPath(ctx: AudioContext): Promise<boolean> {
    await ctx.audioWorklet.addModule('/worklets/player-worklet.js')
    const node = new AudioWorkletNode(ctx, 'sync-player', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { streamRate: this.streamSampleRate, targetMs: this.targetMs + this.userOffsetMs },
    })
    node.port.onmessage = (e) => {
      const d = e.data
      if (d?.type === 'stats') {
        this.bufferNow = d.fillMs
        this.starvingNow = !!d.starving
        this.onStatus({ bufferMs: d.fillMs, starving: !!d.starving, streaming: !d.starving })
      }
    }
    const gain = ctx.createGain()
    gain.gain.value = 1
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.75
    node.connect(gain)
    gain.connect(analyser)
    analyser.connect(ctx.destination)
    this.node = node
    this.gain = gain
    this.analyser = analyser
    return true
  }

  /**
   * Fallback path — ScriptProcessorNode jitter buffer on the main thread.
   * Same adaptive-fill algorithm as the worklet; used where AudioWorklet is
   * unavailable or unstable (very old TV WebViews, headless CI browsers).
   */
  private startFallbackPath(ctx: AudioContext): boolean {
    try {
      const rate = ctx.sampleRate
      const sp = ctx.createScriptProcessor(2048, 1, 1)
      const cap = this.streamSampleRate * 2
      const ring = new Float32Array(cap)
      let write = 0, read = 0, filled = 0, adj = 0, block = 0
      let primed = false
      const targetBase = (this.targetMs + this.userOffsetMs) / 1000 * this.streamSampleRate

      this.fallbackPush = (samples: Float32Array) => {
        const n = samples.length
        if (n >= cap) return
        if (filled + n > cap) {
          const drop = filled + n - cap
          read = (read + drop) % cap
          filled -= drop
        }
        for (let i = 0; i < n; i++) {
          ring[write] = samples[i]
          write = write + 1 === cap ? 0 : write + 1
        }
        filled += n
      }

      sp.onaudioprocess = (ev) => {
        const out = ev.outputBuffer.getChannelData(0)
        const target = targetBase
        const err = filled - target
        adj = adj * 0.995 + Math.max(-0.03, Math.min(0.03, err / (this.streamSampleRate * 3))) * 0.005
        const step = (this.streamSampleRate / rate) * (1 + adj)
        // prefill gate — start playout only at ~80% of target, rebuffer on underrun
        if (!primed) {
          if (filled >= target * 0.8) {
            primed = true
          } else {
            out.fill(0)
            this.starvingNow = true
            report()
            return
          }
        }
        if (filled < out.length * step + 16) {
          out.fill(0)
          this.starvingNow = true
          primed = false
          report()
          return
        }
        let pos = read
        for (let i = 0; i < out.length; i++) {
          const i0 = Math.floor(pos)
          const frac = pos - i0
          const a = ring[i0 % cap]
          const b = ring[(i0 + 1) % cap]
          out[i] = a + (b - a) * frac
          pos += step
        }
        const consumed = pos - read
        read = (read + consumed) % cap
        filled = Math.max(0, filled - consumed)
        this.starvingNow = false
        report()
      }
      const report = () => {
        if (++block % 23 === 0) {
          this.bufferNow = (filled / this.streamSampleRate) * 1000
          this.onStatus({ bufferMs: this.bufferNow, starving: this.starvingNow, streaming: !this.starvingNow })
        }
      }

      const gain = ctx.createGain()
      gain.gain.value = 1
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.75
      sp.connect(gain)
      gain.connect(analyser)
      analyser.connect(ctx.destination)

      this.node = null
      this.gain = gain
      this.analyser = analyser
      this.fallbackNode = sp
      return true
    } catch (e) {
      console.error('fallback audio path failed', e)
      return false
    }
  }

  private fallbackPush: ((s: Float32Array) => void) | null = null
  private fallbackNode: ScriptProcessorNode | null = null

  private handleAudio(buf: ArrayBuffer) {
    const frame = decodeFrame(buf)
    if (!frame) return
    this.frames++
    const last = this.lastSeq.get(frame.track)
    if (last != null && frame.seq > last + 1 && frame.seq - last < 50) this.drops += frame.seq - last - 1
    this.lastSeq.set(frame.track, frame.seq)
    if (frame.track !== this.currentTrack) return
    if (frame.sampleRate && frame.sampleRate !== this.streamSampleRate) {
      this.streamSampleRate = frame.sampleRate
    }
    if (this.node) {
      this.node.port.postMessage({ type: 'chunk', samples: frame.samples }, [frame.samples.buffer])
    } else if (this.fallbackPush) {
      this.fallbackPush(frame.samples)
    }
    this.onAudioFrame()
  }

  switchTrack(id: number) {
    if (id === this.currentTrack) return
    this.currentTrack = id
    this.lastSeq.clear()
    this.node?.port.postMessage({ type: 'clear' })
    this.onStatus({ streaming: false })
  }

  setVolume(v: number) {
    if (this.gain) this.gain.gain.value = v
  }

  setOffsetMs(ms: number) {
    this.userOffsetMs = ms
    this.node?.port.postMessage({ type: 'target', targetMs: this.targetMs + ms })
  }

  private startTimers() {
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.statsTimer = setInterval(() => {
      // NTP-style time sync against relay clock
      const c0 = Date.now()
      this.socket?.timeout(3000).emit('sync:timesync', { c0 }, (err: unknown, resp: { c0: number; s: number } | undefined) => {
        if (err || !resp) return
        const c3 = Date.now()
        const rtt = c3 - resp.c0
        const offset = resp.s + rtt / 2 - c3
        this.rttEma = this.rttEma == null ? rtt : this.rttEma * 0.8 + rtt * 0.2
        this.offsetEma = this.offsetEma == null ? offset : this.offsetEma * 0.8 + offset * 0.2
        this.onStatus({ rtt: Math.round(this.rttEma), offsetMs: Math.round(this.offsetEma) })
      })
      // report health to host
      this.socket?.emit('sync:stats', {
        rtt: this.rttEma != null ? Math.round(this.rttEma) : undefined,
        bufferMs: this.bufferNow != null ? Math.round(this.bufferNow) : undefined,
      })
    }, 2000)
  }

  destroy() {
    this.destroyed = true
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.statsTimer = null
    this.socket?.disconnect()
    try { this.ctx?.close() } catch { /* */ }
    this.audioStarted = false
    this.joined = false
  }
}
