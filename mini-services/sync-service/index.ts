/**
 * Sync.audio — relay service
 *
 * A lightweight "local broadcast tower": the host (Fire TV emulator) pushes raw
 * PCM audio frames tagged with a session code; every listener in that session's
 * room receives the identical frame stream, which is what keeps all earbuds in
 * lock-step. Audio frames are relayed opaquely (zero parse cost) — only control
 * traffic is understood here.
 */
import { createServer } from 'http'
import { Server, Socket } from 'socket.io'

const PORT = 3003
const SESSION_TTL_MS = 2 * 60 * 60 * 1000 // idle session GC
const SESSION_CODE_RE = /^[A-Z0-9]{4,6}$/

interface TrackInfo {
  id: string
  name: string
}

interface ListenerInfo {
  id: string
  name: string
  joinedAt: number
  rtt: number | null
  bufferMs: number | null
  drift: number | null
}

interface Session {
  code: string
  hostSocketId: string | null
  sampleRate: number
  tracks: TrackInfo[]
  state: 'idle' | 'playing' | 'paused'
  listeners: Map<string, ListenerInfo>
  createdAt: number
  lastActiveAt: number
}

const sessions = new Map<string, Session>()
const socketSession = new Map<string, { code: string; role: 'host' | 'listener' }>()

function makeSession(code: string, sampleRate: number): Session {
  const s: Session = {
    code,
    hostSocketId: null,
    sampleRate,
    tracks: [],
    state: 'idle',
    listeners: new Map(),
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  }
  sessions.set(code, s)
  return s
}

function sessionSummary(s: Session) {
  return {
    code: s.code,
    sampleRate: s.sampleRate,
    tracks: s.tracks,
    state: s.state,
    listeners: Array.from(s.listeners.values()),
    count: s.listeners.size,
  }
}

function gcSessions() {
  const now = Date.now()
  for (const [code, s] of sessions) {
    if (now - s.lastActiveAt > SESSION_TTL_MS && s.listeners.size === 0) {
      sessions.delete(code)
      console.log(`[gc] removed idle session ${code}`)
    }
  }
}
setInterval(gcSessions, 60_000).unref?.()

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, service: 'sync.audio relay', sessions: sessions.size }))
})

const io = new Server(httpServer, {
  // DO NOT change the path — it is used by the Caddy gateway for forwarding
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 5e6, // generous room for PCM frame batches
})

