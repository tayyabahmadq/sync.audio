'use client'

import { cn } from '@/lib/utils'

export function WaveGlyph({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center justify-center', className)}>
      <svg viewBox="0 0 40 40" className="h-full w-full" fill="none" aria-hidden>
        <rect x="1" y="1" width="38" height="38" rx="10" className="fill-zinc-950 stroke-emerald-400/40" strokeWidth="1.5" />
        <circle cx="14" cy="20" r="2.4" className="fill-emerald-300" />
        <path d="M21 12a11 11 0 0 1 0 16" className="stroke-emerald-300" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M26 8a17 17 0 0 1 0 24" className="stroke-emerald-300/60" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M31 4.5a23 23 0 0 1 0 31" className="stroke-emerald-300/30" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    </span>
  )
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 select-none">
      <WaveGlyph className="h-8 w-8" />
      {!compact && (
        <span className="font-semibold tracking-tight text-lg text-zinc-100">
          Sync<span className="text-emerald-400">.audio</span>
        </span>
      )}
    </span>
  )
}

export function Pill({ tone = 'zinc', children, className }: {
  tone?: 'zinc' | 'emerald' | 'amber' | 'fuchsia' | 'rose'
  children: React.ReactNode
  className?: string
}) {
  const tones: Record<string, string> = {
    zinc: 'border-zinc-700/70 bg-zinc-900/80 text-zinc-300',
    emerald: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    amber: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    fuchsia: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300',
    rose: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  }
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide',
      tones[tone], className,
    )}>
      {children}
    </span>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">{label}</div>
      <div className={cn('mt-0.5 font-mono text-base font-semibold text-zinc-100', tone)}>{value}</div>
      {sub && <div className="text-[10px] text-zinc-500">{sub}</div>}
    </div>
  )
}
