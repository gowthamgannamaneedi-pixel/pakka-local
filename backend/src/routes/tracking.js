import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, requireRole } from '../auth.js';
import { config } from '../config.js';
import { recordLocation, customerView, adminActive, stopSharing, LIVE_SEC, STALE_SEC, SEND_EVERY_MS } from '../services/tracking.js';
import { send, wrap } from './util.js';

// Mounted at /api/tracking. Kept in its own router so Priority 2 does not touch the rider / customer / admin route files.
export function trackingRoutes(db) {
  const r = Router(), auth = authenticate(db);
  const lim = rateLimit({ windowMs: 60_000, max: config.isTest ? 100000 : 40, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `trk:${req.user?.id ?? req.ip}`, message: { error: 'Too many location updates.', code: 'TOO_FREQUENT' } });
  r.use((req, res, next) => { res.set('Cache-Control', 'no-store, private'); res.set('Pragma', 'no-cache'); next(); });      // positions must never be cached by browsers or proxies (also applies to 401/403 replies)
  r.get('/config', auth, (req, res) => res.json({ tile_url: config.map.tileUrl || null, attribution: config.map.attribution, live_sec: LIVE_SEC, stale_sec: STALE_SEC, send_every_ms: SEND_EVERY_MS }));
  // the rider's own position; ownership comes from the session, never from the request body
  r.post('/rider/location', auth, requireRole('rider'), lim, wrap((req, res) => { const out = recordLocation(db, req.user.id, req.body || {}); out.error ? res.status(out.status).json({ error: out.error, code: out.code, tracking: out.code === 'NOT_TRACKING' ? false : undefined, retry_ms: out.retry_ms }) : res.json(out); }));
  r.post('/rider/stop', auth, requireRole('rider'), wrap((req, res) => res.json(stopSharing(db, req.user.id))));
  r.get('/orders/:code', auth, requireRole('customer'), wrap((req, res) => send(res, customerView(db, req.user.id, req.params.code))));
  r.get('/admin/active', auth, requireRole('admin'), wrap((req, res) => res.json({ deliveries: adminActive(db), live_sec: LIVE_SEC, stale_sec: STALE_SEC })));
  return r;
}
