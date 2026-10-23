'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Logo, Pill, Stat, WaveGlyph } from './bits'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SyncHost, type ListenerRow } from '@/lib/sync-host'
import { makeSessionCode } from '@/lib/sync-protocol'
import { trackEvent } from '@/lib/telemetry'

type SourceKind = 'action' | 'commentary' | 'upload' | 'none'
interface SlotCfg {
  kind: SourceKind
  name: string
  loaded: boolean
  fileName?: string
  isVideo?: boolean
}

const DEMO = {
  action: { src: '/demo/action.wav', name: 'Main Mix — Action Cue' },
  commentary: { src: '/demo/commentary.wav', name: 'Commentary — Crowd Feed' },
}

const DRIFT_SPEC_MS = 50

function fmtElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export default function HostConsole() {
  const [code, setCode] = useState('')
  const [phase, setPhase] = useState<'setup' | 'live'>('setup')
  const [broadcast, setBroadcast] = useState<'idle' | 'playing' | 'paused'>('idle')
  const [listeners, setListeners] = useState<ListenerRow[]>([])
  const [count, setCount] = useState(0)
  const [monitor, setMonitor] = useState(false)
  const [qr, setQr] = useState('')
  const [joinUrl, setJoinUrl] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [frames, setFrames] = useState(0)
  const [kbps, setKbps] = useState(0)
  const [copied, setCopied] = useState(false)
  const [relayUp, setRelayUp] = useState(false)
  const [slots, setSlots] = useState<SlotCfg[]>([
    { kind: 'action', name: DEMO.action.name, loaded: false },
    { kind: 'commentary', name: DEMO.commentary.name, loaded: false },
  ])

  const engineRef = useRef<SyncHost | null>(null)
  const videoARef = useRef<HTMLVideoElement>(null)
  const videoBRef = useRef<HTMLVideoElement>(null)
  const fileARef = useRef<HTMLInputElement>(null)
  const fileBRef = useRef<HTMLInputElement>(null)

  /* ------------------------------------------------------------ boot */
  useEffect(() => {
    const url = new URL(window.location.href)
    const initial = (url.searchParams.get('s') || makeSessionCode()).toUpperCase()
    // deferred one tick — avoids sync setState inside the effect body
    const t = setTimeout(() => {
      setCode(initial)
      setJoinUrl(`${window.location.origin}/?p=join&s=${initial}`)
    }, 0)

    const engine = new SyncHost()
    engineRef.current = engine
    engine.init(initial, {
      onListeners: (rows) => setListeners(rows),
      onSession: (info) => setCount(info.count),
      onRelay: (up) => setRelayUp(up),
      // a listener tapped "Sync to screen" — flash the TV for them automatically
      onWizardRequest: (name) => {
        setWizardFor(name)
        setTimeout(() => runWizardRef.current?.(), 80)
      },
    })
    trackEvent('session_open', { role: 'host', session: initial })
    return () => {
      clearTimeout(t)
      engine.destroy()
      engineRef.current = null
    }
  }, [])

  /* ---------------------------------------------------------------- QR */
  useEffect(() => {
    if (!joinUrl) return
    QRCode.toDataURL(joinUrl, {
      margin: 1, width: 480,
      color: { dark: '#000000', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    }).then(setQr).catch(() => {})
  }, [joinUrl])

  /* -------------------------------------------------------------- stats */
  useEffect(() => {
    const t = setInterval(() => {
      const e = engineRef.current
      if (!e) return
      const s = e.getStats()
      setFrames(s.framesSent)
      setKbps(s.bitrateKbps)
      if (e.broadcasting) setElapsed(Date.now() - e.startedAt)
    }, 800)
    return () => clearInterval(t)
  }, [])

  /* ------------------------------------------- AWS telemetry: drift pulse */
  useEffect(() => {
    const t = setInterval(() => {
      if (broadcast !== 'playing') return
      const ds = listeners.map((l) => l.drift).filter((d): d is number => typeof d === 'number')
      const worst = ds.length ? Math.max(...ds.map(Math.abs)) : null
      trackEvent('drift_report', {
        role: 'host', session: code, listeners: listeners.length,
        worstDriftMs: worst, specMs: DRIFT_SPEC_MS,
      })
    }, 12_000)
    return () => clearInterval(t)
  }, [broadcast, listeners, code])

  /* ------------------------------------------------------------- tracks */
  const [slotSrc, setSlotSrc] = useState<[string, string]>([DEMO.action.src, DEMO.commentary.src])

  const applySource = useCallback((slotIdx: number, src: string, cfg: SlotCfg) => {
    const el = slotIdx === 0 ? videoARef.current : videoBRef.current
    if (el) el.loop = cfg.kind !== 'upload' // demo cues loop so judges can scan anytime
    setSlotSrc((prev) => {
      const next = ([...prev] as [string, string])
      next[slotIdx] = src
      return next
    })
    setSlots((prev) => prev.map((s, i) => (i === slotIdx ? { ...cfg, loaded: true } : s)))
    engineRef.current?.setTrackName(String(slotIdx), cfg.name)
  }, [])

  // attach both tracks to the capture graph once media elements exist
  useEffect(() => {
    const t = setTimeout(() => {
      const engine = engineRef.current
      if (!engine) return
      const elA = videoARef.current
      const elB = videoBRef.current
      if (elA) { elA.loop = true; engine.attachTrack('0', slots[0].name, elA) }
      if (elB) { elB.loop = true; engine.attachTrack('1', slots[1].name, elB) }
      setSlots((prev) => prev.map((s) => (s.loaded ? s : { ...s, loaded: true })))
    }, 400)
    return () => clearTimeout(t)
  }, [])

  const onPickFile = (slotIdx: number) =>
    (slotIdx === 0 ? fileARef : fileBRef).current?.click()

  const onFileChosen = (slotIdx: number, file: File | undefined) => {
    if (!file) return
    const url = URL.createObjectURL(file)
    const isVideo = file.type.startsWith('video')
    const name = file.name.replace(/\.[^.]+$/, '').slice(0, 32)
    applySource(slotIdx, url, { kind: 'upload', name, loaded: false, fileName: name, isVideo })
  }

  const rename = (slotIdx: number, name: string) => {
    setSlots((prev) => prev.map((s, i) => (i === slotIdx ? { ...s, name } : s)))
    engineRef.current?.setTrackName(String(slotIdx), name)
  }

  /* -------------------------------------------------------- transport */
  const start = async () => {
    const engine = engineRef.current
    if (!engine) return
    await engine.start()
    setPhase('live')
    setBroadcast('playing')
    trackEvent('broadcast_state', { state: 'playing', session: code })
  }
  const pause = () => { engineRef.current?.pause(); setBroadcast('paused'); trackEvent('broadcast_state', { state: 'paused', session: code }) }
  const resume = async () => {
    const engine = engineRef.current
    if (!engine) return
    await engine.start()
    setBroadcast('playing')
    trackEvent('broadcast_state', { state: 'playing', session: code })
  }
  const stop = () => { engineRef.current?.stop(); setBroadcast('idle'); setElapsed(0); trackEvent('broadcast_state', { state: 'idle', session: code }) }

  const toggleMonitor = () => {
    const v = !monitor
    setMonitor(v)
    engineRef.current?.setMonitor(v)
  }

  /* ------------------------------------------------- lip-sync wizard */
  const [flash, setFlash] = useState(false)
  const [wizardFor, setWizardFor] = useState<string | null>(null)
  const wizardTimersRef = useRef<number[]>([])
  const runWizardRef = useRef<(() => void) | null>(null)

  const runWizard = useCallback(() => {
    const engine = engineRef.current
    if (!engine || !engine.broadcasting) return
    wizardTimersRef.current.forEach((t) => clearTimeout(t))
    wizardTimersRef.current = []
    const total = 3
    for (let i = 0; i < total; i++) {
      wizardTimersRef.current.push(window.setTimeout(() => {
        setFlash(true)
        // tag the flash with the video playhead — listeners compare it with the
        // media time they are actually hearing to compute the lip error
        const mediaTs = engine.getVisibleMediaTime()
        engine.socket?.emit('sync:wizard', { kind: 'flash', mediaTsMs: mediaTs ?? undefined, index: i, total })
        wizardTimersRef.current.push(window.setTimeout(() => setFlash(false), 170))
      }, i * 1400))
    }
    wizardTimersRef.current.push(window.setTimeout(() => setWizardFor(null), total * 1400 + 500))
  }, [])
  runWizardRef.current = runWizard
  useEffect(() => () => { wizardTimersRef.current.forEach((t) => clearTimeout(t)) }, [])

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* */ }
  }

  /* ------------------------------------------------------------- sync */
  const buffers = listeners.map((l) => l.bufferMs).filter((b): b is number => typeof b === 'number')
  const spread = buffers.length >= 2 ? Math.max(...buffers) - Math.min(...buffers) : null
  const drifts = listeners.map((l) => l.drift).filter((d): d is number => typeof d === 'number')
  const worstDrift = drifts.length ? Math.max(...drifts.map(Math.abs)) : null

  return (
    <div className="min-h-screen bg-black text-white">
      {/* top bar */}
      <header className="sticky top-0 z-20 border-b border-[#14163a] bg-black/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <a href="/" className="flex items-center gap-3"><Logo /></a>
          <div className="flex items-center gap-2">
            <Pill tone={relayUp ? 'cyan' : 'rose'}>
              <span className={`h-1.5 w-1.5 rounded-full ${relayUp ? 'animate-pulse bg-[#8A93E8]' : 'bg-red-400'}`} />
              {relayUp ? 'relay link up' : 'relay link down'}
            </Pill>
            {broadcast === 'playing' && (
              <Pill tone="rose">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2C3480]" /> ON AIR
              </Pill>
            )}
            {broadcast === 'paused' && <Pill tone="amber">PAUSED</Pill>}
            {broadcast === 'idle' && phase === 'live' && <Pill tone="zinc">STOPPED</Pill>}
            {wizardFor && <Pill tone="fuchsia">calibrating {wizardFor}…</Pill>}
            {broadcast === 'playing' && <Pill tone="cyan">AUTO-SYNC ON</Pill>}
            <Pill tone="amber">SESSION <span className="font-mono font-bold tracking-widest">{code}</span></Pill>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-5 px-4 py-6 lg:grid-cols-[1.55fr_1fr]">
        {/* ---------------------------------------------------- left col */}
        <section className="space-y-5">
          {/* TV preview */}
          <div className="overflow-hidden rounded-2xl border border-[#23265a] bg-[#07081a] shadow-[0_18px_44px_-28px_rgba(44,52,128,0.8)]">
            <div className="relative aspect-video bg-black">
              <video
                ref={videoARef}
                src={slotSrc[0]}
                playsInline
                preload="auto"
                className="h-full w-full object-contain"
              />
              {/* track B element — audio-only route, never shown */}
              <video ref={videoBRef} src={slotSrc[1]} playsInline preload="auto" className="hidden" aria-hidden />
              {/* lip-sync wizard flash — this IS the TV picture during calibration */}
              {flash && <div className="absolute inset-0 z-10 bg-white" aria-hidden />}
              {/* cover for audio-only sources */}
              {!slots[0].isVideo && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-[#101228] via-black to-[#101228]">
                  <div className="relative">
                    <WaveGlyph className="h-20 w-20" />
                    {broadcast === 'playing' && <div className="absolute inset-0 animate-ping rounded-full bg-[#5A66D9]/30" />}
                  </div>
                  <div className="text-center">
                    <div className="font-mono text-xs uppercase tracking-[0.25em] text-[#9AA3F0]">tv speakers · muted</div>
                    <div className="mt-1 max-w-xs truncate text-lg font-bold text-white">{slots[0].name}</div>
                    <div className="mt-0.5 text-xs text-white/50">audio is being captured → relay → listeners&apos; phones</div>
                  </div>
                  {/* level bars */}
                  <div className="flex h-6 items-end gap-1">
                    {[0, 1, 2, 3, 4, 5, 6].map((k) => (
                      <span key={k}
                        className={`w-1.5 rounded-sm ${broadcast === 'playing' ? 'animate-pulse bg-[#8A93E8]/90' : 'bg-[#1a1c40]'}`}
                        style={{ height: broadcast === 'playing' ? `${35 + ((k * 13) % 60)}%` : '25%', animationDelay: `${k * 0.11}s` }} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* transport */}
            <div className="flex flex-wrap items-center gap-3 border-t border-[#23265a] px-4 py-3">
              {broadcast !== 'playing' ? (
                <Button onClick={broadcast === 'paused' ? resume : start} className="bg-[#2C3480] font-bold text-white shadow-[0_12px_30px_-10px_rgba(44,52,128,1)] hover:bg-[#232B72]">
                  {broadcast === 'paused' ? '▶ Resume broadcast' : phase === 'setup' ? '▶ Play demo — go live' : '▶ Start broadcast'}
                </Button>
              ) : (
                <Button onClick={pause} variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/10">❚❚ Pause</Button>
              )}
              <Button onClick={stop} variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/10">■ Stop</Button>
              <Button
                onClick={runWizard}
                disabled={broadcast !== 'playing'}
                variant="outline"
                title={broadcast === 'playing' ? 'Flash the TV 3× so listeners can auto-align lips' : 'Start the broadcast first'}
                className="border-[#5A66D9]/45 bg-transparent text-[#C7CCF7] hover:border-[#8A93E8] hover:text-[#DDE1FF]"
              >
                ⚡ Lip-sync wizard
              </Button>
              <div className="ml-auto flex items-center gap-3 font-mono text-sm text-white/60">
                <span className={broadcast === 'playing' ? 'text-[#8A93E8]' : ''}>{fmtElapsed(elapsed)}</span>
                <label className="flex cursor-pointer items-center gap-2 text-xs normal-case">
                  <input type="checkbox" checked={monitor} onChange={toggleMonitor} className="h-3.5 w-3.5 accent-[#2C3480]" />
                  TV speaker monitor {monitor ? '(on)' : '(off — silent)'}
                </label>
              </div>
            </div>
          </div>

          {/* track slots */}
          <div className="grid gap-4 sm:grid-cols-2">
            {slots.map((s, i) => (
              <div key={i} className="rounded-2xl border border-[#23265a] bg-[#07081a] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <Pill tone={i === 0 ? 'cyan' : 'fuchsia'}>TRACK {i === 0 ? 'A' : 'B'}</Pill>
                  <span className={`text-[11px] ${s.loaded ? 'text-[#8A93E8]' : 'text-white/35'}`}>
                    {s.loaded ? '● loaded' : '○ not loaded'}
                  </span>
                </div>
                <Input
                  value={s.name}
                  onChange={(e) => rename(i, e.target.value)}
                  className="mb-3 border-white/15 bg-white/[0.04] text-sm text-white"
                  aria-label={`Track ${i} name`}
                />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant={s.kind === 'action' ? 'secondary' : 'outline'}
                    onClick={() => applySource(i, DEMO.action.src, { kind: 'action', name: DEMO.action.name, loaded: false })}
                    className="h-8 border-white/15 bg-transparent text-xs text-white/80 hover:bg-white/10">Demo: Action</Button>
                  <Button size="sm" variant={s.kind === 'commentary' ? 'secondary' : 'outline'}
                    onClick={() => applySource(i, DEMO.commentary.src, { kind: 'commentary', name: DEMO.commentary.name, loaded: false })}
                    className="h-8 border-white/15 bg-transparent text-xs text-white/80 hover:bg-white/10">Demo: Commentary</Button>
                  <Button size="sm" variant={s.kind === 'upload' ? 'secondary' : 'outline'}
                    onClick={() => onPickFile(i)} className="h-8 border-white/15 bg-transparent text-xs text-white/80 hover:bg-white/10">Upload…</Button>
                  <input
                    ref={(el) => { if (i === 0) fileARef.current = el; else fileBRef.current = el }}
                    type="file" accept="video/*,audio/*" hidden
                    onChange={(e) => onFileChosen(i, e.target.files?.[0])}
                  />
                </div>
                {s.kind === 'upload' && s.fileName && (
                  <div className="mt-2 truncate text-[11px] text-white/40">{s.isVideo ? '🎬' : '🎵'} {s.fileName}</div>
                )}
              </div>
            ))}
          </div>

          {/* stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Frames streamed" value={frames.toLocaleString()} />
            <Stat label="Uplink" value={`${Math.round(kbps)} kbps`} sub="Int16 · 48 kHz mono" />
            <Stat label="Air latency" value="≈80–140 ms" sub="21 ms batch + adaptive jitter" />
            <Stat label="Group sync" value={spread != null ? `±${spread.toFixed(0)} ms` : '—'} sub="listener spread" tone={spread != null && spread < 30 ? 'text-[#8A93E8]' : ''} />
            <Stat
              label="Worst drift"
              value={worstDrift != null ? `${worstDrift} ms` : '—'}
              sub={`spec ≤ ${DRIFT_SPEC_MS} ms`}
              tone={worstDrift != null && worstDrift <= DRIFT_SPEC_MS ? 'text-[#8A93E8]' : worstDrift != null ? 'text-white' : ''}
            />
          </div>
        </section>

        {/* --------------------------------------------------- right col */}
        <section className="space-y-5">
          {/* QR */}
          <div className="rounded-2xl border border-[#23265a] bg-gradient-to-b from-[#0d0f26] to-black p-5 text-center">
            <div className="mb-3 flex items-center justify-center gap-2 text-sm font-semibold text-white/80">
              Scan to listen <span className="text-white/35">· no install</span>
            </div>
            <div className="mx-auto w-full max-w-[260px] rounded-2xl bg-white p-3 shadow-[0_0_44px_-10px_rgba(90,102,217,0.55)]">
              {qr ? <img src={qr} alt="QR code to join the silent audio session" className="h-auto w-full" /> : <div className="aspect-square animate-pulse rounded-lg bg-[#0d0f26]" />}
            </div>
            <div className="mt-3 font-mono text-3xl font-bold tracking-[0.3em] text-white">{code}</div>
            <button onClick={copyLink} className="mt-1 w-full truncate rounded-lg border border-[#23265a] bg-white/[0.04] px-2 py-1.5 text-[11px] text-white/45 hover:text-white/80" title={joinUrl}>
              {copied ? '✓ link copied' : joinUrl || '…'}
            </button>
          </div>

          {/* listeners */}
          <div className="rounded-2xl border border-[#23265a] bg-[#07081a] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-bold text-white">Listeners</div>
              <Pill tone={count > 0 ? 'cyan' : 'zinc'}>
                <span className={`h-1.5 w-1.5 rounded-full ${count > 0 ? 'animate-pulse bg-[#8A93E8]' : 'bg-white/25'}`} />
                {count} connected
              </Pill>
            </div>
            {listeners.length === 0 ? (
              <p className="py-6 text-center text-sm text-white/45">
                Waiting for scans…<br />
                <span className="text-xs">Every phone that scans joins this live list with its own drift read-out.</span>
              </p>
            ) : (
              <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {listeners.map((l) => {
                  const d = l.drift
                  const inSpec = d != null && Math.abs(d) <= DRIFT_SPEC_MS
                  return (
                    <li key={l.id} className="flex items-center gap-3 rounded-xl border border-[#1a1c40] bg-black/60 px-3 py-2.5">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-[#8A93E8]" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-white">{l.name}</div>
                        <div className="font-mono text-[10px] text-white/45">
                          rtt {l.rtt != null ? `${l.rtt}ms` : '—'} · buffer {l.bufferMs != null ? `${l.bufferMs}ms` : '—'}
                        </div>
                      </div>
                      <span
                        className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${
                          d == null
                            ? 'border-white/10 bg-white/[0.04] text-white/40'
                            : inSpec
                              ? 'border-[#5A66D9]/45 bg-[#2C3480]/25 text-[#C7CCF7]'
                              : 'border-white/30 bg-white text-black'
                        }`}
                        title={`lip error vs picture · spec ≤ ${DRIFT_SPEC_MS} ms`}
                      >
                        {d != null ? `${d > 0 ? '+' : ''}${d}ms · ${inSpec ? 'in spec' : 'correcting'}` : 'sync…'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* host tips */}
          <div className="rounded-2xl border border-[#5A66D9]/35 bg-[#2C3480]/15 p-4 text-xs leading-relaxed text-[#C7CCF7]">
            <div className="mb-1 font-bold text-[#8A93E8]">Stage notes</div>
            Keep this tab visible while broadcasting (the OS throttles hidden tabs).
            TV monitor is OFF by default — the room stays silent. Turn it on only to sanity-check the capture.
            Lip-sync is automatic: the 1 Hz sync beacon keeps every phone within ≤ {DRIFT_SPEC_MS} ms of the picture — the ⚡ wizard is only for a showy on-stage flash.
          </div>
        </section>
      </main>
    </div>
  )
}
