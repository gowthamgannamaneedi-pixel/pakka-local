import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { authenticate, audit } from '../auth.js';
import { DOCS } from '../services/riderApplication.js';

const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf' };
const NAME = /^[0-9a-f-]{36}\.(png|jpg|webp|pdf)$/;
export function fileRoutes(db) {
  const r = Router(), auth = authenticate(db);
  const sendFile = (res, scope, name) => {
    if (!NAME.test(name)) return res.status(404).end();
    const f = path.join(config.uploadDir, scope, name);
    if (!fs.existsSync(f)) return res.status(404).json({ error: 'File not found.' });
    res.set({ 'Content-Type': MIME[name.split('.').pop()], 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Cache-Control': scope === 'public' ? 'public, max-age=86400' : 'private, no-store' });
    fs.createReadStream(f).pipe(res);
  };
  r.get('/public/:name', (req, res) => sendFile(res, 'public', req.params.name));
  // Private files: proof of a cashout -> admin or the owning account only
  r.get('/proof/:cashoutId', auth, (req, res) => {
    const c = db.prepare('SELECT c.*, p.proof_path FROM cashout_requests c JOIN cashout_proofs p ON p.cashout_id=c.id WHERE c.id=?').get(req.params.cashoutId);
    const owner = c && ((c.account_type === 'rider' && req.user.role === 'rider' && c.account_id === req.user.id) ||
      (c.account_type === 'restaurant' && req.user.role === 'restaurant' && db.prepare('SELECT 1 FROM restaurant_users WHERE user_id=? AND restaurant_id=?').get(req.user.id, c.account_id)));
    if (!c || !(req.user.role === 'admin' || owner)) return res.status(404).json({ error: 'File not found.' });
    sendFile(res, 'private', c.proof_path);
  });
  // Rider identity documents -> admin or the rider themself
  r.get('/rider-doc/:riderId/:kind', auth, (req, res) => {
    const col = DOCS[req.params.kind];
    const id = Number(req.params.riderId);
    if (!col || !(req.user.role === 'admin' || (req.user.role === 'rider' && req.user.id === id))) return res.status(404).json({ error: 'File not found.' });
    const name = db.prepare(`SELECT ${col} FROM riders WHERE user_id=?`).pluck().get(id);
    if (name && req.user.role === 'admin' && req.params.kind !== 'photo') audit(db, req, 'rider.document_viewed', 'rider', id, { kind: req.params.kind });   // identity documents: every admin view is logged
    name ? sendFile(res, 'private', name) : res.status(404).json({ error: 'File not found.' });
  });
  // The customer of an order may see ONLY the rider's profile photo, and only after pickup
  r.get('/order-rider-photo/:code', auth, (req, res) => {
    const o = db.prepare("SELECT rider_id FROM orders WHERE order_code=? AND customer_id=? AND status IN ('PICKED_UP','DELIVERED')").get(req.params.code, req.user.id);
    const name = o && db.prepare('SELECT photo_path FROM riders WHERE user_id=?').pluck().get(o.rider_id);
    name ? sendFile(res, 'private', name) : res.status(404).json({ error: 'File not found.' });
  });
  return r;
}
