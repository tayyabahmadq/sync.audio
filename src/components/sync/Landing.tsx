'use client'

import { useState } from 'react'
import { Logo, WaveGlyph, Pill } from './bits'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const steps = [
  {
    n: '01',
    title: 'The TV hosts',
    body: 'The Fire TV app captures the master audio of whatever is playing and streams it over the local Wi-Fi through a lightweight WebSocket relay. No extra hardware, no Bluetooth pairing cap.',
  },
  {
    n: '02',
    title: 'Guests scan the QR',
    body: 'Point any phone camera at the on-screen code. The Sync.audio PWA opens instantly in the browser — zero installs, zero app-store friction, works with earbuds already in your ears.',
  },
  {
    n: '03',
    title: 'Sync is automatic',
    body: 'A 1-second sync beacon closes the loop: every phone measures its own lip error against the TV playhead and self-corrects — drift ≤ 50 ms, no manual tuning, the room stays dead silent.',
  },
]

const comparison = [
  { feature: 'Max concurrent audio', standard: '1 Bluetooth device', sync: 'Unlimited phones on Wi-Fi' },
  { feature: 'Phone setup', standard: 'Install an app per guest', sync: 'None — scan & listen' },
  { feature: 'Extra hardware', standard: 'Splitters / transmitters', sync: 'Zero' },
  { feature: 'Audio tracks', standard: 'Single master mix', sync: 'Per-guest track selection' },
  { feature: 'Lip-sync', standard: 'OS-managed, fixed', sync: 'Auto ≤ 50 ms, measured live' },
]

