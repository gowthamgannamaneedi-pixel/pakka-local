import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { signToken, authenticate } from '../auth.js';
import { getOtpProvider } from '../otpProviders.js';
import { decrypt, verifyTotp } from '../totp.js';

const phoneSchema = z.string().trim().regex(/^\+?[1-9]\d{9,14}$/, 'Enter a valid mobile number');
const normPhone = (p) => (p.startsWith('+') ? p : p.length === 10 ? `+91${p}` : `+${p}`);
const hashOtp = (phone, otp) => crypto.createHmac('sha256', config.jwtSecret).update(`${phone}:${otp}`).digest('hex');
const limiter = (max, windowMs = 15 * 60_000) =>
  rateLimit({ windowMs, max: config.isTest ? 1000 : max, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many attempts. Please try again later.' } });

export function authRoutes(db) {
  const r = Router();
  const sessionOut = (u) => ({ token: signToken(u), user: { id: u.id, role: u.role, name: u.name } });

  // Staff login (restaurant / rider / admin). `portal` must match the account's role, so a
  // rider cannot obtain a session through the admin login form, and vice versa.
  r.post('/login', limiter(20), (req, res) => {
    const p = z.object({ portal: z.enum(['restaurant', 'rider', 'admin']), phone: phoneSchema,
      password: z.string().min(1).max(200), totp: z.string().max(10).optional() }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
    const phone = normPhone(p.data.phone);
    const u = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
    const bad = () => res.status(401).json({ error: 'Incorrect mobile number or password.' });
    if (!u || u.role !== p.data.portal || !u.password_hash) { bcrypt.compareSync(p.data.password, '$2a$12$' + 'x'.repeat(53)); return bad(); }
    if (u.locked_until && u.locked_until > new Date().toISOString())
      return res.status(429).json({ error: 'Account temporarily locked. Try again in a few minutes.' });
    if (!bcrypt.compareSync(p.data.password, u.password_hash)) {
      const fails = u.failed_logins + 1;
      const lock = fails >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
      db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : fails, lock, u.id);
      return bad();
    }
    if (!u.active) return res.status(403).json({ error: 'This account has been deactivated. Contact support.' });
    if (u.mfa_enabled) {                                        // second factor (admins who turned it on)
      if (!p.data.totp) return res.status(401).json({ error: 'Enter the 6-digit code from your authenticator app.', code: 'MFA_REQUIRED' });
      const step = verifyTotp(decrypt(u.mfa_secret), p.data.totp);
      if (step === null || step <= u.mfa_last_step) {           // wrong code, or a code that was already used (replay)
        const fails = u.failed_logins + 1, lock = fails >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
        db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : fails, lock, u.id);
        return res.status(401).json({ error: 'That code is incorrect or has expired.', code: 'MFA_REQUIRED' });
      }
      db.prepare('UPDATE users SET mfa_last_step = ? WHERE id = ?').run(step, u.id);
    }
    db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(u.id);
    res.json(sessionOut(u));
  });

  // Customer login OTP (separate from pickup / delivery OTPs).
  r.post('/customer/otp/request', limiter(10), async (req, res) => {
    const p = z.object({ phone: phoneSchema }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
    const phone = normPhone(p.data.phone);
    const last = db.prepare('SELECT created_at FROM otp_challenges WHERE phone = ? ORDER BY id DESC LIMIT 1').get(phone);
    if (last && Date.now() - Date.parse(last.created_at) < config.otp.resendCooldownMs)
      return res.status(429).json({ error: 'Please wait a few seconds before requesting another code.' });
    const prov = getOtpProvider();
    let otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    if (prov.fixedFor) { otp = prov.fixedFor(phone); if (!otp) return res.status(403).json({ error: 'This number is not enabled for test login.' }); }
    const id = db.prepare('INSERT INTO otp_challenges (phone, otp_hash, expires_at) VALUES (?,?,?)')
      .run(phone, hashOtp(phone, otp), new Date(Date.now() + config.otp.ttlMs).toISOString()).lastInsertRowid;
    try { await prov.send(phone, otp); }
    catch (e) {
      db.prepare('UPDATE otp_challenges SET used = 1 WHERE id = ?').run(id);
      console.error('OTP delivery failed:', e.message);
      return res.status(502).json({ error: 'We could not send the code. Please try again.' });
    }
    res.json({ ok: true, resendAfterSec: config.otp.resendCooldownMs / 1000 });   // never returns the OTP
  });

  r.post('/customer/otp/verify', limiter(20), (req, res) => {
    const p = z.object({ phone: phoneSchema, otp: z.string().regex(/^\d{6}$/), name: z.string().trim().min(1).max(80).optional() }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'Enter the 6-digit code.' });
    const phone = normPhone(p.data.phone);
    const fail = () => res.status(401).json({ error: 'That code is incorrect or has expired.' });
    const ch = db.prepare('SELECT * FROM otp_challenges WHERE phone = ? AND used = 0 ORDER BY id DESC LIMIT 1').get(phone);
    if (!ch || ch.expires_at < new Date().toISOString() || ch.attempts >= config.otp.maxAttempts) return fail();
    db.prepare('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?').run(ch.id);
    const a = Buffer.from(ch.otp_hash), b = Buffer.from(hashOtp(phone, p.data.otp));
    if (!crypto.timingSafeEqual(a, b)) return fail();
    const user = db.transaction(() => {
      // single-use: only one verifier can flip used 0 -> 1
      if (db.prepare('UPDATE otp_challenges SET used = 1 WHERE id = ? AND used = 0').run(ch.id).changes !== 1) return null;
      let u = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
      if (!u) {
        const id = db.prepare("INSERT INTO users (role, phone, name) VALUES ('customer', ?, ?)").run(phone, p.data.name || 'Customer').lastInsertRowid;
        db.prepare('INSERT INTO customers (user_id) VALUES (?)').run(id);
        u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      }
      return u;
    })();
    if (!user || user.role !== 'customer') return fail();
    if (!user.active) return res.status(403).json({ error: 'This account has been deactivated. Contact support.' });
    res.json(sessionOut(user));
  });


  r.get('/me', authenticate(db), (req, res) => res.json({ user: { id: req.user.id, role: req.user.role, name: req.user.name } }));
  // Revokes every session of this user on all devices.
  r.post('/logout-all', authenticate(db), (req, res) => {
    db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(req.user.id);
    res.json({ ok: true });
  });
  return r;
}
