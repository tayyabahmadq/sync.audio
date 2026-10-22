/**
 * Sync.audio — wire protocol shared by host and listeners.
 *
 * Audio frames are raw PCM (mono) with a compact binary header so the relay
 * can fan them out without parsing the payload.
 *
 * v2: payload is Int16 PCM — halves Wi-Fi airtime vs Float32 (the #1 cause of
 * jitter-buffer starvation on congested demo Wi-Fi). Byte 6 selects codec so
 * future formats (Opus) can slot in without another layout change.
 *
 * Header layout (little-endian), 24 bytes:
 *   0..3   magic  'S','Y','N','C'
 *   4      version (2)
 *   5      track id (0..3)
 *   6      codec: 0 = Float32, 1 = Int16
 *   7      reserved
 *   8..11  sequence number (uint32)
 *   12..19 capture timestamp, ms on the host session clock (float64)
 *   20..23 stream sample rate (uint32)
 */

export const HEADER_SIZE = 24
export const MAGIC = 0x53594e43 // 'SYNC'
export const PROTOCOL_VERSION = 2
export const CODEC_FLOAT32 = 0
export const CODEC_INT16 = 1

export interface AudioFrame {
  track: number
  seq: number
  tsMs: number
  sampleRate: number
  samples: Float32Array
}

export function encodeFrame(frame: AudioFrame): ArrayBuffer {
  const payloadBytes = frame.samples.length * 2 // Int16
  const buf = new ArrayBuffer(HEADER_SIZE + payloadBytes)
  const dv = new DataView(buf)
  dv.setUint32(0, MAGIC, true)
  dv.setUint8(4, PROTOCOL_VERSION)
  dv.setUint8(5, frame.track)
  dv.setUint8(6, CODEC_INT16)
  dv.setUint8(7, 0)
  dv.setUint32(8, frame.seq >>> 0, true)
  dv.setFloat64(12, frame.tsMs, true)
  dv.setUint32(20, frame.sampleRate, true)
  const pcm = new Int16Array(buf, HEADER_SIZE)
  for (let i = 0; i < frame.samples.length; i++) {
    let s = frame.samples[i]
    if (s > 1) s = 1
    else if (s < -1) s = -1
    pcm[i] = (s * 32767) | 0
  }
  return buf
}

export function decodeFrame(buf: ArrayBuffer): AudioFrame | null {
  if (buf.byteLength < HEADER_SIZE + 4) return null
  const dv = new DataView(buf)
  if (dv.getUint32(0, true) !== MAGIC) return null
  const version = dv.getUint8(4)
  if (version !== PROTOCOL_VERSION) return null
  const track = dv.getUint8(5)
  const codec = dv.getUint8(6)
  const seq = dv.getUint32(8, true)
  const tsMs = dv.getFloat64(12, true)
  const sampleRate = dv.getUint32(20, true)
  const body = buf.slice(HEADER_SIZE)
  let samples: Float32Array
  if (codec === CODEC_INT16) {
    const raw = new Int16Array(body)
    samples = new Float32Array(raw.length)
    for (let i = 0; i < raw.length; i++) samples[i] = raw[i] / 32768
  } else {
    samples = new Float32Array(body)
  }
  return { track, seq, tsMs, sampleRate, samples }
}

export const RELAY_URL = '/?XTransformPort=3003'

export function makeSessionCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
  return s
}
