/**
 * Sync.audio — AudioWorklet player
 *
 * Pulls PCM frames pushed from the main thread into a ring buffer and plays
 * them out with an adaptive jitter buffer:
 *  - target fill level (default ~160 ms) absorbs network jitter
 *  - a micro playback-rate correction (±3%) converges buffer fill to target,
 *    which is what keeps every listener aligned to the shared timeline
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
    this.targetMs = opts.targetMs != null ? opts.targetMs : 160
    this.adj = 0            // smoothed playback-rate correction
    this.starving = true
    this.primed = false     // prefill gate: stay silent until buffer is healthy
    this.blockCount = 0
    this.lastStatBlock = 0
    this.port.onmessage = (e) => this.onMessage(e.data)
  }

  onMessage(msg) {
    if (!msg) return
    if (msg.type === 'chunk' && msg.samples) {
      this.push(msg.samples)
    } else if (msg.type === 'clear') {
      this.writeIdx = 0
      this.readIdx = 0
      this.filled = 0
      this.starving = true
      this.adj = 0
      this.primed = false
    } else if (msg.type === 'target') {
      this.targetMs = Math.max(40, Math.min(1000, msg.targetMs))
    }
  }

  push(samples) {
    const n = samples.length
    const cap = this.ring.length
    if (n >= cap) return // absurd frame, drop
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
    const target = (this.targetMs / 1000) * this.streamRate

    // adaptive rate: eases fill toward target, keeps listeners phase-aligned
    const err = this.filled - target
    const inst = Math.max(-0.03, Math.min(0.03, err / (this.streamRate * 3)))
    this.adj = this.adj * 0.995 + inst * 0.005

    // resample factor: stream rate vs context rate, times drift correction
    let step = (this.streamRate / sampleRate) * (1 + this.adj)

    // prefill gate: don't start playout until the buffer holds ~80% of target
    if (!this.primed) {
      if (this.filled >= target * 0.8) {
        this.primed = true
      } else {
        out.fill(0)
        this.starving = true
        this.reportMaybe(frames)
        return true
      }
    }

    if (this.filled < frames * step + 16) {
      // underrun — emit silence and rebuffer
      out.fill(0)
      this.starving = true
      this.primed = false
      this.reportMaybe(frames)
      return true
    }

    const cap = this.ring.length
    let pos = this.readIdx
    for (let i = 0; i < frames; i++) {
      const i0 = Math.floor(pos)
      const frac = pos - i0
      const a = this.ring[i0 % cap]
      const b = this.ring[(i0 + 1) % cap]
      out[i] = a + (b - a) * frac
      pos += step
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
        adj: this.adj,
        targetMs: this.targetMs,
      })
    }
  }
}

registerProcessor('sync-player', SyncPlayer)
