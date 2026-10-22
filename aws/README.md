# Sync.audio — AWS telemetry plane (AWS Builder Challenge)

System events, per-listener sync telemetry and host audio metadata route
through **AWS Lambda → DynamoDB**. The schema is Bedrock-ready: land
`drift_report` items for a week and you can ask a foundation model for
session summaries, drift anomaly detection, or capacity planning.

What flows through:

| Event | From | Payload |
|---|---|---|
| `session_open` | host | session code, role |
| `broadcast_state` | host | playing / paused / idle |
| `listeners_changed` | host | connected count |
| `drift_report` | host + listener | worst lip error vs the ≤ 50 ms spec |
| `session_join` / `audio_start` | listener | session, device path (worklet/fallback) |
| rebuffer edges | listener | starvation windows |

## Deploy (one command each)

```bash
cd aws
sam build
sam deploy --guided
```

Accept the defaults; at the end SAM prints the **IngestUrl** (a Lambda
Function URL). Wire it into the app:

```bash
echo "AWS_TELEMETRY_URL=https://<id>.lambda-url.<region>.on.aws/" >> .env.local
```

Restart `npm run dev` — the host console's **aws telemetry** pill flips from
`local` to `live`, and events start landing in the `sync-audio-telemetry-*`
DynamoDB table (30-day TTL by default, set via the `TtlDays` parameter).

## Local mode (no AWS)

Without `AWS_TELEMETRY_URL` the app keeps everything in a 600-event in-memory
ring at `GET /api/telemetry` — the demo works fully offline and the pill reads
`local`. Graceful degradation is itself the talking point: the audio path
never waits on AWS.

## Inspect

```bash
curl -s https://<id>.lambda-url.<region>.on.aws/ | jq
aws dynamodb scan --table-name sync-audio-telemetry-<stack> --max-items 5
```
