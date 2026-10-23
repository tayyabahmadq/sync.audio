# Sync.audio — Developer Friction Log

**Project**: Sync.audio — local Wi-Fi silent group listening for Fire TV (Web Audio → WebSocket → phone receivers)
**Built in**: 12-hour hackathon sprint · **Stack**: Fire OS/Vega OS simulator, Next.js, Web Audio API (AudioWorklet), socket.io, Bun, AWS Lambda + DynamoDB
**Purpose**: first-hand developer-experience record — every friction we hit, what it cost us, how we worked around it, and what a platform fix would unlock. Severity: 🔴 blocker · 🟠 high · 🟡 medium · ⚪ low.

## Summary

| # | Area | Friction | Sev | Cost | Status |
|---|---|---|---|---|---|
| F1 | Fire OS / Vega OS | No public API to capture **system** master audio | 🔴 | Caps the product at "our own media elements" — cannot point Sync.audio at any TV content | Open — platform ask |
| F2 | Fire OS / Vega OS | No documented per-device audio latency figures (HAL + display pipeline) | 🟠 | Lip-sync must be *measured* per device; shipped a closed-loop beacon instead of a lookup | Worked around |
| F3 | Browser platform | Device output latency reporting (`baseLatency`/`outputLatency`) inconsistent across phones, sometimes `0` | 🟠 | Silent drift per device class; needed auto-compensation + conservative top-up | Worked around |
| F4 | Fire OS / Vega OS | No background-audio exemption for a browser/PWA host tab | 🟠 | Host tab must stay foreground = can't show other TV content while broadcasting | Open — platform ask |
| F5 | socket.io | No backpressure hints on binary WebSocket frames | 🟠 | Wi-Fi congestion is invisible to the app → built an adaptive jitter buffer (70–300 ms) to infer it | Worked around |
| F6 | socket.io | Binary payload type ambiguity (`ArrayBuffer` vs Node `Buffer` server-side) | 🟠 | Frames silently dropped → listeners heard nothing while link looked "up" | Fixed (accept both) |
| F7 | Fire OS / Vega OS | Remote debugging flaky vs desktop Chrome DevTools | 🟡 | Slower host-side diagnosis; fell back to on-screen telemetry chips | Worked around |
| F8 | Browser platform | iOS ring/silent switch mutes web audio with **no error, no event** | 🟡 | Users thought the app was broken; added explicit detection + hint copy | Worked around |
| F9 | Browser platform | Autoplay policy requires a user gesture before audio | ⚪ | Extra "Start listening" tap in the join flow (also good UX) | Accepted |
| F10 | AudioWorklet | Docs solid but examples dated; ScriptProcessor still needed as fallback for old WebViews | 🟡 | ~half a day ramp-up; dual capture/playback code paths maintained | Worked around |
| F11 | Fire OS / Vega OS | Simulator audio pipeline ≠ real device | 🟡 | True end-to-end lip-sync can't be validated on the desk; real-device pass required | Open |
| F12 | Headless CI | Renderer dies after ~20–60 s of live playout (thread exhaustion, no audio device) | ⚡ | CI can't soak-test live audio; kept auto-fallback path so e2e stays green | Accepted |
| F13 | socket.io | Default reconnect cap silently kills a long-lived host after relay restart | 🟠 | Host looked ON AIR but was dead; implemented infinite reconnect + link-state pill | Fixed |
| F14 | WebSocket perf | `perMessageDeflate` compression adds latency jitter on binary PCM | ⚡ | Disabled compression; jitter stddev dropped measurably | Fixed |
| F15 | Next.js | Single-route SPA constraint (platform sandbox) forced a query-param router | ⚪ | `/?p=host`, `/?p=join&s=CODE` instead of `/host`, `/join/:code` | Accepted |
| F16 | AWS Lambda | Function URL CORS + DynamoDB TTL are two extra manual steps before first ingest | ⚪ | ~20 min; SAM template now encodes both so redeploys are one command | Fixed |
| F17 | React/test harness | CDP synthetic input doesn't trigger React controlled `onChange` in headless runs | ⚪ | Manual code-entry untestable in CI; QR URL param is the golden path | Accepted |

