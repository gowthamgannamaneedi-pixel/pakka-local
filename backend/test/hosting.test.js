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
