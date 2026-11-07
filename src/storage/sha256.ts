import { BYTE_HEX } from './hex'

// SHA-256 per FIPS 180-4. Web Crypto only offers an async digest, and the proof of work
// needs a synchronous one it can call in a tight worker loop.

const BLOCK_BYTES = 64

// First 32 bits of the fractional parts of the cube roots of the first 64 primes.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

// First 32 bits of the fractional parts of the square roots of the first 8 primes.
const H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
])

// Message schedule, reused by every block (the hash is synchronous, so it is never shared).
const W = new Uint32Array(64)

// The proof of work hashes in a tight loop, so the hot path keeps one encoder, turns bytes into
// hex through a table (`toString(16)` cost more than the hash itself), and copies the state into
// locals (destructuring goes through the array iterator).
const encoder = new TextEncoder()

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))

function compress(state: Uint32Array, block: DataView, offset: number) {
  for (let t = 0; t < 16; t++) W[t] = block.getUint32(offset + t * 4)
  for (let t = 16; t < 64; t++) {
    const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3)
    const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10)
    W[t] = W[t - 16] + s0 + W[t - 7] + s1
  }

  let a = state[0], b = state[1], c = state[2], d = state[3], e = state[4], f = state[5], g = state[6], h = state[7]
  for (let t = 0; t < 64; t++) {
    const t1 = h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + W[t]
    const t2 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))
    h = g
    g = f
    f = e
    e = (d + t1) | 0
    d = c
    c = b
    b = a
    a = (t1 + t2) | 0
  }

  state[0] += a
  state[1] += b
  state[2] += c
  state[3] += d
  state[4] += e
  state[5] += f
  state[6] += g
  state[7] += h
}

/** SHA-256 of the UTF-8 encoding of `message`, as lowercase hex. */
export function sha256Hex(message: string): string {
  const data = encoder.encode(message)
  // Padding: 0x80, zeros, then the bit length as a 64-bit big-endian integer, filling the last block.
  const padded = new DataView(new ArrayBuffer(Math.ceil((data.length + 9) / BLOCK_BYTES) * BLOCK_BYTES))
  new Uint8Array(padded.buffer).set(data)
  padded.setUint8(data.length, 0x80)
  padded.setUint32(padded.byteLength - 8, Math.floor((data.length * 8) / 2 ** 32))
  padded.setUint32(padded.byteLength - 4, (data.length * 8) >>> 0)

  const state = H0.slice()
  for (let offset = 0; offset < padded.byteLength; offset += BLOCK_BYTES) compress(state, padded, offset)
  let hex = ''
  for (const word of state) hex += BYTE_HEX[word >>> 24] + BYTE_HEX[(word >>> 16) & 0xff] + BYTE_HEX[(word >>> 8) & 0xff] + BYTE_HEX[word & 0xff]
  return hex
}
