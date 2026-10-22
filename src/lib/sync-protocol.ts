/**
 * Sync.audio — wire protocol shared by host and listeners.
 *
 * Audio frames are raw PCM Float32 (mono) with a compact binary header so the
 * relay can fan them out without parsing the payload.
 *
 * Header layout (little-endian), 24 bytes:
 *   0..3   magic  'S','Y','N','C'
 *   4      version (1)
 *   5      track id (0..3)
 *   6..7   reserved
 *   8..11  sequence number (uint32)
 *   12..19 capture timestamp, ms on the host session clock (float64)
 *   20..23 stream sample rate (uint32)
 */

export const HEADER_SIZE = 24
export const MAGIC = 0x53594e43 // 'SYNC'
export const PROTOCOL_VERSION = 1

export interface AudioFrame {
  track: number
  seq: number
  tsMs: number
  sampleRate: number
  samples: Float32Array
}

export function encodeFrame(frame: AudioFrame): ArrayBuffer {
  const payloadBytes = frame.samples.length * 4
  const buf = new ArrayBuffer(HEADER_SIZE + payloadBytes)
  const dv = new DataView(buf)
  dv.setUint32(0, MAGIC, true)
  dv.setUint8(4, PROTOCOL_VERSION)
  dv.setUint8(5, frame.track)
  dv.setUint16(6, 0, true)
  dv.setUint32(8, frame.seq >>> 0, true)
  dv.setFloat64(12, frame.tsMs, true)
  dv.setUint32(20, frame.sampleRate, true)
  new Float32Array(buf, HEADER_SIZE).set(frame.samples)
  return buf
}

export function decodeFrame(buf: ArrayBuffer): AudioFrame | null {
  if (buf.byteLength < HEADER_SIZE + 4) return null
  const dv = new DataView(buf)
  if (dv.getUint32(0, true) !== MAGIC) return null
  const version = dv.getUint8(4)
  if (version !== PROTOCOL_VERSION) return null
  const track = dv.getUint8(5)
  const seq = dv.getUint32(8, true)
  const tsMs = dv.getFloat64(12, true)
  const sampleRate = dv.getUint32(20, true)
  const samples = new Float32Array(buf.slice(HEADER_SIZE))
  return { track, seq, tsMs, sampleRate, samples }
}

export const RELAY_URL = '/?XTransformPort=3003'

export function makeSessionCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
  return s
}