## Detail — the frictions that shaped the architecture

### F1 · No system-audio capture API on Fire OS / Vega OS 🔴
- **Tried**: capture whatever the TV is playing so Sync.audio works with *any* content (Netflix, live sports, cable).
- **Happened**: the web layer only exposes media elements we create ourselves. There is no public equivalent of Android's `AudioPlaybackCapture` on Fire OS / Vega OS, and no browser permission model for system audio capture.
- **Impact**: the single biggest product ceiling. Every other part of the stack (relay, protocol, listeners, sync loop) is content-agnostic already.
- **Ask**: a native Vega OS capture module, or an `AudioCapture` permission model for the browser host. We'd port the host to it in an afternoon — the listener side needs zero changes.

### F2 · No per-device audio latency documentation 🟠
- **Tried**: pre-compensate lip-sync per Fire TV model from published HAL + display pipeline latency figures.
- **Happened**: no public numbers per device/build.
- **Workaround**: stopped guessing and *closed the loop* — a 1 s sync beacon (playhead + relay clock) lets each phone measure its own lip error continuously and self-correct (hold ≤ 10 ms, fade-protected micro-nudges 10–90 ms, instant re-lock beyond). Device output latency is auto-compensated right after prefill. Result: drift ≤ 50 ms spec, proven live on both consoles.
- **Ask**: publish audio-out latency per device model — it would let simple players pre-compensate without any beacon infrastructure.

### F3 · Inconsistent `outputLatency` reporting across phones 🟠
- **Happened**: `AudioContext.outputLatency` / `baseLatency` vary wildly across Android/iOS devices; some report `0` while taking 100–300 ms to actually reach the ear (Bluetooth adds up to 400 ms more).
- **Workaround**: auto-compensation = `baseLatency + outputLatency` (clamped ≤ 400 ms) plus a conservative top-up, then let the beacon loop trim the residue.
- **Ask**: standardize/verify these properties in WebView builds — or expose a calibration endpoint like our ⚡ wizard as a platform primitive.

### F5+F6 · Binary WebSocket fan-out has no guardrails 🟠
- **Happened**: (a) socket.io delivers binary as `ArrayBuffer` *or* Node `Buffer` depending on hop — our relay initially dropped every frame while all health pills stayed green; (b) no backpressure signal when Wi-Fi congests, so a naive player starves silently.
- **Fix/workaround**: accept both payload types at the relay; infer congestion from inter-arrival jitter (EMA) and drive an adaptive jitter target (70–300 ms: grow instantly on degradation, shrink only after 8 s stable). Soft-underrun recovery (< 350 ms rides through with a 256-sample fade-in) instead of harsh re-prefill.
- **Ask**: first-class binary frame backpressure metrics in socket.io/Engine.IO.

### F13 · Silent host death after relay restart 🟠
- **Happened**: default reconnect policy capped retries — after a relay redeploy the host UI still read ON AIR but frames went nowhere.
- **Fix**: infinite reconnection with gateway-probe → direct-port fallback, plus an explicit "relay link" state pill so failure is *visible*.

## What went *right* (for balance)

- **AudioWorklet**: capture on the audio thread with transferable batches (1024 samples ≈ 21 ms) is the reason the sync engine works at all — no main-thread render stalls punching holes in the stream.
- **socket.io rooms**: role-based join + opaque binary fan-out to unlimited listeners was ~50 lines of relay code.
- **PWA over install**: QR → browser → listening in one tap; zero app-store friction made the demo flow possible.
- **AWS Lambda Function URLs**: CORS-on-URL + DynamoDB and the whole telemetry plane (system events, `drift_report`, audio metadata) was live in under an hour, with a graceful local fallback when the env var is absent.
- **Fire OS simulator**: web-first host behaves like desktop Chromium — a 12-hour build was only viable because AudioWorklet, `MediaElementAudioSourceNode`, and QR rendering all just worked.

