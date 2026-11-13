import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { decrypt, verifyTotp } from './totp.js';

export const signToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role, tv: user.token_version }, config.jwtSecret,
    { expiresIn: user.role === 'customer' ? config.customerTokenTtl : config.staffTokenTtl, algorithm: 'HS256' });

// Verifies signature, loads the user from the DB on EVERY request (so deactivation / logout-all
// take effect immediately) and checks the token's role matches the stored role.
export const authenticate = (db) => (req, res, next) => {
  const h = req.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please sign in to continue.' });
  try {
    const p = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    const user = db.prepare('SELECT id, role, name, phone, active, token_version FROM users WHERE id = ?').get(p.sub);
    if (!user || !user.active || user.token_version !== p.tv || user.role !== p.role)
      return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    req.user = user;
    next();
  } catch { res.status(401).json({ error: 'Your session has expired. Please sign in again.' }); }
};

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role) ? next() : res.status(403).json({ error: 'You do not have access to this resource.' });

// Fresh authentication for exceptional / sensitive admin actions: the admin re-enters their password (and their
// authenticator code when MFA is on) in the same request. Wrong attempts are audited. The values are never stored.
export const requireFreshAuth = (db) => (req, res, next) => {
  const pw = req.body?.reauth_password, code = req.body?.reauth_totp;
  const u = db.prepare('SELECT password_hash, mfa_enabled, mfa_secret, mfa_last_step FROM users WHERE id=?').get(req.user.id);
  const fail = (msg, codeName) => { audit(db, req, 'auth.reauth_failed', 'user', req.user.id, { path: req.originalUrl }); return res.status(401).json({ error: msg, code: codeName }); };
  if (typeof pw !== 'string' || !pw) return res.status(401).json({ error: 'Confirm your password to continue.', code: 'REAUTH_REQUIRED' });
  if (!u || !bcrypt.compareSync(pw, u.password_hash)) return fail('Password is incorrect.', 'REAUTH_FAILED');
  if (u.mfa_enabled) {
    if (!code) return res.status(401).json({ error: 'Enter the 6-digit code from your authenticator app.', code: 'REAUTH_MFA_REQUIRED' });
    const step = verifyTotp(decrypt(u.mfa_secret), String(code));
    if (step === null || step <= u.mfa_last_step) return fail('That code is not valid.', 'REAUTH_FAILED');
    db.prepare('UPDATE users SET mfa_last_step=? WHERE id=?').run(step, req.user.id);
  }
  delete req.body.reauth_password; delete req.body.reauth_totp; next();
};

export const audit = (db, req, action, targetType, targetId, metadata) =>
  db.prepare(`INSERT INTO audit_logs (actor_user_id, actor_role, action, target_type, target_id, metadata, ip)
    VALUES (?,?,?,?,?,?,?)`).run(req.user?.id ?? null, req.user?.role ?? null, action, targetType ?? null,
    targetId == null ? null : String(targetId), metadata ? JSON.stringify(metadata) : null, req.ip);
