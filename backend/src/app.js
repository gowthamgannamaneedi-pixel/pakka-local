import fs from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { authRoutes } from './routes/auth.js';
import { publicRoutes, customerRoutes } from './routes/customer.js';
import { restaurantRoutes } from './routes/restaurant.js';
import { riderRoutes } from './routes/rider.js';
import { adminRoutes } from './routes/admin.js';
import { fileRoutes } from './routes/files.js';
import { pushRoutes } from './routes/push.js';
import { trackingRoutes } from './routes/tracking.js';

const BIG = /^\/api\/(restaurant\/(menu|me)|rider\/(documents|application\/documents)|admin\/cashouts\/\d+\/pay|admin\/campaigns)/;
const small = express.json({ limit: '100kb' }), big = express.json({ limit: '8mb' });

// CSP source for the configured tile host, e.g. https://{s}.example.com/... -> https://*.example.com
const tileSrc = (() => { try { const u = new URL(config.map.tileUrl.replace('{s}.', 'sub.')); return [`${u.protocol}//${config.map.tileUrl.includes('{s}.') ? u.host.replace(/^sub\./, '*.') : u.host}`]; } catch { return []; } })();

export function createApp(db) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'],
    imgSrc: ["'self'", 'data:', 'blob:', ...tileSrc], mediaSrc: ["'self'"], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"] } } }));
  app.use(cors({ origin: (o, cb) => cb(null, !o || config.allowedOrigins.includes(o)), allowedHeaders: ['Authorization', 'Content-Type'], maxAge: 600 }));
  if (!config.isTest) app.use('/api', rateLimit({ windowMs: 60_000, max: 600, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please slow down.' } }));
  app.use((req, res, next) => (req.method !== 'GET' && BIG.test(req.path + (req.baseUrl || '') ) ? big : small)(req, res, next));

  app.get('/healthz', (req, res) => { db.prepare('SELECT 1').get(); res.json({ ok: true }); });
  app.use('/api/auth', authRoutes(db));
  app.use('/api/public', publicRoutes(db));
  app.use('/api/customer', customerRoutes(db));
  app.use('/api/restaurant', restaurantRoutes(db));
  app.use('/api/rider', riderRoutes(db));
  app.use('/api/admin', adminRoutes(db));
  app.use('/api/files', fileRoutes(db));
  app.use('/api/push', pushRoutes(db));
  app.use('/api/tracking', trackingRoutes(db));
  app.use('/api/webhooks', (req, res) => res.status(501).json({ error: 'Payment webhooks are enabled when the PhonePe gateway is configured.' }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  if (config.serveFrontend) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/public');
    if (!config.isTest && !fs.existsSync(path.join(root, 'vendor/leaflet/leaflet.js'))) console.warn('Map library missing: run scripts/vendor-leaflet.sh before deploying. Tracking works, but maps show a notice instead.');
    if (config.isProd && !config.map.tileUrl) console.warn('MAP_TILE_URL is not set: tracking pages will show status without a map.');
    app.use(express.static(root, { index: false, setHeaders: (res, f) => { if (f.endsWith('sw.js')) res.set('Cache-Control', 'no-cache'); } }));
    app.get('/', (req, res) => res.redirect('/user/'));
    for (const p of ['user', 'restaurant', 'rider', 'admin']) app.get([`/${p}`, `/${p}/*`], (req, res, next) => /\.\w+$/.test(req.path) ? next() : res.sendFile(path.join(root, p, 'index.html')));
  }
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const tooBig = err.type === 'entity.too.large', bad = err.type === 'entity.parse.failed' || err instanceof URIError || err.status === 400 || err.statusCode === 400;
    if (!tooBig && !bad) console.error('Unhandled error:', err.message);
    res.status(tooBig ? 413 : bad ? 400 : 500).json({ error: tooBig ? 'That file is too large.' : bad ? 'Invalid request.' : 'Something went wrong. Please try again.' });
  });
  return app;
}
