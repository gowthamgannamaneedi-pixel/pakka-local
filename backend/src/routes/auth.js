import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config, EMAIL_RE } from '../config.js';
import { signToken, authenticate } from '../auth.js';
import { requestCode, checkCode, deliveryStatus } from '../services/loginOtp.js';
import { getEmailProvider } from '../emailProviders.js';
import { decrypt, verifyTotp } from '../totp.js';

const phoneSchema = z.string().trim().regex(/^\+?[1-9]\d{9,14}$/, 'Enter a valid mobile number');
const normPhone = (p) => (p.startsWith('+') ? p : p.length === 10 ? `+91${p}` : `+${p}`);
// A customer has a usable name unless it is empty or one of the placeholders we stored before names were required.
export const USERNAME_RE = /^[a-z][a-z0-9._]{3,31}$/;
export const needsName = (u) => u.role === 'customer' && (!u.name || !/\p{L}/u.test(u.name) || u.name.trim().length < 2 || u.name.trim().toLowerCase() === 'customer');
export const nameSchema = z.string().trim().min(2, 'Please enter your name.').max(60).regex(/\p{L}/u, 'Please enter your name.');
const limiter = (max, windowMs = 15 * 60_000) =>
  rateLimit({ windowMs, max: config.isTest ? 1000 : max, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many attempts. Please try again later.' } });

export function authRoutes(db) {
  const r = Router();
  const sessionOut = (u) => ({ token: signToken(u), user: { id: u.id, role: u.role, name: u.name, needs_name: needsName(u) } });

  // Staff login (restaurant / rider / admin). `portal` must match the account's role, so a
  // rider cannot obtain a session through the admin login form, and vice versa.
  r.post('/login', limiter(20), (req, res) => {
    // Admins may sign in with their username instead of the mobile number; every other check below is the same.
    const p = z.object({ portal: z.enum(['restaurant', 'rider', 'admin']), phone: z.string().trim().max(40).optional(), username: z.string().trim().toLowerCase().max(40).optional(),
      password: z.string().min(1).max(200), totp: z.string().max(10).optional() }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
    let id = p.data.username || p.data.phone || '';
    const asPhone = phoneSchema.safeParse(id.replace(/[\s-]/g, ''));
    let u;
    if (asPhone.success) u = db.prepare('SELECT * FROM users WHERE phone = ? AND role = ?').get(normPhone(asPhone.data), p.data.portal);      // the account of this portal's kind
    else if (p.data.portal === 'admin' && USERNAME_RE.test(id.toLowerCase())) u = db.prepare("SELECT * FROM users WHERE username = ? AND role = 'admin'").get(id.toLowerCase());
    else if (p.data.portal !== 'admin') return res.status(400).json({ error: 'Enter a valid mobile number' });
    const bad = () => res.status(401).json({ error: p.data.portal === 'admin' ? 'Incorrect username / mobile number or password.' : 'Incorrect mobile number or password.' });
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

  // Customer login with a WhatsApp code (separate from pickup / delivery codes). Rules live in services/loginOtp.js.
  const otpSend = (res, out) => (out.error ? res.status(out.status).json({ error: out.error, code: out.code, retryAfterSec: out.retryAfterSec }) : null);
  r.post('/customer/otp/request', limiter(10), async (req, res) => {
    const out = await requestCode(db, req.body?.phone); if (otpSend(res, out) !== null) return;
    res.json({ ok: true, resendAfterSec: out.resendAfterSec, expiresInSec: out.expiresInSec, channel: out.channel });   // never returns the code
  });
  // delivery state of the latest code (sent / delivered / read / failed), so the code screen can say if WhatsApp could not deliver it
  r.get('/customer/otp/status', limiter(120), async (req, res) => { try { res.json(await deliveryStatus(db, req.query.phone)); } catch { res.json({ status: 'unknown' }); } });
  r.post('/customer/otp/verify', limiter(20), (req, res) => {
    const p = z.object({ phone: z.string().max(20), otp: z.string().max(10), name: z.string().trim().min(1).max(80).optional() }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'Enter the 6-digit code.' });
    const ok = checkCode(db, p.data.phone, p.data.otp); if (otpSend(res, ok) !== null) return;
    const phone = ok.phone;
    const user = db.transaction(() => {
      let u = db.prepare("SELECT * FROM users WHERE phone = ? AND role = 'customer'").get(phone);
      if (!u) {                                                  // new customer: one account per number; the app then asks "What should we call you?"
        const nm = p.data.name && nameSchema.safeParse(p.data.name).success ? p.data.name.trim() : null;
        const id = db.prepare("INSERT INTO users (role, phone, name) VALUES ('customer', ?, ?)").run(phone, nm || '').lastInsertRowid;
        db.prepare('INSERT INTO customers (user_id) VALUES (?)').run(id);
        u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      }
      return u;
    })();
    if (user.role !== 'customer') return res.status(401).json({ error: 'That code is incorrect or has expired.' });      // staff numbers never log in here
    if (!user.active) return res.status(403).json({ error: 'This account has been deactivated. Contact support.' });
    res.json({ ...sessionOut(user), is_new: !user.name });
  });

  // ---- STAGING-ONLY e-mail login for allow-listed testers (WhatsApp OTP above stays the real customer login) ----
  // 6-digit code, 5-minute expiry, 5 attempts, 60 s resend wait, hashed, single use, per-IP and per-address limits.
  // Each allow-listed address signs in as the customer account of the phone number it is mapped to.
  const E = config.emailOtp, emailOff = (req, res, next) => (E.enabled ? next() : res.status(404).json({ error: 'Not found.' }));
  const emailSchema = z.string().trim().toLowerCase().max(200).regex(EMAIL_RE, 'Enter a valid email address');
  const hashEmailOtp = (email, otp) => crypto.createHmac('sha256', config.jwtSecret).update(`email:${email}:${otp}`).digest('hex');
  r.post('/customer/email-otp/request', emailOff, limiter(10), async (req, res) => {
    const p = z.object({ email: emailSchema }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
    const email = p.data.email;
    if (!E.allow.has(email)) return res.status(403).json({ error: 'This email is not enabled for staging test login.' });
    const recent = db.prepare('SELECT created_at FROM email_otp_challenges WHERE email = ? AND created_at > ? ORDER BY id DESC').all(email, new Date(Date.now() - 3600_000).toISOString());
    if (recent[0] && Date.now() - Date.parse(recent[0].created_at) < E.resendCooldownMs) return res.status(429).json({ error: 'Please wait a minute before requesting another code.' });
    if (recent.length >= E.perHour) return res.status(429).json({ error: 'Too many codes for this email. Try again in an hour.' });
    const prov = getEmailProvider(); if (!prov) return res.status(503).json({ error: 'Email login is not available.' });
    const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    db.prepare('UPDATE email_otp_challenges SET used = 1 WHERE email = ? AND used = 0').run(email);      // only the newest code works
    const id = db.prepare('INSERT INTO email_otp_challenges (email, otp_hash, expires_at) VALUES (?,?,?)')
      .run(email, hashEmailOtp(email, otp), new Date(Date.now() + E.ttlMs).toISOString()).lastInsertRowid;
    try { await prov.send(email, otp); }
    catch (e) {
      db.prepare('UPDATE email_otp_challenges SET used = 1 WHERE id = ?').run(id);
      console.error('Email OTP delivery failed:', e.message);
      return res.status(502).json({ error: 'We could not send the email. Please try again.' });
    }
    res.json({ ok: true, resendAfterSec: E.resendCooldownMs / 1000 });      // never returns the code
  });
  r.post('/customer/email-otp/verify', emailOff, limiter(20), (req, res) => {
    const p = z.object({ email: emailSchema, otp: z.string().regex(/^\d{6}$/), name: z.string().trim().min(1).max(80).optional() }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'Enter the 6-digit code.' });
    const email = p.data.email, phone = E.allow.get(email);
    const fail = () => res.status(401).json({ error: 'That code is incorrect or has expired.' });
    if (!phone) return fail();
    const ch = db.prepare('SELECT * FROM email_otp_challenges WHERE email = ? AND used = 0 ORDER BY id DESC LIMIT 1').get(email);
    if (!ch || ch.expires_at < new Date().toISOString() || ch.attempts >= E.maxAttempts) return fail();
    db.prepare('UPDATE email_otp_challenges SET attempts = attempts + 1 WHERE id = ?').run(ch.id);
    if (!crypto.timingSafeEqual(Buffer.from(ch.otp_hash), Buffer.from(hashEmailOtp(email, p.data.otp)))) return fail();
    const user = db.transaction(() => {
      if (db.prepare('UPDATE email_otp_challenges SET used = 1 WHERE id = ? AND used = 0').run(ch.id).changes !== 1) return null;   // single use
      let u = db.prepare("SELECT * FROM users WHERE phone = ? AND role = 'customer'").get(phone);
      if (!u) {
        const id = db.prepare("INSERT INTO users (role, phone, name) VALUES ('customer', ?, ?)").run(phone, p.data.name || 'Test customer').lastInsertRowid;
        db.prepare('INSERT INTO customers (user_id) VALUES (?)').run(id);
        u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      }
      return u;
    })();
    if (!user || user.role !== 'customer') return fail();      // a staff phone can never be reached through e-mail login
    if (!user.active) return res.status(403).json({ error: 'This account has been deactivated. Contact support.' });
    res.json(sessionOut(user));
  });

  r.get('/me', authenticate(db), (req, res) => res.json({ user: { id: req.user.id, role: req.user.role, name: req.user.name, needs_name: needsName(req.user) } }));
  // "What should we call you?" — customers set or change their own name.
  r.post('/name', authenticate(db), limiter(30), (req, res) => {
    if (req.user.role !== 'customer') return res.status(403).json({ error: 'Not allowed.' });
    const p = nameSchema.safeParse(req.body?.name); if (!p.success) return res.status(400).json({ error: p.error.issues[0].message });
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(p.data, req.user.id);
    res.json({ ok: true, user: { id: req.user.id, role: 'customer', name: p.data, needs_name: false } });
  });
  // Revokes every session of this user on all devices.
  r.post('/logout-all', authenticate(db), (req, res) => {
    db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(req.user.id);
    res.json({ ok: true });
  });
  return r;
}
