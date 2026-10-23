/**
 * Drives a real session against a running Sync.audio relay so its stdout log
 * becomes an authentic, reproducible capture for the README terminal demo.
 *
 * Usage: bun scripts/capture_relay_session.mjs [relayUrl] [sessionCode]
 *   relayUrl     default http://localhost:3003/
 *   sessionCode  default K7Q2M (4-6 chars A-Z0-9)
 */
import { io } from 'socket.io-client'

const url = process.argv[2] || 'http://localhost:3003/'
const code = process.argv[3] || 'K7Q2M'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function connect() {
  return io(url, { transports: ['websocket'], path: '/', reconnection: false, timeout: 5000 })
}

function join(socket, payload) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('join timeout')), 4000)
    socket.emit('sync:join', payload, (resp) => {
      clearTimeout(t)
      if (resp?.ok) resolve(resp.session)
      else reject(new Error(resp?.message || 'join rejected'))
    })
  })
}

function probe(socket) {
  // NTP-style exchange, same shape the real client uses
  return new Promise((resolve) => {
    const c0 = Date.now()
    socket.emit('sync:timesync', { c0 }, (resp) => resolve(Date.now() - c0 - (resp.s - c0) / 1))
  })
}

const failures = []
async function main() {
  /* host */
  const host = connect()
  await new Promise((res, rej) => {
    host.on('connect', res)
    host.on('connect_error', rej)
  })
  const session = await join(host, { role: 'host', session: code, sampleRate: 48000 })
  console.error(`[script] host ok — session ${session.code}, ${session.count} listener(s)`)
  host.emit('sync:state', { state: 'playing', positionSec: 0 })

  /* listeners join, probe, drift */
  const names = ['Pixel-8', 'iPhone-15-Pro', 'Galaxy-S24']
  const listeners = []
  for (const name of names) {
    await sleep(700)
    const l = connect()
    await new Promise((res, rej) => {
      l.on('connect', res)
      l.on('connect_error', rej)
    })
    await join(l, { role: 'listener', session: code, name })
    for (let i = 0; i < 5; i++) await probe(l)
    listeners.push(l)
  }

  /* let the room breathe, then one listener drops (commute), rest stay */
  await sleep(1500)
  await new Promise((res) => { listeners[2].on('disconnect', res); listeners[2].disconnect() })
  await sleep(900)

  /* teardown */
  for (const l of listeners.slice(0, 2)) l.disconnect()
  await sleep(500)
  host.disconnect()
  await sleep(400)
  if (failures.length) console.error('[script] failures:', failures)
  console.error('[script] done')
  process.exit(0)
}

main().catch((e) => {
  console.error('[script] fatal:', e.message)
  process.exit(1)
})
