# Sync.audio — Upgrade Notes (v2 → v4)

## v4 "Cobalt Noir" (current)

**Theme.** Full dark redesign in the strict three-color system: black
`#000000` canvas, white `#FFFFFF` light, cobalt `#2C3480` energy (tints
`#07081A` surfaces, `#5A66D9/#8A93E8` strokes, `#C7CCF7` light text). Plus
Jakarta Sans everywhere (400–800), Geist Mono for codes/telemetry. A solid
white pill means "broadcast live" (ON AIR / LIVE); cobalt means interactive /
in-sync. Brand: the sync.Audio glitch-wordmark across headers, listener
screens, favicon and PWA icons.

**AWS Builder Challenge plane.** `src/lib/telemetry.ts` (batched bus, 3 s
flush, pagehide sendBeacon) → `POST /api/telemetry` (validation + 600-event
ring) → `AWS_TELEMETRY_URL` Lambda Function URL → DynamoDB (TTL 30 d). Events:
`session_open`, `broadcast_state`, `listeners_changed`, `drift_report`
(12 s host pulse + 10 s listener pulse), `session_join`, `audio_start`,
rebuffer edges. IaC: `aws/` (SAM, nodejs20.x, Function URL CORS, BatchWrite).
Local mode without the env var — audio never waits on AWS.

**Open Source.** MIT `LICENSE` at repo root + `"license": "MIT"` in
package.json; `FRICTION-LOG.md` (17 frictions, workarounds, platform asks +
Devpost-ready feedback appendix); root README with two-process quickstart;
`docs/SUBMISSION-CHECKLIST.md` (video storyboard, judge collaborators
knmeiss/giolaq/anishamalade/mosesroth/emersonsklar, Devpost fields).

## v3 "Auto-Sync"

**Closed-loop lip-sync (headline).** The host beams a 1 Hz `sync:beacon`
(TV playhead + relay wall-clock re-stamp). Each listener extrapolates the TV
playhead on the shared clock, probes what actually reaches the ear (worklet
playout position), and self-corrects: hold ≤ 10 ms, fade-protected
micro-nudges at 10–90 ms, instant re-lock beyond. Guards: track A only,
frames < 2.5 s fresh, beacon < 3.5 s fresh, |err| ≤ 2 s loop-wrap rejection,
manual nudges pause the loop 12 s. Result: **drift ≤ 50 ms without any manual
tuning** — surfaced as live "lip error" on the phone and per-listener drift
chips + a Worst-drift card on the host console.

**Latency/buffer hardening.** Initial jitter target 140→110 ms; transport
compression off; `startTimers` also fires on the `connect` path (previously
the stats/jitter loop could stay dormant); nudge clamp widened ±800 ms.

**One-click demo.** The host's primary button is now "▶ Play demo — go live":
one tap = demo cue + ON AIR + beacon.

## v2 (baseline for this file)

- Wire protocol v2: Int16 PCM (uplink halved to ≈ 1.56 Mbps/track), codec
  byte for future Opus.
- Capture moved to an AudioWorklet on the audio thread (1024-sample
  transferable batches ≈ 21 ms); ScriptProcessor fallback retained.
- Adaptive jitter target 70–300 ms (grows instantly, shrinks after 8 s
  stable), soft underrun recovery, device output-latency auto-skip with 1.2 s
  top-up, instant nudges, NTP-style 5-probe timesync + EMA.
- Air latency ≈ 210–260 ms → ≈ 90–160 ms (further → 80–140 ms in v3/v4).

## Verification log

- `bunx tsc --noEmit` clean · `bun run build` clean (`/api/telemetry` registered)
- Live e2e (headless): host ON AIR + AUTO-SYNC ON + relay link up; listener
  connects, LIVE state, Auto-sync card + lip-error readout present
- Headless renderer still dies during long live playout (sandbox has no audio
  device) — real-phone dress rehearsal remains on the pre-judging checklist
