// RFC 6238 TOTP (SHA-1, 6 digits, 30 s) with no external dependency. Secrets are encrypted at rest (AES-256-GCM).
import crypto from 'node:crypto';
import { config } from './config.js';

const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const b32 = (buf) => { let bits = '', out = ''; for (const b of buf) bits += b.toString(2).padStart(8, '0'); for (let i = 0; i < bits.length; i += 5) out += A[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return out; };
const unb32 = (s) => { let bits = ''; for (const c of s.replace(/=+$/, '')) bits += A.indexOf(c).toString(2).padStart(5, '0'); const o = []; for (let i = 0; i + 8 <= bits.length; i += 8) o.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(o); };
const key = () => crypto.createHash('sha256').update(`mfa:${config.jwtSecret}`).digest();
export const encrypt = (txt) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv); const d = Buffer.concat([c.update(txt, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), d]).toString('base64'); };
export const decrypt = (b64) => { const r = Buffer.from(b64, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', key(), r.subarray(0, 12)); d.setAuthTag(r.subarray(12, 28)); return Buffer.concat([d.update(r.subarray(28)), d.final()]).toString('utf8'); };
export const newSecret = () => b32(crypto.randomBytes(20));
const hotp = (secret, counter) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(counter)); const h = crypto.createHmac('sha1', unb32(secret)).update(b).digest(); const o = h[19] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0'); };
export const codeAt = (secret, t = Date.now()) => hotp(secret, Math.floor(t / 30000));
// returns the matched time-step (so the caller can refuse replays) or null
export const verifyTotp = (secret, code, t = Date.now()) => { if (!/^\d{6}$/.test(String(code))) return null; const step = Math.floor(t / 30000);
  for (const d of [0, -1, 1]) if (crypto.timingSafeEqual(Buffer.from(hotp(secret, step + d)), Buffer.from(String(code)))) return step + d; return null; };
export const otpauthUri = (secret, account) => `otpauth://totp/Pakka%20Local:${encodeURIComponent(account)}?secret=${secret}&issuer=Pakka%20Local&algorithm=SHA1&digits=6&period=30`;
