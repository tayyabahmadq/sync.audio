/**
 * Sync.audio — listener-side engine ("the earbud receiver")
 *
 * Joins a session over the relay, then:
 *  1. runs an NTP-style clock sync against the relay (burst + median seeding)
 *  2. receives binary Int16 PCM frames and feeds the AudioWorklet jitter buffer
 *  3. measures network jitter and adapts the jitter target (70–300 ms)
 *  4. auto-compensates the device output latency (DAC/Bluetooth) by skipping
 *     that much audio right after prefill
 *  5. applies instant lip-sync nudges and reports buffer health to the host
 */
import { decodeFrame } from '@/lib/sync-protocol'
import { createRelaySocket } from '@/lib/relay-socket'
import type { Socket } from 'socket.io-client'

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
  jitterMs: number | null
  targetMs: number | null
  skipMs: number | null
  starving: boolean
  frames: number
  drops: number
  driftMs: number | null
  autoEngaged: boolean
  autoLocked: boolean
  autoFixedMs: number
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
  targetMs = 110 // initial jitter target; adapts 70–300 ms from measured jitter
  currentTargetMs = 110
  appliedOffsetMs = 0 // accumulated lip-sync nudges
  audioStarted = false
  private lastSeq = new Map<number, number>()
  private statsTimer: ReturnType<typeof setInterval> | null = null
  private frames = 0
  private drops = 0
  private offsetEma: number | null = null
  private rttEma: number | null = null
  private lastArrival: number | null = null
  private arrMean: number | null = null
  private jitterMs: number | null = null
  private lastStarveAt = 0
  private audioStartedAt = 0
  private skipMs = 0

  onStatus: (s: Partial<ClientStatus>) => void = () => {}
  onAudioFrame: () => void = () => {}
  onWizardFlash: (f: { mediaTsMs?: number; index?: number; total?: number; relayTs: number }) => void = () => {}

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
      jitterMs: this.jitterMs != null ? Math.round(this.jitterMs) : null,
      targetMs: Math.round(this.currentTargetMs),
      skipMs: Math.round(this.skipMs),
      starving: this.starvingNow,
      frames: this.frames,
      drops: this.drops,
      driftMs: this.driftMs,
      autoEngaged: this.autoEngaged,
      autoLocked: this.autoLocked,
      autoFixedMs: this.autoFixedMs,
    }
  }

  private joined = false
  private hostState: 'idle' | 'playing' | 'paused' = 'idle'
  private tracks: TrackMeta[] = []
  private bufferNow: number | null = null
  private starvingNow = true

  /* -------------------------------------------------- auto-sync (v3) state */
  private beacon: { mediaTsMs: number; relayTs: number } | null = null
  private driftMs: number | null = null
  private autoEngaged = false
  private autoLocked = false
  private autoFixedMs = 0
  private autoPausedUntil = 0
  private lastRelockAt = 0

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
        this.startTimers()
      })
      socket.on('disconnect', () => this.onStatus({ connected: false, joined: false }))
      socket.on('sync:audio', (buf: ArrayBuffer) => this.handleAudio(buf))
      socket.on('sync:wizard', (d: { kind: string; mediaTsMs?: number; index?: number; total?: number; relayTs?: number }) => {
        if (d?.kind === 'flash') this.onWizardFlash({ mediaTsMs: d.mediaTsMs, index: d.index, total: d.total, relayTs: d.relayTs || Date.now() })
      })
      socket.on('sync:state', (d: { state: 'idle' | 'playing' | 'paused' }) => {
        this.hostState = d.state
        this.onStatus({ hostState: d.state })
      })
      socket.on('sync:tracks', (d: { tracks: TrackMeta[] }) => {
        this.tracks = d.tracks || []
        this.onStatus({ tracks: this.tracks })
      })
      // sync beacon (v3): the host's 1 s heartbeat, re-stamped by the relay
      // with the shared wall-clock. Drives the automatic lip-sync loop below.
      socket.on('sync:beacon', (d: { mediaTsMs?: number; state?: string; relayTs?: number }) => {
        if (typeof d?.mediaTsMs === 'number' && d.mediaTsMs > 0 && typeof d.relayTs === 'number') {
          this.beacon = { mediaTsMs: d.mediaTsMs, relayTs: d.relayTs }
        }
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
        this.burstTimesync()
      } else {
        this.onStatus({ joined: false })
        this.joinError = resp?.message || 'Could not join session'
        this.onJoinError?.(this.joinError)
      }
    })
  }

  /** NTP-style burst: 5 probes, median offset — converges the clock readout instantly. */
  private burstTimesync() {
    const offsets: number[] = []
    const rtts: number[] = []
    let n = 0
    const median = (arr: number[]) => {
      const s = [...arr].sort((a, b) => a - b)
      return s[Math.floor(s.length / 2)]
    }
    const fire = () => {
      const c0 = Date.now()
      this.socket?.timeout(2500).emit('sync:timesync', { c0 }, (err: unknown, resp: { c0: number; s: number } | undefined) => {
        if (!err && resp) {
          const c3 = Date.now()
          const rtt = c3 - resp.c0
          rtts.push(rtt)
          offsets.push(resp.s + rtt / 2 - c3)
        }
        if (++n < 5) {
          setTimeout(fire, 80)
        } else if (offsets.length) {
          this.rttEma = median(rtts)
          this.offsetEma = median(offsets)
          this.onStatus({ rtt: Math.round(this.rttEma), offsetMs: Math.round(this.offsetEma) })
        }
      })
    }
    fire()
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
    this.audioStartedAt = Date.now()

    // restore a previously calibrated lip-sync nudge for this session
    const saved = SyncClient.readSavedOffset(this.sessionCode)
    if (saved) {
      this.nudgeOffsetMs(saved)
      this.onStatus({})
    }

    // Device output-latency compensation: Chrome exposes baseLatency (audio
    // HAL) and outputLatency (playout pipeline, includes some Bluetooth delay).
    // Skipping that much audio right after prefill removes it from the
    // air-latency chain; manual nudges only need to fix the residual.
    const lat = ctx as AudioContext & { baseLatency?: number; outputLatency?: number }
    this.skipMs = Math.max(0, Math.min(400, Math.round(((lat.baseLatency || 0) + (lat.outputLatency || 0)) * 1000)))
    if (this.node && this.skipMs > 0) {
      this.node.port.postMessage({ type: 'nudge', deltaMs: -this.skipMs })
      this.onStatus({ skipMs: this.skipMs })
    }
    // outputLatency often settles ~1 s after the sink wakes — top up once.
    setTimeout(() => {
      if (!this.audioStarted || !this.ctx) return
      const l2 = this.ctx as AudioContext & { baseLatency?: number; outputLatency?: number }
      const total = Math.max(0, Math.min(400, Math.round(((l2.baseLatency || 0) + (l2.outputLatency || 0)) * 1000)))
      const extra = total - this.skipMs
      if (extra > 15) {
        this.skipMs = total
        this.nudgeOffsetMs(-extra)
        this.onStatus({ skipMs: this.skipMs })
      }
    }, 1200)

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
    await ctx.audioWorklet.addModule('/worklets/player-worklet.js?v=3')
    const node = new AudioWorkletNode(ctx, 'sync-player', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { streamRate: this.streamSampleRate, targetMs: this.targetMs },
    })
    node.port.onmessage = (e) => {
      const d = e.data
      if (d?.type === 'stats') {
        this.bufferNow = d.fillMs
        this.starvingNow = !!d.starving
        if (d.starving) this.lastStarveAt = Date.now()
        if (typeof d.targetMs === 'number') this.currentTargetMs = d.targetMs
        this.onStatus({ bufferMs: d.fillMs, starving: !!d.starving, streaming: !d.starving, targetMs: Math.round(this.currentTargetMs) })
      } else if (d?.type === 'playout' && this.probeWaiters.has(d.requestId)) {
        const resolve = this.probeWaiters.get(d.requestId)!
        this.probeWaiters.delete(d.requestId)
        resolve({ mediaTsMs: d.mediaTsMs ?? null, fillMs: d.fillMs ?? 0 })
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
      // live target: adaptive updates from the main thread reach the fallback too
      let targetSamples = (this.currentTargetMs / 1000) * this.streamSampleRate
      this.fallbackTarget = (ms: number) => { targetSamples = (ms / 1000) * this.streamSampleRate }
      this.fallbackNudge = (deltaMs: number) => {
        const s = Math.round((deltaMs / 1000) * this.streamSampleRate)
        if (s < 0) { const skip = Math.min(-s, filled); read = (read + skip) % cap; filled -= skip }
        else { const back = Math.min(s, filled); read = (read - back + cap * 2) % cap; filled += back }
      }

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
        const target = targetSamples
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
  private fallbackTarget: ((ms: number) => void) | null = null
  private fallbackNudge: ((deltaMs: number) => void) | null = null

  private handleAudio(buf: ArrayBuffer) {
    const frame = decodeFrame(buf)
    if (!frame) return
    this.frames++
    // network jitter measurement: deviation of frame inter-arrival time
    const now = performance.now()
    if (this.lastArrival != null && frame.track === this.currentTrack) {
      const dt = now - this.lastArrival
      if (dt > 1 && dt < 800) {
        this.arrMean = this.arrMean == null ? dt : this.arrMean + (dt - this.arrMean) * 0.05
        const dev = Math.abs(dt - this.arrMean)
        this.jitterMs = this.jitterMs == null ? dev : this.jitterMs + (dev - this.jitterMs) * 0.12
      }
    }
    this.lastArrival = now
    const last = this.lastSeq.get(frame.track)
    if (last != null && frame.seq > last + 1 && frame.seq - last < 50) this.drops += frame.seq - last - 1
    this.lastSeq.set(frame.track, frame.seq)
    if (frame.track !== this.currentTrack) return
    if (frame.sampleRate && frame.sampleRate !== this.streamSampleRate) {
      this.streamSampleRate = frame.sampleRate
    }
    if (this.node) {
      this.node.port.postMessage({ type: 'chunk', samples: frame.samples, mediaTs: frame.mediaTsMs }, [frame.samples.buffer])
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

  /**
   * Instant lip-sync nudge. Positive = audio later; negative = audio earlier.
   * Manual nudges pause the auto-sync loop for 12 s so a human correction is
   * never immediately fought by the machine.
   */
  nudgeOffsetMs(deltaMs: number, opts?: { auto?: boolean }) {
    const d = Math.max(-800, Math.min(800, Math.round(deltaMs)))
    if (!d) return
    if (!opts?.auto) this.autoPausedUntil = Date.now() + 12_000
    this.appliedOffsetMs += d
    this.node?.port.postMessage({ type: 'nudge', deltaMs: d })
    this.fallbackNudge?.(d)
  }

  /* ------------------------------------------------- auto-sync loop (v3) */
  /**
   * Closed-loop lip-sync against the host beacon, 1 Hz:
   *  - extrapolate the TV playhead NOW on the shared relay clock
   *  - probe what the listener actually hears NOW (worklet playout position)
   *  - err = ear − picture: hold at ≤10 ms, inaudible fade-protected
   *    micro-nudges (40% of err) in the 10–90 ms band, instant re-lock beyond
   * Guards: track A only, frames < 2.5 s old, beacon < 3.5 s fresh, host
   * playing, |err| ≤ 2 s (media-loop wrap rejection), manual-nudge pause.
   */
  private autoSyncTick() {
    if (!this.audioStarted || this.destroyed) return
    const engaged =
      this.hostState === 'playing' &&
      this.currentTrack === 0 &&
      this.beacon != null && Date.now() - this.beacon.relayTs < 3500 &&
      this.lastArrival != null && performance.now() - this.lastArrival < 2500 &&
      Date.now() - this.autoPausedUntil > 0
    if (engaged !== this.autoEngaged) {
      this.autoEngaged = engaged
      if (!engaged) this.autoLocked = false
      this.onStatus({ autoEngaged: engaged, autoLocked: this.autoLocked })
    }
    if (!engaged || !this.beacon) return

    const tvNow = this.beacon.mediaTsMs + (Date.now() - this.beacon.relayTs) // media ms on TV now
    void this.probePlayout().then((probe) => {
      if (!probe || probe.mediaTsMs == null) return
      const err = probe.mediaTsMs - tvNow
      if (!Number.isFinite(err) || Math.abs(err) > 2000) return // loop wrap / junk
      this.driftMs = Math.round(err)

      const now = Date.now()
      if (Math.abs(err) <= 10) {
        if (!this.autoLocked) {
          this.autoLocked = true
          this.onStatus({ driftMs: this.driftMs, autoLocked: true })
        }
        return
      }
      this.autoLocked = false
      // after a big correction, give the ring time to settle
      if (now - this.lastRelockAt < 1200) return
      const delta = Math.abs(err) > 90 ? err : Math.round(err * 0.4) // instant re-lock vs micro-nudge
      if (!delta) return
      if (Math.abs(err) > 90) this.lastRelockAt = now
      this.autoFixedMs += Math.abs(delta)
      this.nudgeOffsetMs(delta, { auto: true })
      this.onStatus({ driftMs: this.driftMs, autoLocked: false, autoFixedMs: this.autoFixedMs })
    })
  }

  /** Media-timeline position (ms) of the audio currently reaching the ear. */
  probePlayout(): Promise<{ mediaTsMs: number | null; fillMs: number } | null> {
    if (!this.node) return Promise.resolve(null)
    const requestId = ++this.probeSeq
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.probeWaiters.delete(requestId)
        resolve(null)
      }, 400)
      this.probeWaiters.set(requestId, (r) => {
        clearTimeout(timer)
        resolve(r)
      })
      this.node!.port.postMessage({ type: 'probe', requestId })
    })
  }
  private probeSeq = 0
  private probeWaiters = new Map<number, (r: { mediaTsMs: number | null; fillMs: number }) => void>()

  /** Ask the host to run the flash sequence (listener-initiated calibration). */
  requestWizardCalibration() {
    this.socket?.emit('sync:wizard', { kind: 'request' })
  }

  static offsetKey(session: string) {
    return `sync.offset.${session.toUpperCase()}`
  }

  static readSavedOffset(session: string): number {
    try {
      const v = Number(localStorage.getItem(SyncClient.offsetKey(session)))
      return Number.isFinite(v) ? Math.max(-600, Math.min(600, v)) : 0
    } catch { return 0 }
  }

  static saveOffset(session: string, offsetMs: number) {
    try { localStorage.setItem(SyncClient.offsetKey(session), String(Math.round(offsetMs))) } catch { /* */ }
  }

  private startTimers() {
    if (this.statsTimer) clearInterval(this.statsTimer)
    // closed-loop auto lip-sync (v3): 1 Hz against the host beacon
    if (!this.autoTimer) this.autoTimer = setInterval(() => this.autoSyncTick(), 1000)
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
      // adaptive jitter target: sized from measured network jitter; shrinks
      // only after 8 s of stable playout so it never fights a real problem
      if (this.audioStarted && this.node) {
        const stableMs = Date.now() - Math.max(this.lastStarveAt, this.audioStartedAt)
        const jitter = this.jitterMs ?? 0
        const period = Math.max(5, Math.min(60, this.arrMean || 21))
        let want = Math.round(2.8 * jitter + period + 50)
        want = Math.max(70, Math.min(300, want))
        const cur = this.currentTargetMs
        if (want > cur + 5 || (want < cur - 5 && stableMs > 8000)) {
          this.currentTargetMs = want
          this.node?.port.postMessage({ type: 'target', targetMs: want })
          this.fallbackTarget?.(want)
          this.onStatus({ targetMs: want })
        }
      }
      // report health to host (incl. live lip error — the ≤ 50 ms proof)
      this.socket?.emit('sync:stats', {
        rtt: this.rttEma != null ? Math.round(this.rttEma) : undefined,
        bufferMs: this.bufferNow != null ? Math.round(this.bufferNow) : undefined,
        drift: this.driftMs != null && this.autoEngaged ? this.driftMs : undefined,
      })
    }, 2000)
  }
  private autoTimer: ReturnType<typeof setInterval> | null = null

  destroy() {
    this.destroyed = true
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.statsTimer = null
    if (this.autoTimer) clearInterval(this.autoTimer)
    this.autoTimer = null
    this.socket?.disconnect()
    try { this.ctx?.close() } catch { /* */ }
    this.audioStarted = false
    this.joined = false
  }
}
