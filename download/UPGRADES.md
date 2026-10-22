# Sync.audio v2 — Upgrade Notes (buffering · lag · lip-sync)

## What you reported vs. what was wrong

| Your symptom | Root cause in v1 | Fixed in v2 by |
|---|---|---|
| "I felt a buffer" (dropouts/underruns) | Fixed 160 ms jitter buffer; every tiny underrun triggered a **full re-prefill** (long silence). 2.6 Mbps Float32 PCM saturated demo Wi-Fi. Host captured audio on the **main thread**, so UI re-renders punched gaps into the capture. | Soft underrun recovery, Int16 wire format (−50% bandwidth), audio-thread capture (see below). |
| "It was lagging" (high delay) | 43 ms batch + 160 ms jitter + relay hop ≈ **210–260 ms** air latency, plus 100–300 ms of phone DAC/Bluetooth delay that was never compensated. | 21 ms batches, adaptive jitter target (shrinks to ~70–110 ms on stable Wi-Fi), automatic device-delay compensation. |
| "Mouthing/lip was somewhere down" (lip-sync) | The offset slider only changed the jitter *target*, which converges over **3–10 seconds** via rate correction — nudges felt broken. No output-latency compensation at all. | **Instant** playout nudges (±25/±100 ms buttons), auto-skip of measured device latency, wider ±500 ms range. |

## The 6 upgrades shipped in v2

1. **Protocol v2 — Int16 PCM wire format** (`src/lib/sync-protocol.ts`)
   Payload halved Float32→Int16 with a codec byte for future Opus.
   Uplink: **2.6 Mbps → 1.54 Mbps** dual-track (verified live: 1560 kbps).
   Less Wi-Fi airtime = fewer queuing spikes = fewer underruns with many phones.

2. **Soft underrun recovery** (`public/worklets/player-worklet.js`)
   Short starvations (<350 ms) ride through with silence and resume as soon as
   ~30 ms of audio lands, with a 256-sample fade-in (no clicks, no re-prefill).
   Only long starvation falls back to a full prefill gate.
   Result: a Wi-Fi hiccup costs ~50 ms of quiet instead of a multi-second stall.

3. **Audio-thread capture on the host** (`public/worklets/capture-worklet.js` + `src/lib/sync-host.ts`)
   Capture moved from ScriptProcessor (main thread) to an AudioWorklet on the
   dedicated audio thread — UI re-renders no longer punch gaps into the
   broadcast. ScriptProcessor fallback kept for old WebViews.

4. **Smaller batches** — 2048 → 1024 samples (**43 ms → 21 ms**), cutting
   22 ms off the pipe immediately.

5. **Adaptive jitter buffer** (`src/lib/sync-client.ts`)
   The listener measures frame inter-arrival jitter continuously and sizes the
   buffer to the network: `target = 2.8 × jitter + batch period + 50 ms`,
   clamped 70–300 ms. Starts at 140 ms, shrinks only after 8 s of stable
   playout, grows instantly when the network degrades. Stable Wi-Fi settles
   near **~70–110 ms** instead of a permanent 160 ms.

6. **Lip-sync: instant nudges + auto device-delay compensation** (`sync-client.ts`, `Listener.tsx`)
   - `nudge` worklet message shifts the playout point **instantly** (skip or
     replay with a fade) — nudge buttons respond in real time, range ±500 ms.
   - On start, the client reads `AudioContext.baseLatency + outputLatency`
     (DAC/Bluetooth pipeline delay) and skips exactly that much audio right
     after prefill, auto-removing 100–300 ms of device delay. A one-time
     top-up runs at 1.2 s when Chrome settles the real outputLatency.
   - Listener UI shows the compensated amount and per-device jitter telemetry.

## Latency math — before vs after

```
v1:  43 ms batch + 160 ms jitter + RTT/2 + 0 ms device-comp
     ≈ 210–260 ms air + 100–300 ms device ≈ 350–500 ms behind the TV picture

v2:  21 ms batch + 70–140 ms adaptive jitter + RTT/2 − skip(base+output latency)
     ≈ 90–160 ms air + device delay auto-removed
     residual lip-sync fixed with two taps of ±25 ms (instant)
```

## File map (what to open for judges)

| File | Role |
|---|---|
| `src/lib/sync-protocol.ts` | 24-byte binary frame header, Int16 codec, v2 |
| `public/worklets/capture-worklet.js` | host audio-thread capture, 1024-sample batches |
| `public/worklets/player-worklet.js` | adaptive jitter buffer, soft underrun, nudge, skip |
| `src/lib/sync-host.ts` | host engine: capture graph, fan-out uplink, stats |
| `src/lib/sync-client.ts` | listener engine: jitter sizing, clock sync, nudges |
| `src/lib/relay-socket.ts` | gateway/direct relay connection strategy |
| `mini-services/sync-service/index.ts` | socket.io relay: rooms, opaque binary fan-out |
| `src/components/sync/HostConsole.tsx` | "Fire TV" console: QR, transport, telemetry |
| `src/components/sync/Listener.tsx` | zero-install PWA player: nudges, stats |
| `src/components/sync/Landing.tsx` | pitch page |
| `src/app/page.tsx` | query-param SPA router (`?p=host`, `?p=join&s=CODE`) |
| `scripts/gen_demo_audio.py` | demo WAV generator (action cue + commentary) |
| `public/demo/*.wav` | 64 s demo assets |

## Run it (demo mode on a laptop)

```bash
# 1. relay
cd mini-services/sync-service && bun install && bun run dev   # :3003

# 2. app
bun install && bun run dev                                    # :3000

# 3. host console:  http://localhost:3000/?p=host
#    phones scan the QR → http://<lan-ip>:3000/?p=join&s=CODE
#    (phones must be on the same Wi-Fi as the laptop)
```

## What to upgrade next (roadmap, in impact order)

1. **Opus via WebCodecs** (`AudioEncoder`/`AudioDecoder`, 20 ms frames):
   1.54 Mbps → ~128 kbps per track. Biggest remaining win for congested
   venue Wi-Fi; the v2 codec byte already reserves room for it.
2. **Timestamp-based shared playout timeline**: schedule each frame at
   `captureTs + sharedDelay` on every device's synced clock instead of
   pure jitter-target alignment — tightens cross-listener spread below ±10 ms
   even on mixed wired/Bluetooth setups.
3. **Lip-sync wizard**: host flashes a white frame + beep; listener taps on
   hearing the beep in the earbuds and the offset is set automatically.
4. **Sample-rate ladder**: offer a 24 kHz "crowd mode" (halves bandwidth
   again) for hostile networks.
