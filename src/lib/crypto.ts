import { createHash, randomBytes, scryptSync, timingSafeEqual, createHmac } from 'crypto'

// sha256 hex digest (lowercase) — the canonical digest format across the
// product, matching the on-chain commitment format.
export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex')
}

export function isValidDigest(d: string | null | undefined): boolean {
  return !!d && /^[0-9a-f]{64}$/.test(d)
}

export function isValidGnoAddress(a: string | null | undefined): boolean {
  if (!a) return false
  if (!a.startsWith('g1')) return false
  if (a.length < 10 || a.length > 64) return false
  return /^[a-z0-9]+$/.test(a)
}

// scrypt password hashing (memory-hard; salted; constant-time compare)
const SCRYPT_N = 16384, SCRYPT_r = 8, SCRYPT_p = 1, KEYLEN = 64

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p })
  return `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString('hex')}$${key.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, n, r, p, saltHex, keyHex] = stored.split('$')
    if (scheme !== 'scrypt') return false
    const key = scryptSync(password, Buffer.from(saltHex, 'hex'), keyHex.length / 2, {
      N: parseInt(n), r: parseInt(r), p: parseInt(p),
    })
    return timingSafeEqual(key, Buffer.from(keyHex, 'hex'))
  } catch {
    return false
  }
}

export function passwordStrength(pw: string): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  if (pw.length < 10) problems.push('at least 10 characters')
  if (!/[a-z]/.test(pw)) problems.push('a lowercase letter')
  if (!/[A-Z]/.test(pw)) problems.push('an uppercase letter')
  if (!/[0-9]/.test(pw)) problems.push('a digit')
  return { ok: problems.length === 0, problems }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function sha256Token(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// HMAC webhook signature: hex hmac-sha256 over `${timestamp}.${body}`
export function webhookSignature(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

// TOTP (RFC 6238) for MFA — base32 secret, 6 digits, 30s step
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function generateTotpSecret(): string {
  const buf = randomBytes(20)
  let bits = ''
  for (const byte of buf) bits += byte.toString(2).padStart(8, '0')
  let out = ''
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)]
  return out
}

function base32Decode(s: string): Buffer {
  let bits = ''
  for (const ch of s.toUpperCase().replace(/=+$/, '')) {
    const idx = B32.indexOf(ch)
    if (idx < 0) continue
    bits += idx.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

export function totpCode(secret: string, timeStepOffset = 0, at = Date.now()): string {
  const counter = Math.floor(at / 30000) + timeStepOffset
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  buf.writeUInt32BE(counter % 2 ** 32, 4)
  const hmac = createHmac('sha1', base32Decode(secret)).update(buf).digest()
  const off = hmac[hmac.length - 1] & 0x0f
  const code = ((hmac[off] & 0x7f) << 24 | hmac[off + 1] << 16 | hmac[off + 2] << 8 | hmac[off + 3]) % 1_000_000
  return code.toString().padStart(6, '0')
}

export function verifyTotp(secret: string, code: string): boolean {
  const now = Date.now()
  return totpCode(secret, -1, now) === code || totpCode(secret, 0, now) === code || totpCode(secret, 1, now) === code
}
