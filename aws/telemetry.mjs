/**
 * Sync.audio telemetry ingest — AWS Lambda (nodejs20.x)
 *
 * Receives batches of Sync.audio system events from the app's /api/telemetry
 * route (Function URL, CORS open) and lands them in DynamoDB with a TTL:
 *   session_open · broadcast_state · listeners_changed · drift_report
 *   session_join · audio_start · rebuffer_start/end · config
 * Data covers system events, per-listener sync telemetry (worst drift vs the
 * 50 ms spec) and host audio metadata (track, codec, sample rate, bitrate) —
 * a Bedrock-ready schema for later insights (natural-language session
 * summaries, drift anomaly detection, capacity planning).
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb'

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const TABLE = process.env.TABLE_NAME || 'sync-audio-telemetry'
const TTL_DAYS = Number(process.env.TTL_DAYS || 30)

export const handler = async (event) => {
  // CORS preflight (Function URL forwards OPTIONS here in some configs)
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return respond(200, { ok: true })
  }

  let body
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body || event
  } catch {
    return respond(400, { ok: false, error: 'bad-json' })
  }

  const events = Array.isArray(body.events) ? body.events.slice(0, 200) : []
  if (!events.length) return respond(200, { ok: true, written: 0 })

  const now = Date.now()
  const expiresAt = Math.floor(now / 1000) + TTL_DAYS * 86400
  const items = events.slice(0, 25).map((e, i) => ({
    pk: `${e.type ?? 'event'}#${now}`,
    sk: now + i,
    type: String(e.type ?? 'event').slice(0, 40),
    data: e.data ?? {},
    clientTs: typeof e.ts === 'number' ? e.ts : now,
    expiresAt,
  }))

  try {
    // one batch per invocation is plenty for a hackathon-scale firehose
    await ddb.send(new BatchWriteCommand({
      RequestItems: { [TABLE]: items.map((Item) => ({ PutRequest: { Item } })) },
    }))
    return respond(200, { ok: true, written: items.length })
  } catch (err) {
    console.error('dynamo write failed', err)
    return respond(500, { ok: false, error: 'write-failed' })
  }
}

function respond(status, obj) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
      'Access-Control-Allow-Headers': 'content-type',
    },
    body: JSON.stringify(obj),
  }
}
