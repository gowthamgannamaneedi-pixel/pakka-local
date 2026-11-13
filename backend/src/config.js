import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import crypto from 'node:crypto';
import webpush from 'web-push';
const env = process.env;
const isProd = env.NODE_ENV === 'production';
const isTest = env.NODE_ENV === 'test';

// SECRETS_DIR: a private folder (outside the app) where secrets are created on first start and kept, so nobody has to
// type or paste them anywhere (hosting panels without SSH). Values set in the environment always win.
const secretsDir = (env.SECRETS_DIR || '').trim();
// the code folder: replaced on every deployment on hosts such as Hostinger, so data and secrets must never live in it
const codeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const inside = (p) => { const r = path.relative(codeRoot, path.resolve(p)); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
if (isProd && secretsDir && inside(secretsDir)) throw new Error(`SECRETS_DIR (${secretsDir}) is inside the app folder, which is replaced on every deployment. Point it to a folder outside the app, e.g. /home/USER/pakka-data.`);
function fileSecret(name, make) {
  if (!secretsDir) return null;
  const f = path.join(secretsDir, name);
  try { return fs.readFileSync(f, 'utf8').trim(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  const v = make(); fs.writeFileSync(f, v + '\n', { mode: 0o600, flag: 'wx' }); return v;
}
if (!env.JWT_SECRET && secretsDir) env.JWT_SECRET = fileSecret('jwt-secret', () => crypto.randomBytes(48).toString('base64'));
if (!env.VAPID_PUBLIC_KEY && !env.VAPID_PRIVATE_KEY && secretsDir) {
  const k = JSON.parse(fileSecret('vapid.json', () => JSON.stringify(webpush.generateVAPIDKeys())));
  env.VAPID_PUBLIC_KEY = k.publicKey; env.VAPID_PRIVATE_KEY = k.privateKey;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// "a@x.com=+919876543210, b@y.com=9876543211" -> Map(email -> +91 phone). Malformed entries stop the app (never silently skipped).
function parseEmailAllow(v) {
  const m = new Map();
  for (const part of v.split(',').map((x) => x.trim()).filter(Boolean)) {
    const [email, phone] = part.split('=').map((x) => (x || '').trim());
    const ph = /^\d{10}$/.test(phone) ? '+91' + phone : phone;
    if (!EMAIL_RE.test(email || '') || !/^\+91[6-9]\d{9}$/.test(ph || '')) throw new Error('EMAIL_OTP_ALLOWLIST entries must look like tester@example.com=+91XXXXXXXXXX');
    m.set(email.toLowerCase(), ph);
  }
  return m;
}

function required(name) {
  const v = env[name];
  if (!v && isProd) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

// APP_ENV separates a real production deployment from a staging one (hosts usually run both with NODE_ENV=production).
const appEnv = env.APP_ENV || (isProd ? 'production' : isTest ? 'test' : 'development');
if (!['production', 'staging', 'development', 'test'].includes(appEnv)) throw new Error('APP_ENV must be production, staging, development or test');
if (appEnv !== 'production' && isProd && appEnv !== 'staging') throw new Error('With NODE_ENV=production, APP_ENV must be production or staging');

export const config = {
  isProd, isTest, appEnv, secretsDir,
  port: Number(env.PORT || 8080),
  dbPath: env.DB_PATH || (isProd ? '/var/data/pakka-local.sqlite' : './data/pakka-local.sqlite'),
  backupDir: env.BACKUP_DIR || (isProd ? '/var/data/backups' : './data/backups'),
  backupKeep: Math.max(1, Number(env.BACKUP_KEEP || 14)),
  // proxies in front of the app (Hostinger: its web server; add 1 if a CDN sits in front). Used for client IPs in rate limits.
  trustProxy: env.TRUST_PROXY === undefined ? 1 : /^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY,
  jwtSecret: required('JWT_SECRET') || (isTest ? 'test-secret-test-secret-test-secret!' : (() => { throw new Error('JWT_SECRET required'); })()),
  allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  staffTokenTtl: '12h',
  customerTokenTtl: '30d',
  otp: { ttlMs: 5 * 60_000, maxAttempts: 5, resendCooldownMs: 45_000 },
  uploadDir: env.UPLOAD_DIR || (isProd ? '/var/data/uploads' : './data/uploads'),
  // 'disabled' = no orders can be placed | 'sandbox' = simulated, never on production | 'phonepe' = reserved: the gateway is NOT integrated yet, so it behaves like 'disabled'
  paymentProvider: env.PAYMENT_PROVIDER || (isProd ? 'disabled' : 'sandbox'),
  sandboxPhones: (env.SANDBOX_PAYMENT_PHONES || '').split(',').map((x) => x.trim()).filter(Boolean),
  // Map tiles (Leaflet). Production must name a provider whose terms allow this use; public OSM tiles are for development only.
  // MAP_TILE_URL=none turns the map off on any environment (status text only), e.g. to check the no-provider fallback locally.
  map: { tileUrl: env.MAP_TILE_URL === 'none' ? '' : env.MAP_TILE_URL || (isProd ? '' : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'), attribution: env.MAP_TILE_ATTRIBUTION || '&copy; OpenStreetMap contributors' },
  // Road distance for distance-based delivery charges: a self-hosted OSRM engine (see docs/DISTANCE-PRICING.md). Empty = not set up.
  // OSRM_API_KEY: sent as X-Routing-Key when the engine sits behind a reverse proxy on another server (OSRM itself has no login).
  routing: { osrmUrl: (env.OSRM_URL || '').trim(), profile: env.OSRM_PROFILE || 'driving', timeoutMs: Number(env.OSRM_TIMEOUT_MS || 3000), apiKey: (env.OSRM_API_KEY || '').trim() },
  serveFrontend: env.SERVE_FRONTEND === 'true' || (!isProd && !isTest),
  vapid: { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || 'mailto:admin@pakkalocal.example' },
  publicApiUrl: (env.PUBLIC_API_URL || '').replace(/\/$/, ''),
  otpProvider: isTest ? 'test' : (env.OTP_PROVIDER || 'whatsapp'),
  testOtp: { code: env.TEST_OTP_CODE, phones: (env.TEST_OTP_PHONES || '').split(',').map((x) => x.trim()).filter(Boolean) },
  // STAGING-ONLY e-mail login for allow-listed testers (EMAIL_OTP_ALLOWLIST="tester@example.com=+919876543210,...":
  // each address signs in as that phone number's customer account). Refused on production; WhatsApp stays the real login.
  emailOtp: { requested: env.EMAIL_OTP_ENABLED === '1', allow: parseEmailAllow(env.EMAIL_OTP_ALLOWLIST || ''), provider: isTest ? 'test' : (env.EMAIL_PROVIDER || 'brevo'),
    apiUrl: env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email', apiKey: (env.BREVO_API_KEY || '').trim(), from: (env.EMAIL_FROM || '').trim(), fromName: env.EMAIL_FROM_NAME || 'Pakka Local (staging)',
    ttlMs: 5 * 60_000, maxAttempts: 5, resendCooldownMs: 60_000, perHour: 6 },
  whatsapp: {
    token: env.WHATSAPP_ACCESS_TOKEN, phoneId: env.WHATSAPP_PHONE_NUMBER_ID,
    template: env.WHATSAPP_OTP_TEMPLATE_NAME, apiVersion: env.WHATSAPP_API_VERSION || 'v21.0'
  }
};
if (isProd && config.otpProvider === 'testcode' && env.ALLOW_TEST_OTP !== '1') throw new Error('OTP_PROVIDER=testcode in production requires ALLOW_TEST_OTP=1 (pilot testing only)');
if (config.otpProvider === 'testcode' && !/^\d{6}$/.test(config.testOtp.code || '')) throw new Error('TEST_OTP_CODE must be 6 digits when OTP_PROVIDER=testcode');
if (isProd && config.otpProvider === 'test') throw new Error('OTP_PROVIDER=test is not allowed in production');
if (config.jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
if (!['disabled', 'sandbox', 'phonepe'].includes(config.paymentProvider)) throw new Error('PAYMENT_PROVIDER must be disabled, sandbox or phonepe');
// Simulated payments can never run on a production deployment. There is deliberately no override flag.
if (appEnv === 'production' && config.paymentProvider === 'sandbox') throw new Error('PAYMENT_PROVIDER=sandbox is not allowed in production. Use PAYMENT_PROVIDER=disabled until a real payment gateway is integrated.');
if (appEnv === 'staging' && config.paymentProvider === 'sandbox' && !config.sandboxPhones.length) throw new Error('Staging sandbox payments require SANDBOX_PAYMENT_PHONES (comma-separated tester phone numbers).');
config.sandboxPayments = config.paymentProvider === 'sandbox' && appEnv !== 'production';
// E-mail login is a staging test aid only: no override exists for production.
if (appEnv === 'production' && config.emailOtp.requested) throw new Error('EMAIL_OTP_ENABLED is for staging testing only and is refused when APP_ENV=production.');
if (config.emailOtp.requested && !config.emailOtp.allow.size) throw new Error('EMAIL_OTP_ENABLED=1 needs EMAIL_OTP_ALLOWLIST (tester emails).');
if (config.emailOtp.requested && config.emailOtp.provider === 'brevo' && !EMAIL_RE.test(config.emailOtp.from)) throw new Error('EMAIL_OTP_ENABLED=1 needs EMAIL_FROM (the sender address verified in Brevo).');
config.emailOtp.enabled = config.emailOtp.requested && appEnv !== 'production';

// Data must live outside the deployed code: hosts such as Hostinger replace the whole app folder on every deployment,
// which would silently delete the database, uploads and backups. Refused on production/staging; no override.
if (isProd) for (const [k, v] of [['DB_PATH', config.dbPath], ['UPLOAD_DIR', config.uploadDir], ['BACKUP_DIR', config.backupDir]])
  if (inside(v)) throw new Error(`${k} (${v}) is inside the app folder, which is replaced on every deployment. Point it to a folder outside the app, e.g. /home/USER/pakka-data.`);
// A routing engine on another machine must be reached over HTTPS (coordinates of customers travel in the URL).
if (isProd && config.routing.osrmUrl && !/^https:\/\//.test(config.routing.osrmUrl) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(config.routing.osrmUrl))
  throw new Error('OSRM_URL must use https:// unless the engine runs on the same machine (127.0.0.1).');
