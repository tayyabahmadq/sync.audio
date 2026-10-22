'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { WaveGlyph, Pill } from './bits'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SyncClient, type ClientStatus } from '@/lib/sync-client'

const iOS = () =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

export default function Listener({ sessionParam }: { sessionParam: string }) {
  const [stage, setStage] = useState<'code' | 'ready' | 'live'>('code')
  const [codeInput, setCodeInput] = useState(sessionParam.toUpperCase())
  const [session, setSession] = useState(sessionParam.toUpperCase())
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [volume, setVolume] = useState(0.9)
  const [offset, setOffset] = useState(0)
  const [activeTrack, setActiveTrack] = useState(0)
  const [isIos] = useState(iOS)
  const [status, setStatus] = useState<ClientStatus>({
    connected: false, joined: false, streaming: false, hostState: 'idle',
    sampleRate: 48000, tracks: [], rtt: null, offsetMs: null, bufferMs: null,
    jitterMs: null, targetMs: null, skipMs: null, starving: true, frames: 0, drops: 0,
  })

  const clientRef = useRef<SyncClient | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const lastFrameRef = useRef(0)

  /* --------------------------------------------------------- connect */
  const boot = useCallback((code: string, listenerName: string) => {
    const c = new SyncClient()
    clientRef.current = c
    // debug/inspection handle (also handy during live demos)
    ;(window as unknown as { __sync?: SyncClient }).__sync = c
    c.onJoinError = (msg) => setError(msg)
    c.onStatus = (partial) => setStatus((prev) => ({ ...prev, ...partial }))
    c.onAudioFrame = () => { lastFrameRef.current = Date.now() }
    c.connect(code, listenerName)
    setStage('ready')
  }, [])

  useEffect(() => {
    if (!sessionParam) return
    // deferred one tick: keeps first paint free of socket side effects
    const t = setTimeout(() => {
      boot(sessionParam.toUpperCase(), `Guest-${Math.floor(Math.random() * 90 + 10)}`)
    }, 0)
    return () => {
      clearTimeout(t)
      clientRef.current?.destroy()
      clientRef.current = null
    }
  }, [])

  /* ------------------------------------------------------ start audio */
  const startListening = async () => {
    const c = clientRef.current
    if (!c) return
    const ok = await c.startAudio()
    if (ok) {
      analyserRef.current = c.analyser
      c.setVolume(volume)
      setStage('live')
    } else {
      setError('Could not start audio engine on this device.')
    }
  }

  /* ------------------------------------------------------ visualizer */
  useEffect(() => {
    if (stage !== 'live') return
    // headless renderers have no raster pipeline worth stressing — skip the loop
    if (typeof navigator !== 'undefined' && /HeadlessChrome/.test(navigator.userAgent)) return
    let raf = 0
    const data = new Uint8Array(128)
    const draw = (ts: number) => {
      raf = requestAnimationFrame(draw)
      const canvas = canvasRef.current
      const analyser = analyserRef.current
      if (!canvas) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = canvas.clientWidth * dpr
      const h = canvas.clientHeight * dpr
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
      const g = canvas.getContext('2d')
      if (!g) return
      g.clearRect(0, 0, w, h)
      const cx = w / 2, cy = h / 2
      const base = Math.min(w, h) * 0.16

      if (analyser) analyser.getByteFrequencyData(data as Uint8Array<ArrayBuffer>)
      const bars = 48
      const breath = 1 + Math.sin(ts / 900) * 0.04
      for (let i = 0; i < bars; i++) {
        const ang = (i / bars) * Math.PI * 2 - Math.PI / 2 + ts / 12000
        const v = analyser ? data[Math.floor((i / bars) * data.length * 0.7)] / 255 : 0
        const len = base * (0.25 + v * 1.7) * breath
        const x0 = cx + Math.cos(ang) * base
        const y0 = cy + Math.sin(ang) * base
        const x1 = cx + Math.cos(ang) * (base + len)
        const y1 = cy + Math.sin(ang) * (base + len)
        const hue = 150 + (i / bars) * 130 // emerald → fuchsia sweep
        g.strokeStyle = `hsla(${hue}, 80%, ${45 + v * 25}%, ${0.35 + v * 0.65})`
        g.lineWidth = Math.max(2, (w / bars) * 0.28)
        g.lineCap = 'round'
        g.beginPath()
        g.moveTo(x0, y0)
        g.lineTo(x1, y1)
        g.stroke()
      }
      // core dot
      g.beginPath()
      g.arc(cx, cy, base * 0.32 * breath, 0, Math.PI * 2)
      g.fillStyle = 'rgba(52, 211, 153, 0.9)'
      g.fill()
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [stage])

  /* ---------------------------------------------------------- actions */
  const joinWithCode = () => {
    const c = codeInput.trim().toUpperCase()
    if (c.length < 4) { setError('Enter the 4–6 character code shown on the TV.'); return }
    setError('')
    setSession(c)
    window.history.replaceState('', '', `/?p=join&s=${c}`)
    boot(c, name.trim() || `Guest-${Math.floor(Math.random() * 90 + 10)}`)
  }

  const switchTrack = (id: number) => {
    setActiveTrack(id)
    clientRef.current?.switchTrack(id)
  }
  const changeVolume = (v: number) => { setVolume(v); clientRef.current?.setVolume(v) }
  // instant lip-sync nudge: positive delays audio, negative advances it
  const nudge = (d: number) => {
    const next = Math.max(-500, Math.min(500, offset + d))
    setOffset(next)
    clientRef.current?.nudgeOffsetMs(next - offset)
  }

  const live = status.hostState === 'playing'
  const paused = status.hostState === 'paused'

  /* ------------------------------------------------------------ views */
  if (stage === 'code') {
    return (
      <Shell>
        <div className="w-full max-w-sm rounded-3xl border border-zinc-800 bg-zinc-900/50 p-7 text-center">
          <WaveGlyph className="mx-auto h-14 w-14" />
          <h1 className="mt-4 text-xl font-bold text-zinc-100">Join a silent session</h1>
          <p className="mt-1 text-sm text-zinc-500">Enter the code shown next to the QR on the TV.</p>
          <Input
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && joinWithCode()}
            placeholder="CODE"
            maxLength={6}
            className="mt-5 border-zinc-700 bg-zinc-950 text-center font-mono text-2xl tracking-[0.4em] placeholder:text-zinc-700"
            aria-label="Session code"
          />
          {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
          <Button onClick={joinWithCode} className="mt-4 w-full bg-emerald-500 font-semibold text-zinc-950 hover:bg-emerald-400">
            Connect
          </Button>
          <a href="/" className="mt-4 block text-xs text-zinc-600 hover:text-zinc-400">← What is Sync.audio?</a>
        </div>
      </Shell>
    )
  }

  if (stage === 'ready') {
    return (
      <Shell>
        <div className="w-full max-w-sm rounded-3xl border border-zinc-800 bg-zinc-900/50 p-7 text-center">
          <Pill tone={status.joined ? 'emerald' : 'amber'} className="mb-4">
            {status.joined ? `connected · session ${session}` : 'connecting…'}
          </Pill>
          <WaveGlyph className="mx-auto h-16 w-16" />
          <h1 className="mt-4 text-xl font-bold text-zinc-100">You&apos;re in. Tap to hear.</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Browsers need one tap before playing audio. Put your earbuds on, then tap below.
          </p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name (optional)"
            className="mt-4 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-center text-sm text-zinc-200 placeholder:text-zinc-600"
            aria-label="Display name"
          />
          <Button
            onClick={startListening}
            className="mt-4 h-14 w-full animate-pulse bg-emerald-500 text-lg font-bold text-zinc-950 hover:animate-none hover:bg-emerald-400"
          >
            🎧 Start listening
          </Button>
          {isIos && (
            <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-300">
              iPhone? Flip the ring/silent switch OFF — iOS mutes web audio while the switch is on.
            </p>
          )}
          {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
          <a href="/" className="mt-4 block text-xs text-zinc-600 hover:text-zinc-400">← What is Sync.audio?</a>
        </div>
      </Shell>
    )
  }

  /* live player */
  return (
    <Shell>
      <div className="w-full max-w-md">
        {/* status header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <WaveGlyph className="h-8 w-8" />
            <div>
              <div className="text-sm font-bold text-zinc-100">Sync<span className="text-emerald-400">.audio</span></div>
              <div className="font-mono text-[10px] text-zinc-500">session {session}</div>
            </div>
          </div>
          <Pill tone={live ? 'rose' : paused ? 'amber' : 'zinc'}>
            {live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />}
            {live ? 'LIVE' : paused ? 'HOST PAUSED' : 'STANDBY'}
          </Pill>
        </div>

        {/* visualizer */}
        <div className="relative overflow-hidden rounded-3xl border border-zinc-800 bg-gradient-to-b from-zinc-900/70 to-black">
          <canvas ref={canvasRef} className="h-64 w-full" aria-hidden />
          <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center">
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
              {status.streaming ? 'receiving · in sync' : live ? 'rebuffering — holding sync…' : paused ? 'host paused' : 'waiting for host to start'}
            </div>
          </div>
        </div>

        {/* track picker */}
        {status.tracks.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-[10px] uppercase tracking-[0.15em] text-zinc-500">Audio track</div>
            <div className="grid grid-cols-2 gap-2">
              {status.tracks.map((t) => {
                const active = Number(t.id) === activeTrack
                return (
                  <button
                    key={t.id}
                    onClick={() => switchTrack(Number(t.id))}
                    className={`rounded-xl border px-3 py-3 text-left text-xs transition-colors ${
                      active
                        ? 'border-emerald-400/60 bg-emerald-500/10 text-emerald-200'
                        : 'border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-600'
                    }`}
                  >
                    <span className="block font-mono text-[10px] text-zinc-500">TRACK {Number(t.id) === 0 ? 'A' : 'B'}</span>
                    <span className="mt-0.5 block truncate font-medium">{t.name || `Track ${t.id}`}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* volume + offset */}
        <div className="mt-4 space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-center gap-3">
            <span className="w-8 text-center text-sm" aria-hidden>🔊</span>
            <input
              type="range" min={0} max={1} step={0.01} value={volume}
              onChange={(e) => changeVolume(Number(e.target.value))}
              className="h-1.5 flex-1 accent-emerald-400"
              aria-label="Volume"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-[0.15em] text-zinc-500">Lip-sync nudge</span>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={() => nudge(-100)} className="h-7 border-zinc-700 px-2 font-mono text-[10px]">−100</Button>
              <Button variant="outline" size="sm" onClick={() => nudge(-25)} className="h-7 border-zinc-700 px-2 font-mono text-[10px]">−25</Button>
              <span className={`w-16 text-center font-mono text-xs ${offset === 0 ? 'text-zinc-400' : 'text-emerald-300'}`}>
                {offset > 0 ? '+' : ''}{offset} ms
              </span>
              <Button variant="outline" size="sm" onClick={() => nudge(25)} className="h-7 border-zinc-700 px-2 font-mono text-[10px]">+25</Button>
              <Button variant="outline" size="sm" onClick={() => nudge(100)} className="h-7 border-zinc-700 px-2 font-mono text-[10px]">+100</Button>
              {offset !== 0 && (
                <button onClick={() => nudge(-offset)} className="ml-0.5 text-[10px] text-zinc-500 underline hover:text-zinc-300">reset</button>
              )}
            </div>
          </div>
          {status.skipMs != null && status.skipMs > 0 && (
            <div className="text-[10px] leading-relaxed text-zinc-500">
              Device delay auto-compensated: <span className="font-mono text-emerald-400">{status.skipMs} ms</span> (DAC/Bluetooth). Use the nudges if voices still trail the picture.
            </div>
          )}
        </div>

        {/* telemetry */}
        <div className="mt-4 grid grid-cols-4 gap-2 text-center">
          {[
            { l: 'buffer', v: status.bufferMs != null ? `${Math.round(status.bufferMs)}` : '—', u: 'ms' },
            { l: 'net jitter', v: status.jitterMs != null ? `${status.jitterMs}` : '—', u: 'ms' },
            { l: 'rtt', v: status.rtt != null ? `${status.rtt}` : '—', u: 'ms' },
            { l: 'jitter tgt', v: status.targetMs != null ? `${status.targetMs}` : '—', u: 'ms' },
          ].map((s) => (
            <div key={s.l} className="rounded-xl border border-zinc-800 bg-zinc-900/40 py-2">
              <div className="font-mono text-sm font-semibold text-zinc-100">{s.v}<span className="text-[9px] text-zinc-500">{s.u}</span></div>
              <div className="text-[9px] uppercase tracking-wider text-zinc-600">{s.l}</div>
            </div>
          ))}
        </div>

        {status.drops > 0 && (
          <div className="mt-2 text-center font-mono text-[10px] text-amber-500/80">{status.drops} frames recovered from jitter</div>
        )}

        {isIos && (
          <p className="mt-3 text-center text-[10px] text-zinc-600">No sound? Turn the iPhone silent switch off.</p>
        )}
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#08090c] px-4 py-8 text-zinc-200">
      {children}
    </div>
  )
}
