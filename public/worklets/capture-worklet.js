/**
 * Sync.audio — host capture worklet
 *
 * Runs on the dedicated audio thread: batches mono PCM into fixed-size frames
 * and posts them to the main thread. Unlike ScriptProcessorNode, this keeps
 * capturing glitch-free even while the main thread is busy re-rendering the
 * host console UI — a primary source of listener-side starvation in v1.
 */
class SyncCapture extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const opts = (options && options.processorOptions) || {}
    this.batch = opts.batch || 1024
    this.buf = new Float32Array(this.batch)
    this.fill = 0
    this.active = true
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'active') this.active = !!e.data.value
    }
  }

  process(inputs) {
    const input = inputs[0]
    if (!this.active || !input || !input[0]) return true
    const ch = input[0]
    let i = 0
    while (i < ch.length) {
      const room = this.batch - this.fill
      const take = Math.min(room, ch.length - i)
      this.buf.set(ch.subarray(i, i + take), this.fill)
      this.fill += take
      i += take
      if (this.fill === this.batch) {
        const out = this.buf.slice(0)
        this.port.postMessage(out, [out.buffer])
        this.fill = 0
      }
    }
    return true
  }
}

registerProcessor('sync-capture', SyncCapture)
