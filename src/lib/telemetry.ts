/**
 * Sync.audio — telemetry bus (AWS Builder Challenge layer)
 *
 * A tiny, batched event bus: UI code calls trackEvent(type, data), events
 * queue in a bounded ring, and a 3 s cadence flushes them to /api/telemetry
 * (which validates and forwards to the AWS_TELEMETRY_URL Lambda Function URL
 * when configured). pagehide uses sendBeacon so the final flush survives tab
 * close. Everything degrades to a no-op — telemetry must never break audio.
 */

export interface TelemetryEvent {
  type: string
  data: Record<string, unknown>
  ts: number
}

const QUEUE_MAX = 120
const FLUSH_MS = 3000

let queue: TelemetryEvent[] = []
let timer: ReturnType<typeof setInterval> | null = null
let started = false

function ensureStarted() {
  if (started || typeof window === 'undefined') return
  started = true
  timer = setInterval(flush, FLUSH_MS)
  // final flush on tab close — sendBeacon survives page teardown
  window.addEventListener('pagehide', () => {
    if (!queue.length) return
    try {
      const body = JSON.stringify({ events: queue.splice(0, QUEUE_MAX), beacon: true })
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/telemetry', new Blob([body], { type: 'application/json' }))
      } else {
        void fetch('/api/telemetry', { method: 'POST', body, keepalive: true })
      }
    } catch { /* best effort */ }
  })
}

export function telemetryInfo() {
  return {
    awsConfigured: false, // the server route reports the real value via GET
    queued: queue.length,
    flushMs: FLUSH_MS,
  }
}

export function trackEvent(type: string, data: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') return
  ensureStarted()
  queue.push({ type, data, ts: Date.now() })
  if (queue.length > QUEUE_MAX) queue.splice(0, queue.length - QUEUE_MAX)
}

export function flush() {
  if (!queue.length) return
  const events = queue
  queue = []
  void fetch('/api/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  }).catch(() => {
    // drop silently — telemetry is best-effort by design
  })
}
