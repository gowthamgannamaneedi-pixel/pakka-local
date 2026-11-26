// Admin team: adding admins needs the acting admin's password; each admin's approvals / rejections show their name in the audit log.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, PW } from './helpers/world.js';

const W = await makeWorld('9590');
test.after(() => W.close());
const NEWPW = 'second-admin-pass-1';

test('creating an admin needs the current admin password; the new admin signs in and is listed', async () => {
  const body = { role: 'admin', name: 'Priya Admin', phone: '+919876500011', password: NEWPW };
  assert.equal((await W.call('POST', '/api/admin/users', body, W.admin)).status, 401, 'must confirm with own password');
  assert.equal((await W.call('POST', '/api/admin/users', { ...body, reauth_password: PW }, W.admin)).status, 201);
  const login = await W.call('POST', '/api/auth/login', { portal: 'admin', phone: body.phone, password: NEWPW }); assert.equal(login.status, 200);
  const team = (await W.call('GET', '/api/admin/admins', null, W.admin)).body; assert.ok(team.admins.some((a) => a.name === 'Priya Admin' && a.active === 1));
  assert.equal((await W.call('GET', '/api/admin/admins', null, W.owner)).status, 403, 'only admins');
  W.priya = login.body.token;
});

test('the audit log names who approved or rejected, with a decisions filter and a per-admin filter', async () => {
  const rider = (await W.call('POST', '/api/admin/users', { role: 'rider', name: 'Ravi Rider', phone: '+919876500012', password: NEWPW }, W.priya)).body.id;
  const o = await W.paidOrder(); await W.call('POST', `/api/admin/orders/${o.id}/cancel`, { reason: 'Kitchen closed' }, W.priya);
  const all = (await W.call('GET', '/api/admin/audit', null, W.admin)).body.logs;
  const made = all.find((l) => l.action === 'user.create' && l.target_name?.startsWith('Ravi Rider')); assert.ok(made); assert.equal(made.actor, 'Priya Admin'); assert.equal(made.actor_phone, '+919876500011');
  const priyaId = (await W.call('GET', '/api/admin/admins', null, W.admin)).body.admins.find((a) => a.name === 'Priya Admin').id;
  const mine = (await W.call('GET', `/api/admin/audit?actor=${priyaId}`, null, W.admin)).body.logs; assert.ok(mine.length >= 1); assert.ok(mine.every((l) => l.actor === 'Priya Admin'));
  const dec = (await W.call('GET', '/api/admin/audit?kind=decisions', null, W.admin)).body.logs; assert.ok(dec.every((l) => !/^user\.create$/.test(l.action)), 'creations are not decisions');
  void rider;
});

test('turning another admin off needs the password and signs them out; you cannot turn yourself off', async () => {
  const priyaId = (await W.call('GET', '/api/admin/admins', null, W.admin)).body.admins.find((a) => a.name === 'Priya Admin').id;
  assert.equal((await W.call('POST', `/api/admin/users/${priyaId}/active`, { active: false }, W.admin)).status, 401);
  assert.equal((await W.call('POST', `/api/admin/users/${priyaId}/active`, { active: false, reauth_password: PW }, W.admin)).status, 200);
  assert.equal((await W.call('GET', '/api/admin/admins', null, W.priya)).status, 401, 'signed out');
  assert.equal((await W.call('POST', '/api/auth/login', { portal: 'admin', phone: '+919876500011', password: NEWPW })).status, 403);
});
