/**
 * Sync.audio — telemetry ingest API (AWS Builder Challenge data plane)
 *
 * POST /api/telemetry — validate + queue system events (session_open,
 * broadcast_state, listeners_changed, drift_report, session_join,
 * audio_start, …), keep a 600-event server-side ring for GET inspection,
 * and forward the batch to the AWS_TELEMETRY_URL Lambda Function URL
 * (aws/ SAM stack → DynamoDB) when configured. Without the env var the
 * ring still works — the AWS pill on the host console reads "local".
 */
import { NextResponse } from 'next/server'

interface TelemetryEvent {
  type?: unknown
  data?: unknown
  ts?: unknown
}

const RING_MAX = 600
const ring: Array<Record<string, unknown>> = []
const AWS_URL = process.env.AWS_TELEMETRY_URL || ''

function validType(t: unknown): t is string {
  return typeof t === 'string' && /^[a-z_]{2,40}$/.test(t)
}

export async function POST(req: Request) {
  let body: { events?: TelemetryEvent[]; beacon?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'bad-json' }, { status: 400 })
  }
  const events = Array.isArray(body?.events) ? body.events.slice(0, 200) : []
  const accepted: Array<Record<string, unknown>> = []
  for (const e of events) {
    if (!e || !validType(e.type)) continue
    accepted.push({
      type: e.type,
      data: (typeof e.data === 'object' && e.data !== null ? e.data : {}) as Record<string, unknown>,
      ts: typeof e.ts === 'number' ? e.ts : Date.now(),
    })
  }
  ring.push(...accepted)
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX)

  if (AWS_URL && accepted.length) {
    try {
      // fire-and-forget — the audio path must never wait on AWS
      void fetch(AWS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'sync.audio', events: accepted }),
      }).catch(() => {})
    } catch { /* local mode */ }
  }

  return NextResponse.json({ ok: true, accepted: accepted.length, aws: !!AWS_URL })
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    aws: !!AWS_URL,
    ringSize: ring.length,
    recent: ring.slice(-40),
  })
}
