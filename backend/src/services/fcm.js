// Firebase Cloud Messaging (HTTP v1) sender for the Pakka Rider Android app, without extra libraries.
// Switched on only when a service-account key exists: FCM_SERVICE_ACCOUNT_FILE, or SECRETS_DIR/fcm-service-account.json.
// The key never leaves the server. Messages are "data" messages: the app shows them itself on its own
// ringing channel, so offers ring even when the app was closed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

let sa = null, token = null, tokenExp = 0;
export function loadFcm(file) {
  try { if (!file || !fs.existsSync(file)) return false; const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!j.project_id || !j.client_email || !j.private_key) return false; sa = j; return true; } catch { sa = null; return false; }
}
export const fcmFile = (env, secretsDir) => env.FCM_SERVICE_ACCOUNT_FILE || (secretsDir ? path.join(secretsDir, 'fcm-service-account.json') : '');
export const fcmEnabled = () => !!sa;

const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
async function accessToken() {
  if (token && Date.now() < tokenExp - 60_000) return token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = b64u(crypto.createSign('RSA-SHA256').update(`${head}.${claim}`).sign(sa.private_key));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }) });
  if (!r.ok) { const e = new Error('fcm auth ' + r.status); e.statusCode = 503; throw e; }
  const j = await r.json(); token = j.access_token; tokenExp = Date.now() + (j.expires_in || 3600) * 1000; return token;
}

// Same shape as the Web Push sender: throws with statusCode 410 when the device token is no longer valid.
export async function sendFcm(sub, payloadJson) {
  const p = JSON.parse(payloadJson);
  const data = Object.fromEntries(Object.entries({ title: p.title, body: p.body, url: p.url, kind: p.kind, tag: p.tag, urgent: p.urgent ? '1' : '0', nid: p.nid }).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, { method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { token: sub.endpoint, data, android: { priority: 'HIGH', ttl: '3600s' } } }) });
  if (r.ok) return;
  const t = await r.text().catch(() => ''); const e = new Error('fcm ' + r.status);
  e.statusCode = r.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(t) || (r.status === 400 && /INVALID_ARGUMENT/.test(t) && /token/i.test(t)) ? 410 : r.status;
  throw e;
}
