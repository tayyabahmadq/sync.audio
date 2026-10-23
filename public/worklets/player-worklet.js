/**
 * Sync.audio — AudioWorklet player v2
 *
 * Pulls PCM frames pushed from the main thread into a ring buffer and plays
 * them out with an adaptive jitter buffer:
 *  - target fill level (default ~140 ms, adapted by the main thread from
 *    measured network jitter) absorbs Wi-Fi jitter
 *  - a micro playback-rate correction (±2.5%) converges fill to target and
 *    keeps every listener phase-aligned to the shared timeline
 *  - SOFT underruns: short starves (< 350 ms) ride through with silence and
 *    resume as soon as ~30 ms is available (fade-in, no click, no re-prefill).
 *    Only long starvation triggers a full prefill re-gate.
 *  - instant `nudge`: shifts the playout point immediately (lip-sync taps feel
 *    instant instead of converging over seconds via rate correction)
 *  - `skipMs` (device output latency, measured by the main thread) is skipped
 *    right after prefill, auto-compensating DAC/Bluetooth delay
 *  - tracks the media-timeline position (video clock) of the audio currently
 *    playout-ing, and answers `probe` requests on demand — the data behind the
 *    one-tap automatic lip-sync wizard
 *  - linear-interpolation resampling if the device AudioContext runs at a
 *    different rate than the broadcast stream
 */