export default function Landing() {
  const [code, setCode] = useState('')
  const join = () => {
    const c = code.trim().toUpperCase()
    if (c) window.location.href = `/?p=join&s=${encodeURIComponent(c)}`
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <div className="flex items-center gap-3">
          <a href="/?p=join" className="hidden text-sm text-white/55 transition-colors hover:text-white sm:block">Join a session</a>
          <Button asChild className="bg-[#2C3480] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(44,52,128,0.9)] hover:bg-[#232B72]">
            <a href="/?p=host">Host a session</a>
          </Button>
        </div>
      </header>

      {/* hero */}
      <main className="mx-auto max-w-6xl px-5">
        <section className="relative pt-10 pb-16 sm:pt-16">
          <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
            <div className="absolute -top-32 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-[#2C3480]/25 blur-3xl" />
            <div className="absolute top-40 -right-24 h-64 w-64 rounded-full bg-[#2C3480]/15 blur-3xl" />
          </div>

          <Pill tone="cyan" className="mb-5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#8A93E8] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#8A93E8]" />
            </span>
            LIVE HACKATHON BUILD · FIRE TV / VEGA OS
          </Pill>

          <h1 className="max-w-3xl text-4xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-6xl">
            The room stays silent.<br />
            <span className="bg-gradient-to-r from-[#8A93E8] via-[#5A66D9] to-[#2C3480] bg-clip-text text-transparent">
              Every earbud screams.
            </span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/60 sm:text-lg">
            Smart TVs allow exactly one Bluetooth receiver. Sync.audio turns every phone in the room
            into a personal wireless receiver — raw low-latency audio streamed over local Wi-Fi,
            joined with a single QR scan. Late-night sports, dorm rooms, shared flats: full volume,
            zero noise complaints.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild size="lg" className="bg-[#2C3480] font-semibold text-white shadow-[0_14px_36px_-12px_rgba(44,52,128,1)] hover:bg-[#232B72]">
              <a href="/?p=host">Start broadcasting →</a>
            </Button>
            <div className="flex items-center gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && join()}
                placeholder="JOIN CODE"
                maxLength={6}
                className="w-36 border-white/15 bg-white/[0.05] font-mono uppercase tracking-[0.2em] text-white placeholder:text-white/25"
              />
              <Button variant="outline" size="lg" onClick={join} className="border-white/15 bg-transparent text-white hover:bg-white/10">
                Join
              </Button>
            </div>
          </div>
        </section>

        {/* device diagram */}
        <section className="pb-16" aria-label="Architecture overview">
          <div className="rounded-3xl border border-[#23265a] bg-gradient-to-b from-[#0d0f26]/80 to-black p-6 shadow-[0_24px_80px_-40px_rgba(44,52,128,0.9)] sm:p-10">
            <div className="grid items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
              {/* TV */}
              <div className="relative">
                <div className="rounded-xl border-4 border-[#1a1c40] bg-black p-1 shadow-2xl">
                  <div className="relative aspect-video overflow-hidden rounded-lg bg-gradient-to-br from-[#101228] via-[#08091a] to-black">
                    {/* fake movie */}
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_60%_40%,rgba(90,102,217,0.30),transparent_55%),radial-gradient(ellipse_at_25%_70%,rgba(44,52,128,0.35),transparent_50%)]" />
                    <div className="absolute bottom-2 left-3 right-3 h-1 rounded bg-[#1a1c40]">
                      <div className="h-1 w-2/3 rounded bg-gradient-to-r from-[#8A93E8] to-[#2C3480]" />
                    </div>
                    {/* QR overlay */}
                    <div className="absolute right-2.5 bottom-2.5 grid h-14 w-14 grid-cols-5 gap-px rounded-md bg-white p-1.5 opacity-95">
                      {Array.from({ length: 25 }).map((_, i) => (
                        <span key={i} className={((i * 7 + 3) % 5 < 2) || i % 6 === 0 ? 'bg-black' : 'bg-white'} />
                      ))}
                    </div>
                    <div className="absolute top-2.5 left-3 font-mono text-[10px] text-[#9AA3F0]">MUTED · SYNC.AUDIO LIVE</div>
                  </div>
                </div>
                <div className="mt-2 text-center text-xs text-white/40">Fire TV — speakers silent, QR overlay on-screen</div>
              </div>
              {/* phones */}
              <div className="space-y-3">
                {[
                  { n: 'Phone 1', d: 'AirPods · Track A · auto-synced' },
                  { n: 'Phone 2', d: 'USB-C buds · Track B · auto-synced' },
                  { n: 'Phone N', d: 'any browser, any earbuds' },
                ].map((p, i) => (
                  <div key={p.n} className="flex items-center gap-3">
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-[#23265a] bg-[#07081a]">
                      <WaveGlyph className="h-6 w-6" />
                    </div>
                    <div className="flex-1 rounded-xl border border-[#23265a] bg-[#07081a]/80 px-4 py-2.5">
                      <div className="text-sm font-semibold text-white">{p.n}</div>
                      <div className="text-xs text-white/45">{p.d}</div>
                    </div>
                    {/* sync bars */}
                    <div className="flex h-8 items-end gap-0.5">
                      {[0, 1, 2, 3].map((k) => (
                        <span
                          key={k}
                          className="w-1 animate-pulse rounded-sm bg-[#8A93E8]/80"
                          style={{ height: `${40 + ((i * 7 + k * 11) % 55)}%`, animationDelay: `${(i * 0.2 + k * 0.13).toFixed(2)}s` }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                <div className="pl-1 text-xs text-white/45">
                  One Wi-Fi broadcast → N receivers. Each phone stays perfectly phase-locked to the shared timeline.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* steps */}
        <section className="pb-16">
          <h2 className="mb-8 text-2xl font-bold tracking-tight text-white">How it works</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {steps.map((s) => (
              <div key={s.n} className="rounded-2xl border border-[#23265a] bg-[#07081a] p-6 transition-colors hover:border-[#5A66D9]/40">
                <div className="font-mono text-sm text-[#8A93E8]">{s.n}</div>
                <div className="mt-2 text-lg font-bold text-white">{s.title}</div>
                <p className="mt-2 text-sm leading-relaxed text-white/55">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* comparison */}
        <section className="pb-16">
          <h2 className="mb-8 text-2xl font-bold tracking-tight text-white">Standard setup vs Sync.audio</h2>
          <div className="overflow-hidden rounded-2xl border border-[#23265a]">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#23265a] bg-[#0d0f26] text-xs uppercase tracking-wider text-white/45">
                  <th className="px-5 py-3 font-semibold">Capability</th>
                  <th className="px-5 py-3 font-semibold">Standard Fire TV</th>
                  <th className="px-5 py-3 font-semibold text-[#8A93E8]">Sync.audio</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((r, i) => (
                  <tr key={r.feature} className={i % 2 ? 'bg-[#07081a]/60' : ''}>
                    <td className="px-5 py-3.5 font-semibold text-white/85">{r.feature}</td>
                    <td className="px-5 py-3.5 text-white/45">{r.standard}</td>
                    <td className="px-5 py-3.5 font-semibold text-[#8A93E8]">{r.sync}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* pipeline strip */}
        <section className="pb-20">
          <div className="rounded-2xl border border-[#23265a] bg-[#07081a] p-6">
            <div className="font-mono text-xs leading-relaxed text-white/60">
              <span className="text-[#8A93E8]">Fire TV host</span> → capture master PCM + time-sync headers → <span className="text-[#8A93E8]">WebSocket relay</span> → local Wi-Fi → <span className="text-[#C7CCF7]">N phones</span> → AudioWorklet jitter buffer → <span className="text-[#C7CCF7]">earbuds</span>
            </div>
            <p className="mt-3 text-sm text-white/45">
              A 1 Hz sync beacon plus NTP-style clock estimation keeps every receiver aligned to the shared
              playout timeline; a ±2.5% micro rate-correction absorbs network jitter without audible artifacts.
            </p>
          </div>
        </section>
      </main>

      <footer className="mt-auto border-t border-[#14163a] bg-black pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-6 text-xs text-white/40 sm:flex-row">
          <Logo compact />
          <span>Sync.audio v4 — beacon-locked auto-sync · silent group listening for Fire TV / Vega OS · MIT licensed</span>
        </div>
      </footer>
    </div>
  )
}
