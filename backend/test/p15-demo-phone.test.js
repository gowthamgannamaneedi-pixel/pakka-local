// Staging only: admin can confirm a made-up demo rider number (+91 5...) that can never receive the SMS code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers/world.js';
import { config } from '../src/config.js';

const W = await makeWorld('9560');
test.after(() => W.close());
const mk = async (phone) => { const r = await W.call('POST', '/api/admin/users', { role: 'rider', name: 'Demo', phone, password: 'demo-pass-12345' }, W.admin); assert.equal(r.status, 201); return r.body.id; };
const view = async (id) => (await W.call('GET', `/api/admin/riders/${id}`, null, W.admin)).body.application;

test('a demo number can be confirmed by admin; approval still needs the full application', async () => {
  const id = await mk('+915000000777');
  assert.equal((await view(id)).demo_phone_confirmable, true);
  const r = await W.call('POST', `/api/admin/riders/${id}/demo-phone`, {}, W.admin); assert.equal(r.status, 200);
  const a = await view(id); assert.equal(a.phone_verified, true); assert.equal(a.demo_phone_confirmable, false);
  assert.ok(!a.missing.some((m) => m.key === 'phone_verified')); assert.ok(a.missing.length > 0, 'the rest of the application is still needed');
  assert.equal(a.status, 'draft', 'not approved by this');
  assert.ok(W.db.prepare("SELECT 1 FROM audit_logs WHERE action='rider.demo_phone_confirmed'").get());
});

test('real numbers, non-admins and the live site are refused', async () => {
  const real = await mk('+919812345670');
  assert.equal((await view(real)).demo_phone_confirmable, false);
  assert.equal((await W.call('POST', `/api/admin/riders/${real}/demo-phone`, {}, W.admin)).status, 400);
  const demo = await mk('+915000000778');
  assert.equal((await W.call('POST', `/api/admin/riders/${demo}/demo-phone`, {}, W.owner)).status, 403);
  const env = config.appEnv; config.appEnv = 'production';
  try { assert.equal((await W.call('POST', `/api/admin/riders/${demo}/demo-phone`, {}, W.admin)).status, 403); assert.equal((await view(demo)).demo_phone_confirmable, false); }
  finally { config.appEnv = env; }
  assert.equal((await view(demo)).phone_verified, false);
});
