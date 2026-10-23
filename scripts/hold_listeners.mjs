/**
 * Joins N listeners to a live Sync.audio session and HOLDS them connected,
 * reporting only honestly-measured values (timesync RTT). Used so the live
 * host screen can be screenshot with real connected listeners.
 *
 * Usage: bun scripts/hold_listeners.mjs <relayUrl> <sessionCode> [count] [holdMs]
 */
import { io } from 'socket.io-client'

const [url, code, countArg, holdArg] = process.argv.slice(2)
const N = Number(countArg || 2)
const HOLD = Number(holdArg || 90000)
const names = ['Pixel-8', 'iPhone-15-Pro']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const sockets = []
for (let i = 0; i < N; i++) {
  const s = io(url, { transports: ['websocket'], path: '/', reconnection: false, timeout: 8000 })
  try {
    await new Promise((res, rej) => { s.on('connect', res); s.on('connect_error', rej); s.on('connect_timeout', rej) })
  } catch (e) { console.error(`[${names[i]}] connect failed:`, e.message); process.exit(1) }
  const ok = await new Promise((res) =>
    s.emit('sync:join', { role: 'listener', session: code, name: names[i] || `Listener-${i}` }, (r) => res(r?.ok)))
  if (!ok) { console.error(`[${names[i]}] join rejected`); process.exit(1) }
  // honest NTP-style probes; report the real measured RTT
  for (let p = 0; p < 5; p++) {
    const rtt = await new Promise((res) => { const t0 = Date.now(); s.emit('sync:timesync', { c0: t0 }, () => res(Date.now() - t0)) })
    if (p === 4) s.emit('sync:stats', { rtt })
  }
  console.error(`[${names[i]}] joined ${code}, rtt measured`)
  sockets.push(s)
}

await sleep(HOLD)
for (const s of sockets) s.disconnect()
process.exit(0)
