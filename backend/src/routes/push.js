import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate } from '../auth.js';
import { config } from '../config.js';
import { pushEnabled, verifyClick } from '../services/push.js';
import { parse } from './util.js';

export function pushRoutes(db) {
  const r = Router(), auth = authenticate(db);
  const lim = rateLimit({ windowMs: 60_000, max: config.isTest ? 1000 : 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests.' } });
  r.get('/key', (req, res) => res.json({ enabled: pushEnabled(), publicKey: pushEnabled() ? config.vapid.publicKey || null : null }));
  r.post('/subscribe', lim, auth, (req, res) => {
    const d = parse(z.object({ endpoint: z.string().url().max(600).startsWith('https://'), keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(6).max(100) }), label: z.string().max(60).optional() }), req, res); if (!d) return;
    db.transaction(() => {
      db.prepare(`INSERT INTO push_subscriptions (user_id,endpoint,keys_json,device_label) VALUES (?,?,?,?)
        ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, keys_json=excluded.keys_json, device_label=excluded.device_label, failures=0`).run(req.user.id, d.endpoint, JSON.stringify(d.keys), d.label ?? null);
      const extra = db.prepare('SELECT id FROM push_subscriptions WHERE user_id=? ORDER BY id DESC LIMIT -1 OFFSET 8').pluck().all(req.user.id);      // keep the 8 newest devices
      for (const id of extra) db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(id);
    })();
    res.status(201).json({ ok: true });
  });
  r.post('/unsubscribe', lim, auth, (req, res) => {
    const d = parse(z.object({ endpoint: z.string().max(600) }), req, res); if (!d) return;
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?').run(d.endpoint, req.user.id); res.json({ ok: true });     // only your own devices
  });
  // Sends a real push to the caller's own devices so staff can check a phone or tablet end to end.
  r.post('/test', lim, auth, (req, res) => {
    const devices = db.prepare('SELECT COUNT(*) FROM push_subscriptions WHERE user_id=?').pluck().get(req.user.id);
    if (!pushEnabled()) return res.status(503).json({ error: 'Notifications are not switched on for this server yet.' });
    if (!devices) return res.status(409).json({ error: 'This account has no device with notifications enabled.' });
    const link = { customer: '/user/', restaurant: '/restaurant/#/orders', rider: '/rider/#/jobs', admin: '/admin/' }[req.user.role];
    db.prepare("INSERT INTO notifications (event_id,user_id,category,title,body,deep_link,kind) VALUES (?,?,'transactional','Pakka Local test','Notifications are working on this device.',?,'test')").run(`test:${req.user.id}:${Date.now()}`, req.user.id, link);
    res.status(202).json({ queued: true, devices });
  });
  r.get('/devices', auth, (req, res) => res.json({ devices: db.prepare('SELECT id,device_label,created_at FROM push_subscriptions WHERE user_id=?').all(req.user.id) }));
  // click tracking: called by the service worker, authenticated by a signed per-notification token
  r.post('/click', lim, (req, res) => {
    const nid = Number(req.body?.nid);
    if (!Number.isInteger(nid) || !verifyClick(nid, req.body?.t)) return res.status(400).json({ error: 'Invalid request.' });
    db.prepare('UPDATE notifications SET clicked_at=COALESCE(clicked_at, ?) WHERE id=?').run(new Date().toISOString(), nid); res.json({ ok: true });
  });
  return r;
}
