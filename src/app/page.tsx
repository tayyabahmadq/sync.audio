'use client'

import { useSyncExternalStore } from 'react'
import Landing from '@/components/sync/Landing'
import HostConsole from '@/components/sync/HostConsole'
import Listener from '@/components/sync/Listener'
import { WaveGlyph } from '@/components/sync/bits'

function subscribe(cb: () => void) {
  window.addEventListener('popstate', cb)
  window.addEventListener('hashchange', cb)
  return () => {
    window.removeEventListener('popstate', cb)
    window.removeEventListener('hashchange', cb)
  }
}

/** "p|s" snapshot of the query string, read straight from the URL bar. */
function getSnapshot(): string {
  const q = new URLSearchParams(window.location.search)
  return `${q.get('p') ?? ''}|${q.get('s') ?? ''}`
}

function getServerSnapshot(): string {
  return '~init~'
}

function Splash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black">
      <WaveGlyph className="h-12 w-12 animate-pulse" />
      <div className="font-mono text-xs tracking-[0.3em] text-[#8A93E8]">SYNC.AUDIO</div>
    </div>
  )
}

export default function Page() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  if (snapshot === '~init~') return <Splash />

  const [p, s] = snapshot.split('|')
  if (p === 'host') return <HostConsole />
  if (p === 'join') return <Listener sessionParam={s || ''} />
  return <Landing />
}
