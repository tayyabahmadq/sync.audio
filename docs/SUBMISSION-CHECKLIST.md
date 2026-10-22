# Sync.audio — Devpost Submission Checklist (Fire TV track)

## 1. Track stacking (mini-challenge bonus)

| Track | What qualifies | Where it lives in the repo |
|---|---|---|
| **Fire TV (primary)** | Runs on Fire OS / Vega OS simulator or any browser host; QR-scan silent group listening | `src/` app, `mini-services/sync-service`, `public/worklets/` |
| **AWS Builder Challenge** | System events + sync telemetry + host audio metadata routed through AWS Lambda → DynamoDB; schema is Bedrock-ready | `src/lib/telemetry.ts`, `src/app/api/telemetry/route.ts`, `aws/` (SAM template + Lambda) |
| **Open Source Challenge** | MIT license | `LICENSE`, `package.json` (`"license": "MIT"`) |

AWS demo in one line: `cd aws && sam build && sam deploy --guided`, put the
output Function URL into `.env.local` as `AWS_TELEMETRY_URL=<url>` — the host
console's "aws telemetry" pill flips to **live** and events start landing in
DynamoDB. Without the env var everything still works and the pill reads
**local** (graceful degradation is itself the talking point).

## 2. Low-latency audio proof (drift ≤ 50 ms)

- The wire protocol stamps every PCM frame with the TV playhead (time-sync
  headers): 24-byte header = magic `SYNC`, version, track, codec, seq,
  `mediaTsMs` (media timeline ms), sample rate.
- While ON AIR the host beams a 1-second **sync beacon** (playhead +
  relay wall-clock stamp). Each listener extrapolates "what the TV shows
  now" on a shared clock, compares with "what reaches my ear now"
  (worklet playout probe), and closes the loop:
  - `|err| ≤ 10 ms` → hold
  - `10–90 ms` → inaudible micro-nudge (≤35 ms, fade-protected)
  - `> 90 ms` → instant jump (seek/loop recovery)
- Device output latency (DAC/Bluetooth, up to 400 ms) is auto-compensated
  right after prefill.
- **Proof on screen**: the host console shows per-listener drift
  (`+12ms / in spec`) and a **Worst drift** card against the ≤ 50 ms spec;
  the listener phone shows `lip error · spec ≤ 50 ms`. These are measured
  values, not marketing — show them live in the video.

## 3. Three-minute video storyboard (lead with the demo!)

| Time | Shot | Say / show |
|---|---|---|
| 0:00–0:08 | **Cold open on the demo** — TV playing the action cue, muted; phone scans the QR on screen | "This TV is muted. Watch the phones." |
| 0:08–0:20 | Two phones already listening; hit play on a third phone — audio locks in ~1 s | "Zero install. Scan, tap once, you're in." |
| 0:20–0:40 | Zoom on host console: ON AIR, listeners list with per-listener **drift chips in spec**, Worst-drift card | "Every phone is under 50 milliseconds of the picture — measured, not claimed. Time-sync headers plus a one-second beacon close the loop." |
| 0:40–1:00 | Lip-sync proof: slow-mo of TV flash (⚡ wizard) + phone; or side-by-side mouths on screen vs earbuds | "Drift self-corrects continuously — nudges are automatic, there is nothing for the user to tune." |
| 1:00–1:25 | Problem framing: 1 Bluetooth receiver max; dorm/sports/gym scenarios | "Smart TVs allow exactly one Bluetooth receiver. Sync.audio turns every phone into a receiver over local Wi-Fi." |
| 1:25–1:50 | Architecture: TV host → WebSocket relay → phones; AudioWorklet jitter buffer; NTP clock sync; adaptive target 70–300 ms | Keep it visual — the landing-page diagram is storyboard-ready. |
| 1:50–2:15 | AWS layer: host console pill `aws telemetry live`, cut to DynamoDB console showing `drift_report` items | "Telemetry and system events route through Lambda into DynamoDB — Bedrock-ready schema for insights." |
| 2:15–2:35 | Track switching on the phone (Track A ↔ B); upload your own file on the host | "Per-guest track selection — commentary vs crowd feed." |
| 2:35–2:50 | "MIT licensed, runs on the Fire OS simulator today — the same capture graph ports to a Vega OS app." | Show repo + LICENSE badge. |
| 2:50–3:00 | End card: `The room stays silent. Every earbud screams.` + QR to the repo | Logo on cobalt/black. |

Checklist for the shoot: good Wi-Fi, 2–3 phones charged, TV monitor checkbox
OFF (stay silent), demo cues loop so any scan timing works.
Video: https://youtu.be/0AVkqdIALVQ

## 4. Repo access for Amazon judges

Add as collaborators to the repository (Settings → Collaborators):

- `knmeiss`
- `giolaq`
- `anishamalade`
- `mosesroth`
- `emersonsklar`

Also: repo public (or visible to judges), README quickstart at top
(`bun install` → `bun run dev` → open `/?p=host`), and this file committed.

## 5. Product feedback section (mandatory) — final answers

Final, humanized, paste-ready answers live in **[FRICTION-LOG.md](../FRICTION-LOG.md)**
→ Appendix ("Amazon Developer Product Feedback"). They cover: the missing
system-audio capture API (critical ask), undocumented per-device latency and
the beacon workaround, background-audio restrictions for web hosts, debugging
parity — plus "what worked exceptionally well" (AudioWorklet, web platform
fundamentals, AWS Lambda Function URLs).

## 6. Devpost fields cheat-sheet

- **Tagline**: The room stays silent. Every earbud screams.
- **How we built it / Built with**: see the prepared copy (25 tags incl.
  nextjs, websocket, audioworklet, web-audio-api, socketio, aws-lambda,
  amazon-dynamodb, pwa, clock-synchronization, low-latency, pcm, qr-code).
- **Links**: GitHub repo (collaborators added above), live demo URL
  https://u1myc8h6uys0-d.space-z.ai/ for judging day, video
  https://youtu.be/0AVkqdIALVQ
- **Screenshots**: host console (dark, ON AIR, drift chips), listener live
  view (Auto-sync active, lip error in spec), DynamoDB telemetry table.
