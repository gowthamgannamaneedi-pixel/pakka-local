// Admin sets a new password for a restaurant / rider login: unlocks it, old sessions end, needs the admin's own password.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, PW } from './helpers/world.js';

const W = await makeWorld('9570');
test.after(() => W.close());
const NEW = 'new-demo-pass-123';
const ownerId = () => W.db.prepare("SELECT u.id FROM users u JOIN restaurant_users ru ON ru.user_id=u.id WHERE ru.restaurant_id=? LIMIT 1").pluck().get(W.rest);
const ownerPhone = () => W.db.prepare('SELECT phone FROM users WHERE id=?').pluck().get(ownerId());

test('a locked restaurant login gets a new password and is unlocked; old password and old session stop working', async () => {
  const id = ownerId(), phone = ownerPhone();
  W.db.prepare("UPDATE users SET locked_until=? WHERE id=?").run(new Date(Date.now() + 600_000).toISOString(), id);
  assert.equal((await W.call('POST', `/api/admin/users/${id}/password`, { password: NEW }, W.admin)).status, 401, 'admin must confirm with their own password');
  const r = await W.call('POST', `/api/admin/users/${id}/password`, { password: NEW, reauth_password: PW }, W.admin); assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await W.call('GET', '/api/restaurant/me', null, W.owner)).status, 401, 'old session signed out');
  assert.equal((await W.call('POST', '/api/auth/login', { portal: 'restaurant', phone, password: PW })).status, 401);
  const ok = await W.call('POST', '/api/auth/login', { portal: 'restaurant', phone, password: NEW }); assert.equal(ok.status, 200);
  assert.ok(W.db.prepare("SELECT 1 FROM audit_logs WHERE action='user.password_reset' AND metadata NOT LIKE ?").get(`%${NEW}%`));
});

test('rider logins too; never customers or admins; short passwords refused', async () => {
  assert.equal((await W.call('POST', `/api/admin/users/${W.riderId}/password`, { password: NEW, reauth_password: PW }, W.admin)).status, 200);
  assert.equal((await W.call('POST', `/api/admin/users/${W.custId}/password`, { password: NEW, reauth_password: PW }, W.admin)).status, 403);
  assert.equal((await W.call('POST', `/api/admin/users/${W.riderId}/password`, { password: 'short', reauth_password: PW }, W.admin)).status, 400);
});