## Net effect

The platform frictions didn't just get patched — they defined the product's two headline features: the **closed-loop sync beacon** exists because device latency is unmeasurable ahead of time (F2/F3), and the **adaptive jitter buffer** exists because the transport has no backpressure (F5). Both are open-source under MIT and reusable as primitives by anyone building audio distribution on browser-based TV platforms.

---

## Appendix · Amazon Developer Product Feedback (final answers, Devpost-ready)

*These are the paste-ready answers for the Devpost Product Feedback section — same facts as above, written the way we'd actually say them.*

### 1. There's no way to capture system audio in the web runtime — that's the big one

Right now the web runtime on Fire OS / Vega OS only lets us touch audio from media elements our own app created. There's no equivalent of Android's `AudioPlaybackCapture`, no permission model, nothing that lets a web app capture what the TV is actually playing. For us that's the difference between "Sync.audio works with any content" and "Sync.audio works with the files we load ourselves." We'd love to point the host at Prime Video or live TV — we just can't reach that audio.

If Amazon shipped a native system-audio capture module for Vega OS, or even a permission-gated capture API for approved web apps, we could port our host to it in an afternoon. The relay, the sync protocol, and every phone listener would work unchanged — nothing on the receiver side needs to move.

### 2. We can't look up audio latency, so we measure it live instead

Nothing publishes audio-out latency per Fire TV model — no HAL numbers, no display pipeline figures. And the browser properties that are supposed to help (`AudioContext.outputLatency`, `baseLatency`) are inconsistent across phones; some report `0` while the ear hears the sound 100–300 ms later, and Bluetooth adds up to 400 ms more.

We stopped trying to guess and closed the loop instead. While the host broadcasts, it beams a one-second sync beacon stamped with the playhead on a shared clock. Every phone measures its own lip error continuously and corrects itself — hold when we're within 10 ms, inaudible fade-protected nudges between 10–90 ms, instant re-lock beyond that. It works — we hold ≤ 50 ms drift, shown live on both consoles — but honestly, it's a lot of machinery that wouldn't be needed if baseline latency figures were published per device, or if `outputLatency` were standardized in WebView builds so simple players could just pre-compensate.

### 3. A web host can't keep audio alive in the background

Our host is a browser tab, and the moment it loses focus — which on a TV means the user going anywhere near the home screen or another app — audio processing stops and the broadcast dies with it. There's no background-audio exemption for web/PWA hosts on Fire TV. Today the answer is "keep the tab front and center," which is fine for a demo but limits real use. A background-audio execution exemption for web-based host apps would let the broadcast survive navigation, and we'd use it immediately.

### 4. Debugging is rougher than desktop Chrome, so we built our own observability

Remote debugging on real Fire TV hardware is flakier than desktop DevTools, and the simulator's audio pipeline doesn't quite match physical hardware — what you hear on the desk isn't always what a real room hears. We ended up building live telemetry chips and health pills directly into the host UI: buffer rates, WebSocket link state, per-listener drift, all readable from the couch instead of the inspector. It was the right call anyway, but we'd have found some bugs a lot faster with parity debugging tools.

### What worked exceptionally well

Full AudioWorklet support was the surprise hero. Capture runs on the audio thread in transferable 1024-sample batches (~21 ms each) with zero main-thread render stalls — on a 12-hour build, that's the difference between shipping and not shipping. The web platform fundamentals were simply *there*: WebSockets, `MediaElementAudioSourceNode`, dynamic QR generation, and install-free PWA joins all behaved like desktop Chromium out of the box. And credit where it's due to AWS — Lambda Function URLs got our entire telemetry plane (system events, drift reports, host audio metadata → DynamoDB) live in under an hour, with a graceful local fallback when we're offline.

Would we build on this stack again? Yes, without hesitation — with one wish-list item: give us system audio capture, and Sync.audio stops being a clever browser trick and becomes a native-feeling part of Fire OS.
