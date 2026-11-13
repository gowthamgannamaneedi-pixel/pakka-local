// Hosting readiness (Hostinger web apps): root entry package, cron job runner, backups, data-outside-app guard,
// API never cached, routing-engine key. All local; nothing is deployed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { runJobsOnce, backupIfDue } from '../src/jobs.js';
import { roadDistance, setRouter } from '../src/services/routing.js';

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), ROOT = path.resolve(BACKEND, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pl-host-'));

test('root package.json lists exactly the backend dependencies and starts the backend server', () => {
  const root = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')), be = JSON.parse(fs.readFileSync(path.join(BACKEND, 'package.json'), 'utf8'));
  assert.deepEqual(root.dependencies, be.dependencies, 'root and backend dependencies must match (update both together)');
  assert.equal(root.type, 'module'); assert.equal(root.main, 'server.js');
  assert.match(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'), /import '\.\/backend\/src\/server\.js'/);
  const rl = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')), bl = JSON.parse(fs.readFileSync(path.join(BACKEND, 'package-lock.json'), 'utf8'));
  for (const d of Object.keys(be.dependencies)) assert.equal(rl.packages[`node_modules/${d}`].version, bl.packages[`node_modules/${d}`].version, `${d}: lockfiles differ`);
});

test('one cron pass runs every task, makes a daily backup once and keeps only the newest backups', async () => {
  const db = openDb(':memory:'), dir = tmp();
  const r = await runJobsOnce(db, dir, { backupKeep: 3 });
  for (const k of ['reopened', 'payments_expired', 'campaigns', 'push', 'locations_purged', 'routes_purged', 'backup']) assert.ok(k in r, k);
  assert.notEqual(r.push, 'error'); assert.deepEqual(r.backup, { made: true, removed: 0 });
  assert.deepEqual((await runJobsOnce(db, dir, { backupKeep: 3 })).backup, { made: false, removed: 0 }, 'second pass within 24 h: no new backup');
  // five old backups: the next due backup keeps only the newest three
  for (let i = 0; i < 5; i++) { const f = path.join(dir, `pakka-local-2020-01-0${i + 1}.sqlite`); fs.writeFileSync(f, 'x'); fs.utimesSync(f, new Date(2020, 0, i + 1), new Date(2020, 0, i + 1)); }
  const b = await backupIfDue(db, dir, { everyHours: 24, keep: 3, now: Date.now() + 2 * 864e5 });
  assert.ok(b.made); const left = fs.readdirSync(dir).filter((f) => f.endsWith('.sqlite')).sort();
  assert.equal(left.length, 3); assert.ok(!left.includes('pakka-local-2020-01-01.sqlite'));
  // the backup is a real, readable copy of the database
  const copy = openDb(b.made); assert.ok(copy.prepare('SELECT COUNT(*) FROM schema_migrations').pluck().get() > 0); copy.close();
});

test('the cron script runs once with an env file and prints a summary without personal data', () => {
  const dir = tmp(), envFile = path.join(dir, 'app.env');
  fs.writeFileSync(envFile, `NODE_ENV=production\nAPP_ENV=staging\nJWT_SECRET=${'s'.repeat(40)}\nPAYMENT_PROVIDER=disabled\nOTP_PROVIDER=whatsapp\nDB_PATH=${path.join(dir, 'db', 'p.sqlite')}\nUPLOAD_DIR=${path.join(dir, 'up')}\nBACKUP_DIR=${path.join(dir, 'bk')}\n`);
  const r = spawnSync(process.execPath, [`--env-file=${envFile}`, path.join(BACKEND, 'scripts', 'run-jobs.js')], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /jobs \{.*"backup":\{"made":true/);
  assert.equal(fs.readdirSync(path.join(dir, 'bk')).length, 1);
});

test('production refuses a database, uploads or backups folder inside the app folder (wiped on redeploy)', () => {
  const out = tmp();   // run outside the project so no local .env is read
  const run = (extra) => spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify('file://' + path.join(BACKEND, 'src', 'config.js').replace(/\\/g, '/'))}); console.log('LOADED')`],
    { cwd: out, encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'production', APP_ENV: 'production', JWT_SECRET: 's'.repeat(40), PAYMENT_PROVIDER: 'disabled', OTP_PROVIDER: 'whatsapp', ...extra } });
  const ok = { DB_PATH: path.join(out, 'p.sqlite'), UPLOAD_DIR: path.join(out, 'up'), BACKUP_DIR: path.join(out, 'bk') };
  assert.match(run(ok).stdout, /LOADED/);
  for (const [k, v] of [['DB_PATH', path.join(BACKEND, 'data', 'p.sqlite')], ['UPLOAD_DIR', path.join(ROOT, 'uploads')], ['BACKUP_DIR', path.join(BACKEND, 'data', 'bk')]]) {
    const r = run({ ...ok, [k]: v }); assert.notEqual(r.status, 0); assert.match(r.stderr, new RegExp(`${k} .*inside the app folder`));
  }
  const h = run({ ...ok, OSRM_URL: 'http://203.0.113.5:5000' }); assert.notEqual(h.status, 0); assert.match(h.stderr, /OSRM_URL must use https/);
  assert.match(run({ ...ok, OSRM_URL: 'https://routing.example.com' }).stdout, /LOADED/);
  assert.match(run({ ...ok, OSRM_URL: 'http://127.0.0.1:5000' }).stdout, /LOADED/);
});

test('every API reply is marked no-store (the host CDN must never cache personal data); public images keep their cache', async () => {
  const db = openDb(':memory:'), srv = createApp(db).listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    for (const p of ['/api/public/restaurants', '/api/customer/addresses', '/api/admin/overview', '/api/nope']) {
      const r = await fetch(base + p); assert.match(r.headers.get('cache-control') || '', /no-store/, p);
    }
  } finally { srv.close(); }
});

test('the routing engine key is sent as X-Routing-Key when set', async () => {
  let seen = null; const eng = http.createServer((req, res) => { seen = req.headers['x-routing-key'] ?? null; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ code: 'Ok', routes: [{ distance: 1234, duration: 99 }] })); }).listen(0);
  const old = { ...config.routing }; setRouter(null);
  try {
    config.routing.osrmUrl = `http://127.0.0.1:${eng.address().port}`; config.routing.apiKey = 'k-test-123';
    const db = openDb(':memory:'); const r = await roadDistance(db, { lat: 17.338, lng: 78.3 }, { lat: 17.3422, lng: 78.3295 });
    assert.equal(r.distance_m, 1234); assert.equal(seen, 'k-test-123');
    config.routing.apiKey = ''; await roadDistance(openDb(':memory:'), { lat: 17.338, lng: 78.3 }, { lat: 17.3422, lng: 78.3295 }); assert.equal(seen, null);
  } finally { Object.assign(config.routing, old); eng.close(); }
});

test('SECRETS_DIR: secrets are created once on the server (mode 600), reused on restart, and never placed in the app folder', () => {
  const out = tmp(), sec = path.join(out, 'secrets');
  const cfgUrl = JSON.stringify('file://' + path.join(BACKEND, 'src', 'config.js').split(path.sep).join('/'));
  const code = `import crypto from 'node:crypto'; const { config } = await import(${cfgUrl});
    console.log(JSON.stringify({ j: config.jwtSecret.length, v: (config.vapid.publicKey || '').length, h: crypto.createHash('sha256').update(config.jwtSecret).digest('hex') }));`;
  const load = (extra = {}) => spawnSync(process.execPath, ['--input-type=module', '-e', code],
    { cwd: out, encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'production', APP_ENV: 'staging', PAYMENT_PROVIDER: 'disabled', OTP_PROVIDER: 'whatsapp',
      DB_PATH: path.join(out, 'p.sqlite'), UPLOAD_DIR: path.join(out, 'up'), BACKUP_DIR: path.join(out, 'bk'), SECRETS_DIR: sec, ...extra } });
  const a = load(); assert.equal(a.status, 0, a.stderr); const A = JSON.parse(a.stdout);
  assert.ok(A.j >= 60); assert.ok(A.v > 60, 'push keys generated');
  assert.deepEqual(fs.readdirSync(sec).sort(), ['jwt-secret', 'vapid.json']);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(sec, 'jwt-secret')).mode & 0o777, 0o600);
  assert.equal(JSON.parse(load().stdout).h, A.h, 'same secret after a restart (logins stay valid)');
  assert.notEqual(JSON.parse(load({ JWT_SECRET: 'e'.repeat(40) }).stdout).h, A.h, 'an environment value wins');
  const bad = load({ SECRETS_DIR: path.join(BACKEND, 'data', 'secrets-x') }); assert.notEqual(bad.status, 0); assert.match(bad.stderr, /SECRETS_DIR .*inside the app folder/);
  assert.ok(!fs.existsSync(path.join(BACKEND, 'data', 'secrets-x')), 'nothing written inside the app folder');
  assert.equal(load({ SECRETS_DIR: '' }).status === 0, false, 'production without JWT_SECRET or SECRETS_DIR still refuses to start');
});

