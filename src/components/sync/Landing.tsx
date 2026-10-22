'use client'

import { useState } from 'react'
import { Logo, WaveGlyph, Pill } from './bits'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const steps = [
  {
    n: '01',
    title: 'The TV hosts',
    body: 'The Fire TV app captures the master audio buffer of whatever is playing and opens a lightweight WebSocket server on the local network. No extra hardware, no Bluetooth pairing cap.',
  },
  {
    n: '02',
    title: 'Guests scan the QR',
    body: 'Point any phone camera at the on-screen code. The Sync.audio PWA opens instantly in the browser — zero installs, zero app-store friction, works with earbuds already in your ears.',
  },
  {
    n: '03',
    title: 'Everyone hears, nobody hears',
    body: 'Raw PCM streams over Wi-Fi into an AudioWorklet jitter buffer with clock-synced playout. Sub-50ms cross-listener drift, lip-sync calibrated per device, the room stays dead silent.',
  },
]

const comparison = [
  { feature: 'Max concurrent audio', standard: '1 Bluetooth device', sync: 'Unlimited phones on Wi-Fi' },
  { feature: 'Phone setup', standard: 'Install an app per guest', sync: 'None — scan & listen' },
  { feature: 'Extra hardware', standard: 'Splitters / transmitters', sync: 'Zero' },
  { feature: 'Audio tracks', standard: 'Single master mix', sync: 'Per-guest track selection' },
  { feature: 'Latency control', standard: 'OS-managed', sync: 'Calibratable ±ms' },
]

