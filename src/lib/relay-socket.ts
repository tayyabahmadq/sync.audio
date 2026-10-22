/**
 * Relay connection strategy.
 *
 * The relay (socket.io) lives on port 3003. Two deployment shapes exist:
 *  - Gateway mode (this sandbox / preview): Caddy fronts everything, so the
 *    relay is reached with a relative URL + XTransformPort query.
 *  - Direct mode (laptop LAN demo, plain `next dev` without a gateway):
 *    the browser must hit the relay port directly (CORS is open on the relay).
 *
 * We probe the gateway; if it isn't a socket.io endpoint we go direct. If the
 * chosen route still fails to connect we try the other one before giving up.
 */
import { io, Socket } from 'socket.io-client'
import { RELAY_URL } from '@/lib/sync-protocol'

function directUrl(): string {
  return `${window.location.protocol}//${window.location.hostname}:3003`
}

async function probeGateway(): Promise<boolean> {
  try {
    const res = await fetch('/?XTransformPort=3003', { cache: 'no-store' })
    const text = await res.text()
    // socket.io answers plain HTTP with its engine.io handshake error payload
    return text.includes('Transport unknown') || text.includes('"code":0')
  } catch {
    return false
  }
}

function attempt(url: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(url, {
      transports: ['websocket', 'polling'],
      path: '/',
      timeout: 5000,
      reconnectionDelay: 800,
      reconnectionDelayMax: 3000,
      // never give up: a broadcast must survive relay hiccups and re-join
      reconnectionAttempts: Infinity,
    })
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error(`relay unreachable at ${url}`))
    }, 7000)
    socket.on('connect', () => {
      clearTimeout(timer)
      resolve(socket)
    })
    socket.on('connect_error', () => { /* keep retrying until timer */ })
  })
}

/** Returns a connected relay socket; tries gateway → direct → direct again. */
export async function createRelaySocket(): Promise<Socket> {
  const gateway = await probeGateway()
  const first = gateway ? RELAY_URL : directUrl()
  try {
    return await attempt(first)
  } catch {
    const second = gateway ? directUrl() : RELAY_URL
    return await attempt(second)
  }
}