test('first admin bootstrap: only while no admin exists; password only in a private file; logs never contain it', async () => {
  const { bootstrapAdmin, startupFacts, FIRST_LOGIN_FILE } = await import('../src/services/bootstrap.js');
  const db = openDb(':memory:'), sec = tmp();
  assert.deepEqual(bootstrapAdmin(db, { phone: '', secretsDir: sec }), { created: false, reason: 'not_requested' });
  assert.throws(() => bootstrapAdmin(db, { phone: '+919700000099', secretsDir: '' }), /SECRETS_DIR/);
  assert.throws(() => bootstrapAdmin(db, { phone: '12345', secretsDir: sec }), /\+91/);
  const r = bootstrapAdmin(db, { phone: '+919700000099', name: 'Staging admin', secretsDir: sec }); assert.ok(r.created);
  const txt = fs.readFileSync(path.join(sec, FIRST_LOGIN_FILE), 'utf8'), pw = txt.match(/Password: (\S+)/)[1];
  assert.ok(pw.length >= 24);
  const srv = createApp(db).listen(0), base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const ok = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ portal: 'admin', phone: '+919700000099', password: pw }) });
    assert.equal(ok.status, 200); assert.equal((await ok.json()).user.role, 'admin');
  } finally { srv.close(); }
  assert.deepEqual(bootstrapAdmin(db, { phone: '+919700000098', secretsDir: sec }), { created: false, reason: 'admin_exists' }, 'never a second bootstrap admin');
  assert.equal(db.prepare("SELECT COUNT(*) FROM users WHERE role='admin'").pluck().get(), 1);
  const f = startupFacts(db); assert.match(f.node, /^v\d+/); assert.ok(f.db_created && f.migrations > 0);
});

