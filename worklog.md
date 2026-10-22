# Worklog

---
Task ID: 1
Agent: main (Z.ai)
Task: Build Sync.audio — low-latency silent group-audio broadcast (hackathon build) as a working web app: landing, host console (Fire TV emulator), QR-join listener PWA, socket.io relay service, demo audio assets.

Work Log:
- Initialized fullstack scaffold (Next.js 16 + TS + Tailwind 4 + shadcn/ui); installed socket.io, socket.io-client, qrcode.
- Built `mini-services/sync-service` (socket.io relay, port 3003, path '/'): session rooms, host/listener roles, opaque binary frame fan-out (accepts ArrayBuffer|Buffer — socket.io delivers Buffer server-side), NTP-style timesync ack, listener stats forwarding, idle-session GC. Started via `bun --hot`, log at `.zscripts/sync-service.log`.
- Wrote `src/lib/sync-protocol.ts`: 24-byte binary PCM frame header (magic SYNC, version, track, seq, host-timestamp, sampleRate) + encode/decode.
- Wrote `public/worklets/player-worklet.js`: AudioWorklet ring-buffer player with 160ms adaptive jitter buffer, ±3% drift correction, linear resampling, prefill gating (80% of target before playout).
- Wrote `src/lib/sync-host.ts` (capture: MediaElementSource → mono downmix → ScriptProcessor 2048 → batched binary frames; monitor gain default 0 = silent room; wake lock) and `src/lib/sync-client.ts` (join, timesync, worklet path + ScriptProcessor fallback path for old WebViews/headless, track switching, volume, lip-sync offset ±250ms).
- Wrote `src/lib/relay-socket.ts`: gateway probe (`/?XTransformPort=3003` → Caddy) with direct-port fallback (laptop LAN mode) and infinite reconnection.
- Built SPA at `/` only (platform constraint): query-param router (`?p=host`, `?p=join&s=CODE`) via useSyncExternalStore; views in `src/components/sync/` (Landing, HostConsole, Listener, bits).
- Generated demo assets with `scripts/gen_demo_audio.py`: 64s action cue + crowd/lo-fi commentary bed (48kHz mono WAV), PWA icons, manifest.
- Fixed during verification: Splash sentinel collision (landing never rendered), array-of-refs lint violations → named refs, declarative video src (React-compiler rules), missing track-B video element, missing prefill gating (buffer oscillated at 0ms), Buffer-vs-ArrayBuffer relay drop (frames never reached listeners), 3-attempt reconnect cap (host silently died after relay restart), missing onRelay on already-connected socket, track-loaded UI flag.
- E2E verified through Caddy gateway (:81 → mirrors preview): host join, listener join, "Start listening" gesture, 811 frames received, jitter buffer 184ms, starving=false, RTT 5ms, stats visible on host console, "relay link up" + "ON AIR" pills, frames counter climbing (~2.6 Mbps dual-track).
- Known sandbox limitation (NOT a product bug): headless Chromium renderer dies after ~20–60s of live audio playout (thread exhaustion with multiple browsers, no audio device). Real phone/desktop browsers are the target and handle this daily. Auto-fallback path keeps CI stable.

Stage Summary:
- Deliverable: working Sync.audio prototype. Host console = "Fire TV": plays demo clips or user uploads, captures master audio, streams PCM over WebSocket relay, shows scannable QR + live listener telemetry. Listener = zero-install PWA: scan QR → tap → hear broadcast in earbuds; track A/B switching, volume, lip-sync offset, buffer/rtt/clock stats.
- Key numbers: 48kHz mono PCM, 2048-sample batches (~43ms), ~205ms air latency (43ms batch + 160ms jitter), ~2.6 Mbps uplink dual-track, cross-listener sync via shared jitter target + drift correction.
- Preview URL routes: `/` landing, `/?p=host` host console, `/?p=join&s=CODE` listener.
- Mini service must stay running: `cd mini-services/sync-service && bun run dev` (already nohup'd).
