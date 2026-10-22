'use client'

import { cn } from '@/lib/utils'

/**
 * Design atoms — Sync.audio "Cobalt Noir" theme.
 *
 * Palette (dark stage, role-coded, three colors only):
 *  - BLACK  #000000 canvas — the midnight stage, OLED-black
 *  - WHITE  #FFFFFF light — headlines, ON AIR / LIVE (inverted broadcast)
 *  - COBALT #2C3480 — the single brand accent: CTAs, sync-OK, active states
 *  Cobalt tints (#07081A surfaces, #5A66D9/#8A93E8 lifted strokes) derive from
 *  the accent; a solid white pill carries "live broadcast" semantics, cobalt
 *  carries "everything interactive / in-sync". No other hues.
 */
export function WaveGlyph({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center justify-center', className)}>
      <svg viewBox="0 0 40 40" className="h-full w-full" fill="none" aria-hidden>
        <rect x="1" y="1" width="38" height="38" rx="10" className="fill-[#0B0D22] stroke-[#5A66D9]/45" strokeWidth="1.5" />
        <circle cx="14" cy="20" r="2.4" className="fill-[#8A93E8]" />
        <path d="M21 12a11 11 0 0 1 0 16" className="stroke-[#8A93E8]" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M26 8a17 17 0 0 1 0 24" className="stroke-[#5A66D9]/70" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M31 4.5a23 23 0 0 1 0 31" className="stroke-[#5A66D9]/35" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    </span>
  )
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="Sync.audio"
      draggable={false}
      className={cn('w-auto select-none', compact ? 'h-6' : 'h-9')}
    />
  )
}

export function Pill({ tone = 'zinc', children, className }: {
  tone?: 'zinc' | 'cyan' | 'amber' | 'fuchsia' | 'rose'
  children: React.ReactNode
  className?: string
}) {
  const tones: Record<string, string> = {
    // neutral hairline chip
    zinc: 'border-white/12 bg-white/[0.05] text-white/60',
    // cobalt — interactive / in-sync states
    cyan: 'border-[#5A66D9]/45 bg-[#2C3480]/25 text-[#C7CCF7]',
    // solid cobalt — session identity, primary chips
    amber: 'border-transparent bg-[#2C3480] text-white',
    // calibration
    fuchsia: 'border-[#8A93E8]/50 bg-[#2C3480]/30 text-[#DDE1FF]',
    // broadcast noir, inverted — ON AIR / LIVE
    rose: 'border-transparent bg-white text-black',
  }
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide',
      tones[tone], className,
    )}>
      {children}
    </span>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-[#23265a] bg-[#07081a] px-3 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(138,147,232,0.07)]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">{label}</div>
      <div className={cn('mt-0.5 font-mono text-base font-semibold text-white', tone)}>{value}</div>
      {sub && <div className="text-[10px] text-white/40">{sub}</div>}
    </div>
  )
}
