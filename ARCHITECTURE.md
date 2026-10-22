# Sync.audio — Architecture (v4 "Cobalt Noir")

One room, one screen, zero sound. Sync.audio streams a TV's master audio over
local Wi-Fi to unlimited phones that join with a single QR scan, and keeps
every earbud lip-locked to the picture with a closed-loop sync beacon —
**drift ≤ 50 ms, measured on screen**.

```
┌─────────────────────── TV / host browser ───────────────────────┐
│  <video> ─▶ MediaElementSource ─▶ capture AudioWorklet (1024     │
│  samples ≈ 21 ms) ─▶ Int16 PCM frames + 24-byte time-sync header │
│  ▸ 1 Hz sync beacon: playhead + state  ──────────────────┐       │
└──────────────────────────────────────────────────────────┼───────┘
                                                           │ WebSocket (binary)
                                                ┌──────────▼──────────┐
                                                │  sync-service relay │
                                                │   (socket.io :3003) │
                                                │  rooms · fan-out ·  │
                                                │  timesync ack ·     │
                                                │  beacon re-stamp    │
                                                └──────────┬──────────┘
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
   phone (PWA)            phone (PWA)            phone (PWA)
   player worklet         player worklet         player worklet
   adaptive jitter        adaptive jitter        adaptive jitter
   + beacon loop          + beacon loop          + beacon loop
        ▼                      ▼                      ▼
      earbuds                earbuds                earbuds
```

## 1. Wire protocol (v2)

24-byte binary header + Int16 mono payload (codec byte 0 = Float32 reserved,
1 = Int16). Int16 halved uplink vs Float32: ≈ 1.56 Mbps per track.

| Offset | Field | Type |
|---|---|---|
| 0 | magic `'SYNC'` | 4 bytes |
| 4 | protocol version | u8 |
| 5 | track id | u8 |
| 6 | codec | u8 |
| 7 | reserved | u8 |
| 8 | seq | u32 |
| 12 | `mediaTsMs` — TV playhead of first sample | f64 |
| 20 | sample rate | u32 |

The `mediaTsMs` field is the time-sync header: audio and video share the
media element's timeline, so a frame's playhead position is unambiguous on
every device without any clock math at the media layer.

## 2. Closed-loop auto lip-sync (the beacon)

Manual calibration is banned from the default UX. The loop:

1. **Host**: while ON AIR, emit `sync:beacon {mediaTsMs, state}` every 1 s
   (the visible track's `currentTime`, captured at emit time).
2. **Relay**: re-stamp with the shared wall-clock (`relayTs`) and fan out.
   No cross-device clock assumptions beyond the relay, which every peer
   already measures via NTP-style probes (5-burst median + EMA).
3. **Listener** (1 Hz `autoSyncTick`):
   - extrapolate the TV playhead now: `tv = beacon.mediaTsMs + (now − relayTs)`
   - probe the ear: worklet `playout` answer = media-timeline position of the
     sample currently reaching the DAC (ring read position), which already
     reflects every nudge
   - `err = ear − tv`
   - guards: track A only · frames < 2.5 s old · beacon < 3.5 s fresh · host
     playing · `|err| ≤ 2 s` (media loop-wrap rejection) · manual nudges pause
     the loop 12 s
   - corrections: `|err| ≤ 10 ms` → hold, **locked** · `10–90 ms` →
     fade-protected micro-nudge (40 % of err) · `> 90 ms` → instant re-lock
     (1.2 s settle cooldown)
4. **Proof surfaces**: listener card shows live `lip error · spec ≤ 50 ms`;
   host console shows per-listener drift chips (`+12ms · in spec` /
   `correcting`) and a **Worst drift** card.

Device output latency (DAC/Bluetooth, up to 400 ms) is auto-compensated right
after prefill by skipping `baseLatency + outputLatency` audio once, with a
1.2 s top-up because the value often settles late.

## 3. Latency budget

| Stage | Cost |
|---|---|
| Capture batch | ≈ 21 ms (1024 samples) |
| Network (LAN) | < 15 ms typical |
| Jitter buffer | 70–300 ms adaptive (initial 110 ms, target = 2.8×jitter + period + 50) |
| Playout skip | −(device output latency), auto-compensated |
| **Air total** | **≈ 80–140 ms typical** — inside TV-broadcast tolerance; drift vs picture ≤ 50 ms |

Defenses in order: adaptive target → soft underrun (< 350 ms rides through
with 256-sample fade-in) → hard re-prefill gate. Playback-rate correction
±2.5 % converges fill to target and keeps listeners phase-aligned.

## 4. Relay (mini-services/sync-service)

Stateless socket.io service (`:3003`, path `/`): session rooms, host/listener
roles, opaque binary fan-out (accepts `ArrayBuffer` and Node `Buffer`),
`sync:timesync` ack, wizard flash re-stamp, **beacon re-stamp**, listener
stats passthrough (rtt/buffer/drift), idle-session GC. Compression disabled
(perMessageDeflate adds jitter on binary PCM).

## 5. UI — "Cobalt Noir" design system

Three colors only: `#000000` canvas · `#FFFFFF` light · `#2C3480` cobalt
energy, with cobalt tints `#07081A` surfaces / `#23265A` borders /
`#5A66D9·#8A93E8` lifted strokes / `#C7CCF7` light cobalt text. Role coding:
a solid white pill = broadcast state (ON AIR/LIVE), cobalt = everything
interactive / in-sync, lifted cobalt = calibration. Type: Plus Jakarta Sans
(headline 800), Geist Mono for codes/telemetry.

## 6. AWS telemetry plane (Builder Challenge)

`src/lib/telemetry.ts` — batched bus (3 s flush, pagehide sendBeacon,
queue-bounded) → `POST /api/telemetry` (validate, 600-event server ring,
forward) → `AWS_TELEMETRY_URL` Lambda Function URL → DynamoDB (TTL 30 d).
Events: `session_open`, `broadcast_state`, `listeners_changed`,
`drift_report` (host, 12 s pulse), `session_join`, `audio_start`,
rebuffer edges, `drift_report` (listener, 10 s pulse). IaC in `aws/`
(SAM, nodejs20.x, Function URL CORS, BatchWrite). Without the env var the
route still serves the ring — the host pill reads **local**.

## 7. File map

```
src/lib/sync-protocol.ts   wire codec (encode/decode, 24-byte header)
src/lib/sync-host.ts       capture engine + beacon emitter (startBeacon)
src/lib/sync-client.ts     playout engine + autoSyncTick closed loop
src/lib/relay-socket.ts    relay discovery (gateway probe → direct port)
src/lib/telemetry.ts       batched event bus
src/app/api/telemetry/     ingest route (ring + AWS forward)
public/worklets/*.js       capture + player AudioWorklets
src/components/sync/       Landing · HostConsole · Listener · bits (atoms)
mini-services/sync-service socket.io relay
aws/                       SAM template + Lambda + deploy guide
docs/                      submission checklist
FRICTION-LOG.md            developer-experience record + feedback answers
```

## 8. Demo flow (60 seconds on stage)

1. `/?p=host` → **▶ Play demo — go live** (one tap: demo cue + ON AIR + beacon)
2. Phones scan the QR → **Start listening** (one tap)
3. TV speakers muted; room silent, earbuds loud
4. Point at drift chips + Worst drift ≤ 50 ms card → "measured, not claimed"
5. Switch a phone to Track B (commentary) and back
6. Optional ⚡ wizard flash for slow-mo lip-proof shots
