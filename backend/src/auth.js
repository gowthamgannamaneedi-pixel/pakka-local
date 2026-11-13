import jwt from 'jsonwebtoken';
import { config } from './config.js';

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

export const audit = (db, req, action, targetType, targetId, metadata) =>
  db.prepare(`INSERT INTO audit_logs (actor_user_id, actor_role, action, target_type, target_id, metadata, ip)
    VALUES (?,?,?,?,?,?,?)`).run(req.user?.id ?? null, req.user?.role ?? null, action, targetType ?? null,
    targetId == null ? null : String(targetId), metadata ? JSON.stringify(metadata) : null, req.ip);