test('server start with bootstrap prints facts but never the password', async () => {
  const out = tmp(), sec = path.join(out, 's'), port = 30000 + Math.floor(Math.random() * 20000);
  const { spawn } = await import('node:child_process');
  const p = spawn(process.execPath, [path.join(BACKEND, 'src', 'server.js')], { cwd: out, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'production', APP_ENV: 'staging', PORT: String(port),
    PAYMENT_PROVIDER: 'disabled', OTP_PROVIDER: 'whatsapp', DB_PATH: path.join(out, 'd', 'p.sqlite'), UPLOAD_DIR: path.join(out, 'u'), BACKUP_DIR: path.join(out, 'b'), SECRETS_DIR: sec, BOOTSTRAP_ADMIN_PHONE: '+919700000099', SERVE_FRONTEND: 'true' } });
  let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  try {
    for (let i = 0; i < 50 && !/listening/.test(log); i++) await new Promise((r) => setTimeout(r, 200));
    assert.match(log, /First admin created/); assert.match(log, /"app_env":"staging","node":"v\d+.*"db_created":"20/);
    const pw = fs.readFileSync(path.join(sec, 'ADMIN-FIRST-LOGIN.txt'), 'utf8').match(/Password: (\S+)/)[1];
    assert.ok(!log.includes(pw), 'password never logged');
    assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/admin/`)).status, 200);
  } finally { p.kill(); }
});