class SyncPlayer extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const opts = (options && options.processorOptions) || {}
    this.streamRate = opts.streamRate || 48000
    this.ring = new Float32Array(Math.ceil(this.streamRate * 2.5)) // 2.5 s capacity
    this.writeIdx = 0
    this.readIdx = 0 // float position, in stream-rate samples
    this.filled = 0
    this.targetMs = opts.targetMs != null ? opts.targetMs : 140
    this.baseTargetMs = this.targetMs // adaptive jitter target (main thread)
    this.phaseMs = 0                  // persistent lip-sync phase (nudges)
    this.skipSamples = Math.max(0, Math.round(((opts.skipMs || 0) / 1000) * this.streamRate))
    this.adj = 0            // smoothed playback-rate correction
    this.starving = true
    this.starvedAt = null   // audio-thread time when the current starvation began
    this.starveCount = 0
    this.primed = false     // prefill gate: stay silent until buffer is healthy
    this.fadeN = 0          // fade-in samples remaining (click killer)
    this.lastMediaTsEnd = 0 // media-timeline ms of the newest buffered sample
    this.blockCount = 0
    this.lastStatBlock = 0
    this.port.onmessage = (e) => this.onMessage(e.data)
  }

  onMessage(msg) {
    if (!msg) return
    if (msg.type === 'chunk' && msg.samples) {
      this.push(msg.samples, msg.mediaTs)
    } else if (msg.type === 'clear') {
      this.writeIdx = 0
      this.readIdx = 0
      this.filled = 0
      this.starving = true
      this.starvedAt = null
      this.adj = 0
      this.primed = false
      this.fadeN = 0
      this.phaseMs = 0
      this.lastMediaTsEnd = 0
    } else if (msg.type === 'target') {
      this.baseTargetMs = Math.max(40, Math.min(1000, msg.targetMs))
    } else if (msg.type === 'nudge') {
      const d = Math.max(-800, Math.min(800, msg.deltaMs || 0))
      if (d !== 0) {
        this.applyNudge(Math.round((d / 1000) * this.streamRate))
        // CRITICAL: the fill controller must not eat lip-sync corrections.
        // Move the fill anchor with the phase, or the rate corrector drains
        // the rewind back to the old target within seconds and the closed
        // loop re-nudges every beacon tick — audible as 1 Hz rhythmic ticks.
        this.phaseMs = Math.max(-1000, Math.min(1000, this.phaseMs + d))
      }
    } else if (msg.type === 'probe') {
      // media-timeline position of the sample currently reaching the ear + fill
      const mediaTs = this.lastMediaTsEnd > 0
        ? this.lastMediaTsEnd - (this.filled / this.streamRate) * 1000
        : null
      this.port.postMessage({ type: 'playout', requestId: msg.requestId, mediaTsMs: mediaTs, fillMs: (this.filled / this.streamRate) * 1000 })
    }
  }

  /** s > 0: delay playout (rewind over played audio); s < 0: skip ahead. */
  applyNudge(s) {
    const cap = this.ring.length
    if (s < 0) {
      const skip = Math.min(-s, this.filled)
      this.readIdx = (this.readIdx + skip) % cap
      this.filled -= skip
    } else {
      // rewind: only over samples that still exist in the ring
      const back = Math.min(s, this.filled, Math.floor(cap * 0.5))
      this.readIdx = (this.readIdx - back + cap * 2) % cap
      this.filled += back
    }
    this.fadeN = Math.max(this.fadeN, 128)
  }

  push(samples, mediaTs) {
    const n = samples.length
    const cap = this.ring.length
    if (n >= cap) return // absurd frame, drop
    if (typeof mediaTs === 'number' && mediaTs > 0) {
      this.lastMediaTsEnd = mediaTs + (n / this.streamRate) * 1000
    }
    // drop oldest if we would overrun
    if (this.filled + n > cap) {
      const drop = this.filled + n - cap
      this.readIdx = (this.readIdx + drop) % cap
      this.filled -= drop
    }
    let w = this.writeIdx
    for (let i = 0; i < n; i++) {
      this.ring[w] = samples[i]
      w = w + 1 === cap ? 0 : w + 1
    }
    this.writeIdx = w
    this.filled += n
  }

  process(_inputs, outputs) {
    const out = outputs[0][0]
    if (!out) return true
    const frames = out.length // 128
    // effective jitter target = adaptive base + persistent lip-sync phase
    const targetMs = Math.max(40, Math.min(1000, this.baseTargetMs + this.phaseMs))
    const target = (targetMs / 1000) * this.streamRate
    const skip = this.skipSamples

    // adaptive rate: eases fill toward target, keeps listeners phase-aligned
    const err = this.filled - target
    const inst = Math.max(-0.025, Math.min(0.025, err / (this.streamRate * 3)))
    this.adj = this.adj * 0.995 + inst * 0.005

    // resample factor: stream rate vs context rate, times drift correction
    let step = (this.streamRate / sampleRate) * (1 + this.adj)

    // prefill gate: wait for 80% of target + device-latency skip, then jump
    if (!this.primed) {
      if (this.filled >= target * 0.8 + skip) {
        this.primed = true
        if (skip > 0) {
          this.readIdx = (this.readIdx + skip) % this.ring.length
          this.filled = Math.max(0, this.filled - skip)
        }
        this.fadeN = 256
        this.starvedAt = null
      } else {
        out.fill(0)
        this.starving = true
        this.reportMaybe(frames)
        return true
      }
    }

    if (this.filled < frames * step + 16) {
      // UNDERRUN — soft recovery: silence now, resume as soon as ~30 ms lands
      // (only long starvations > 350 ms fall back to a full prefill re-gate)
      out.fill(0)
      if (!this.starving) { this.starving = true; this.starveCount++ }
      if (this.starvedAt == null) this.starvedAt = currentTime
      else if (currentTime - this.starvedAt > 0.35) this.primed = false
      this.reportMaybe(frames)
      return true
    }

    // short-starve resume gate: ~30 ms (or half the target, whichever is less)
    if (this.starving) {
      const resumeAt = Math.min(target * 0.5, 0.03 * this.streamRate) + frames * step
      if (this.filled < resumeAt) {
        out.fill(0)
        this.reportMaybe(frames)
        return true
      }
      this.starving = false
      this.starvedAt = null
      this.fadeN = 256
    }

    const cap = this.ring.length
    let pos = this.readIdx
    if (this.fadeN > 0) {
      let fadeTotal = this.fadeN
      for (let i = 0; i < frames; i++) {
        const i0 = Math.floor(pos)
        const frac = pos - i0
        const a = this.ring[i0 % cap]
        const b = this.ring[(i0 + 1) % cap]
        const s = a + (b - a) * frac
        out[i] = fadeTotal > 0 ? s * (1 - fadeTotal / 256) : s
        if (fadeTotal > 0) fadeTotal--
        pos += step
      }
      this.fadeN = fadeTotal
    } else {
      for (let i = 0; i < frames; i++) {
        const i0 = Math.floor(pos)
        const frac = pos - i0
        const a = this.ring[i0 % cap]
        const b = this.ring[(i0 + 1) % cap]
        out[i] = a + (b - a) * frac
        pos += step
      }
    }
    const consumed = pos - this.readIdx
    let ri = this.readIdx + consumed
    ri %= cap
    this.readIdx = ri
    this.filled -= consumed
    if (this.filled < 0) this.filled = 0
    this.starving = false

    this.reportMaybe(frames)
    return true
  }

  reportMaybe(frames) {
    // stats ~every 500 ms
    if (++this.blockCount - this.lastStatBlock >= Math.floor(sampleRate / frames / 2)) {
      this.lastStatBlock = this.blockCount
      this.port.postMessage({
        type: 'stats',
        fillMs: (this.filled / this.streamRate) * 1000,
        starving: this.starving,
        starveCount: this.starveCount,
        adj: this.adj,
        targetMs: Math.round(this.baseTargetMs + this.phaseMs),
        skipMs: (this.skipSamples / this.streamRate) * 1000,
        playoutMediaTs: this.lastMediaTsEnd > 0
          ? this.lastMediaTsEnd - (this.filled / this.streamRate) * 1000
          : null,
      })
    }
  }
}

registerProcessor('sync-player', SyncPlayer)