io.on('connection', (socket: Socket) => {
  console.log(`[conn] ${socket.id}`)

  /* ---------------------------------------------------------------- join */
  socket.on('sync:join', (data: {
    role: 'host' | 'listener'
    session?: string
    name?: string
    sampleRate?: number
  }, ack?: (resp: unknown) => void) => {
    const role = data?.role
    const code = (data?.session || '').toUpperCase().trim()

    if (role === 'host') {
      const safe = SESSION_CODE_RE.test(code) ? code : 'DEMO'
      let session = sessions.get(safe)
      if (!session) session = makeSession(safe, data.sampleRate || 48000)
      // reclaim: a host refresh keeps the session but takes over hosting
      session.hostSocketId = socket.id
      session.sampleRate = data.sampleRate || session.sampleRate
      session.lastActiveAt = Date.now()
      socket.join(`sess:${safe}`)
      socketSession.set(socket.id, { code: safe, role: 'host' })
      console.log(`[host] ${socket.id} hosting session ${safe}`)
      ack?.({ ok: true, session: sessionSummary(session) })
      return
    }

    if (role === 'listener') {
      const session = sessions.get(code)
      if (!session) {
        ack?.({ ok: false, error: 'session-not-found', message: `No live broadcast with code ${code || '(empty)'}` })
        return
      }
      socket.join(`sess:${code}`)
      const info: ListenerInfo = {
        id: socket.id,
        name: (data.name || 'Listener').slice(0, 24),
        joinedAt: Date.now(),
        rtt: null,
        bufferMs: null,
        drift: null,
      }
      session.listeners.set(socket.id, info)
      session.lastActiveAt = Date.now()
      socketSession.set(socket.id, { code, role: 'listener' })
      console.log(`[listener] ${info.name} joined ${code} (total ${session.listeners.size})`)
      ack?.({ ok: true, session: sessionSummary(session) })
      socket.to(`sess:${code}`).emit('sync:listener-joined', { listener: info, count: session.listeners.size })
      return
    }

    ack?.({ ok: false, error: 'bad-role' })
  })

  /* ------------------------------------------------------------- control */
  socket.on('sync:tracks', (data: { tracks: TrackInfo[] }) => {
    const ctx = socketSession.get(socket.id)
    if (!ctx || ctx.role !== 'host') return
    const s = sessions.get(ctx.code)
    if (!s) return
    s.tracks = (data.tracks || []).slice(0, 4)
    s.lastActiveAt = Date.now()
    socket.to(`sess:${ctx.code}`).emit('sync:tracks', { tracks: s.tracks })
  })

  socket.on('sync:state', (data: { state: 'idle' | 'playing' | 'paused'; positionSec?: number; trackId?: string }) => {
    const ctx = socketSession.get(socket.id)
    if (!ctx || ctx.role !== 'host') return
    const s = sessions.get(ctx.code)
    if (!s) return
    s.state = data.state
    s.lastActiveAt = Date.now()
    socket.to(`sess:${ctx.code}`).emit('sync:state', data)
  })

  /* ------------------------------------------- audio (opaque binary pass) */
  socket.on('sync:audio', (payload: ArrayBuffer | Uint8Array) => {
    const ctx = socketSession.get(socket.id)
    if (!ctx || ctx.role !== 'host') return
    // browsers emit ArrayBuffer; the server receives it as Buffer/Uint8Array
    const len = (payload as Uint8Array)?.byteLength ?? 0
    if (!payload || len < 32 || len > 4e6) return
    const s = sessions.get(ctx.code)
    if (!s) return
    s.lastActiveAt = Date.now()
    // fan-out to every listener in the room, untouched (re-serialized as binary)
    socket.to(`sess:${ctx.code}`).emit('sync:audio', payload)
  })

  /* ------------------------------------------------------------ timesync */
  // NTP-style exchange: listener measures offset+rtt against the relay clock
  socket.on('sync:timesync', (data: { c0: number }, ack?: (resp: unknown) => void) => {
    ack?.({ c0: data?.c0 ?? 0, s: Date.now() })
  })

  /* -------------------------------------------------------- listener stats */
  socket.on('sync:stats', (data: { rtt?: number; bufferMs?: number; drift?: number }) => {
    const ctx = socketSession.get(socket.id)
    if (!ctx || ctx.role !== 'listener') return
    const s = sessions.get(ctx.code)
    if (!s) return
    const l = s.listeners.get(socket.id)
    if (!l) return
    if (typeof data.rtt === 'number') l.rtt = data.rtt
    if (typeof data.bufferMs === 'number') l.bufferMs = data.bufferMs
    if (typeof data.drift === 'number') l.drift = data.drift
    socket.to(`sess:${ctx.code}`).emit('sync:listener-stats', { id: socket.id, ...data })
  })

  /* ---------------------------------------------------------- disconnect */
  socket.on('disconnect', () => {
    const ctx = socketSession.get(socket.id)
    console.log(`[disc] ${socket.id}`)
    if (!ctx) return
    const s = sessions.get(ctx.code)
    socketSession.delete(socket.id)
    if (!s) return
    if (ctx.role === 'host') {
      s.hostSocketId = null
      s.state = 'idle'
      socket.to(`sess:${ctx.code}`).emit('sync:host-gone', {})
    } else {
      const l = s.listeners.get(socket.id)
      s.listeners.delete(socket.id)
      socket.to(`sess:${ctx.code}`).emit('sync:listener-left', { id: socket.id, count: s.listeners.size })
      if (l) console.log(`[listener] ${l.name} left ${ctx.code} (total ${s.listeners.size})`)
    }
  })

  socket.on('error', (err) => console.error(`[err] ${socket.id}:`, err?.message || err))
})

httpServer.listen(PORT, () => {
  console.log(`Sync.audio relay service listening on :${PORT}`)
})

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0))
})
process.on('SIGINT', () => {
  httpServer.close(() => process.exit(0))
})