export default function Landing() {
  const [code, setCode] = useState('')
  const join = () => {
    const c = code.trim().toUpperCase()
    if (c) window.location.href = `/?p=join&s=${encodeURIComponent(c)}`
  }

  return (
    <div className="min-h-screen bg-[#08090c] text-zinc-200">
      {/* nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <div className="flex items-center gap-3">
          <a href="/?p=join" className="hidden text-sm text-zinc-400 hover:text-zinc-200 sm:block">Join a session</a>
          <Button asChild className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400">
            <a href="/?p=host">Host a session</a>
          </Button>
        </div>
      </header>

      {/* hero */}
      <main className="mx-auto max-w-6xl px-5">
        <section className="relative pt-10 pb-16 sm:pt-16">
          <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
            <div className="absolute -top-32 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl" />
            <div className="absolute top-40 -right-24 h-64 w-64 rounded-full bg-fuchsia-500/10 blur-3xl" />
          </div>

          <Pill tone="emerald" className="mb-5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            LIVE HACKATHON BUILD · FIRE TV / VEGA OS
          </Pill>

          <h1 className="max-w-3xl text-4xl font-bold leading-[1.05] tracking-tight text-zinc-50 sm:text-6xl">
            The room stays silent.<br />
            <span className="bg-gradient-to-r from-emerald-300 via-emerald-400 to-fuchsia-400 bg-clip-text text-transparent">
              Every earbud screams.
            </span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-zinc-400 sm:text-lg">
            Smart TVs allow exactly one Bluetooth receiver. Sync.audio turns every phone in the room
            into a personal wireless receiver — raw low-latency audio streamed over local Wi-Fi,
            joined with a single QR scan. Late-night sports, dorm rooms, shared flats: full volume,
            zero noise complaints.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild size="lg" className="bg-emerald-500 text-zinc-950 hover:bg-emerald-400">
              <a href="/?p=host">Start broadcasting →</a>
            </Button>
            <div className="flex items-center gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && join()}
                placeholder="JOIN CODE"
                maxLength={6}
                className="w-36 border-zinc-700 bg-zinc-900/70 font-mono uppercase tracking-[0.2em] placeholder:text-zinc-600"
              />
              <Button variant="outline" size="lg" onClick={join} className="border-zinc-700 hover:bg-zinc-800">
                Join
              </Button>
            </div>
          </div>
        </section>

        {/* device diagram */}
        <section className="pb-16" aria-label="Architecture overview">
          <div className="rounded-3xl border border-zinc-800/80 bg-gradient-to-b from-zinc-900/60 to-zinc-950/60 p-6 sm:p-10">
            <div className="grid items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
              {/* TV */}
              <div className="relative">
                <div className="rounded-xl border-4 border-zinc-800 bg-black p-1 shadow-2xl">
                  <div className="relative aspect-video overflow-hidden rounded-lg bg-gradient-to-br from-zinc-900 via-zinc-950 to-black">
                    {/* fake movie */}
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_60%_40%,rgba(217,70,239,0.25),transparent_55%),radial-gradient(ellipse_at_25%_70%,rgba(16,185,129,0.18),transparent_50%)]" />
                    <div className="absolute bottom-2 left-3 right-3 h-1 rounded bg-zinc-800">
                      <div className="h-1 w-2/3 rounded bg-gradient-to-r from-emerald-400 to-fuchsia-400" />
                    </div>
                    {/* QR overlay */}
                    <div className="absolute right-2.5 bottom-2.5 grid h-14 w-14 grid-cols-5 gap-px rounded-md bg-white p-1.5 opacity-95">
                      {Array.from({ length: 25 }).map((_, i) => (
                        <span key={i} className={((i * 7 + 3) % 5 < 2) || i % 6 === 0 ? 'bg-zinc-950' : 'bg-white'} />
                      ))}
                    </div>
                    <div className="absolute top-2.5 left-3 font-mono text-[10px] text-emerald-300/90">MUTED · SYNC.AUDIO LIVE</div>
                  </div>
                </div>
                <div className="mt-2 text-center text-xs text-zinc-500">Fire TV — speakers silent, QR overlay on-screen</div>
              </div>
              {/* phones */}
              <div className="space-y-3">
                {[
                  { n: 'Phone 1', d: 'AirPods · Track A · −4ms drift' },
                  { n: 'Phone 2', d: 'USB-C buds · Track B · −9ms drift' },
                  { n: 'Phone N', d: 'any browser, any earbuds' },
                ].map((p, i) => (
                  <div key={p.n} className="flex items-center gap-3">
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-zinc-700 bg-zinc-900">
                      <WaveGlyph className="h-6 w-6" />
                    </div>
                    <div className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900/70 px-4 py-2.5">
                      <div className="text-sm font-medium text-zinc-200">{p.n}</div>
                      <div className="text-xs text-zinc-500">{p.d}</div>
                    </div>
                    {/* sync bars */}
                    <div className="flex h-8 items-end gap-0.5">
                      {[0, 1, 2, 3].map((k) => (
                        <span
                          key={k}
                          className="w-1 animate-pulse rounded-sm bg-emerald-400/80"
                          style={{ height: `${40 + ((i * 7 + k * 11) % 55)}%`, animationDelay: `${(i * 0.2 + k * 0.13).toFixed(2)}s` }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                <div className="pl-1 text-xs text-zinc-500">
                  One Wi-Fi broadcast → N receivers. Each phone stays perfectly phase-locked to the shared timeline.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* steps */}
        <section className="pb-16">
          <h2 className="mb-8 text-2xl font-semibold tracking-tight text-zinc-100">How it works</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {steps.map((s) => (
              <div key={s.n} className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 transition-colors hover:border-emerald-500/30">
                <div className="font-mono text-sm text-emerald-400">{s.n}</div>
                <div className="mt-2 text-lg font-semibold text-zinc-100">{s.title}</div>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* comparison */}
        <section className="pb-16">
          <h2 className="mb-8 text-2xl font-semibold tracking-tight text-zinc-100">Standard setup vs Sync.audio</h2>
          <div className="overflow-hidden rounded-2xl border border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/70 text-xs uppercase tracking-wider text-zinc-500">
                  <th className="px-5 py-3 font-medium">Capability</th>
                  <th className="px-5 py-3 font-medium">Standard Fire TV</th>
                  <th className="px-5 py-3 font-medium text-emerald-300">Sync.audio</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((r, i) => (
                  <tr key={r.feature} className={i % 2 ? 'bg-zinc-900/30' : ''}>
                    <td className="px-5 py-3.5 font-medium text-zinc-300">{r.feature}</td>
                    <td className="px-5 py-3.5 text-zinc-500">{r.standard}</td>
                    <td className="px-5 py-3.5 font-medium text-emerald-300">{r.sync}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* pipeline strip */}
        <section className="pb-20">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
            <div className="font-mono text-xs leading-relaxed text-zinc-400">
              <span className="text-emerald-300">Fire TV host</span> → capture master PCM → <span className="text-emerald-300">WebSocket relay</span> → local Wi-Fi → <span className="text-fuchsia-300">N phones</span> → AudioWorklet jitter buffer → <span className="text-fuchsia-300">earbuds</span>
            </div>
            <p className="mt-3 text-sm text-zinc-500">
              Clock sync (NTP-style offset estimation) keeps every receiver aligned to the shared
              playout timeline; a ±3% micro rate-correction absorbs network jitter without audible artifacts.
            </p>
          </div>
        </section>
      </main>

      <footer className="mt-auto border-t border-zinc-900 bg-[#08090c] pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-6 text-xs text-zinc-600 sm:flex-row">
          <Logo compact />
          <span>Sync.audio — silent group listening for Fire TV / Vega OS · hackathon prototype</span>
        </div>
      </footer>
    </div>
  )
}
