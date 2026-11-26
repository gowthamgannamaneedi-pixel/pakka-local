// Main admin, admin e-mail, "Forgot password?" by e-mail code, own password change, 10-digit numbers without +91.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, PW } from './helpers/world.js';
import { testMailOutbox } from '../src/emailProviders.js';

const W = await makeWorld('9600');
test.after(() => W.close());
const P2 = 'second-admin-pass-9';
const add = (body, tok = W.admin) => W.call('POST', '/api/admin/users', { role: 'admin', password: P2, reauth_password: PW, ...body }, tok);

test('admins need an e-mail; a 10-digit number works without +91; a welcome e-mail is sent', async () => {
  assert.equal((await add({ name: 'No Mail', phone: '9876511111' })).status, 400);
  const r = await add({ name: 'Kavya', phone: '98765 11112', email: 'Kavya@Example.com' }); assert.equal(r.status, 201, JSON.stringify(r.body));
  const u = W.db.prepare("SELECT phone, email FROM users WHERE name='Kavya'").get(); assert.deepEqual(u, { phone: '+919876511112', email: 'kavya@example.com' });
  await new Promise((s) => setTimeout(s, 20)); assert.ok(testMailOutbox.some((m) => m.to === 'kavya@example.com' && /now a Pakka Local admin/.test(m.subject)));
  assert.equal((await W.call('POST', '/api/auth/login', { portal: 'admin', phone: '9876511112', password: P2 })).status, 200);
});

test('main admin: only they add or turn off admins, and nobody can turn the main admin off', async () => {
  const adminPhone = W.db.prepare('SELECT phone FROM users WHERE id=(SELECT MIN(id) FROM users WHERE role=?)').pluck().get('admin');
  assert.equal((await W.call('PUT', '/api/admin/admins/main', { phone: adminPhone.replace('+91', ''), reauth_password: PW }, W.admin)).status, 200);
  const kavya = (await W.call('POST', '/api/auth/login', { portal: 'admin', phone: '9876511112', password: P2 })).body.token;
  const t = (await W.call('GET', '/api/admin/admins', null, kavya)).body; assert.equal(t.can_manage, false);
  assert.equal((await add({ name: 'Blocked', phone: '9876511113', email: 'b@example.com' }, kavya)).status, 403, 'not main');
  const mainId = W.db.prepare('SELECT id FROM users WHERE phone=? AND role=?').pluck().get(adminPhone, 'admin');
  assert.equal((await W.call('POST', `/api/admin/users/${mainId}/active`, { active: false, reauth_password: P2 }, kavya)).status, 403);
  const kId = W.db.prepare("SELECT id FROM users WHERE name='Kavya'").pluck().get();
  assert.equal((await W.call('POST', `/api/admin/users/${kId}/active`, { active: false, reauth_password: PW }, W.admin)).status, 200, 'main turns Kavya off');
  assert.equal((await W.call('POST', `/api/admin/users/${kId}/active`, { active: true, reauth_password: PW }, W.admin)).status, 200);
  assert.equal((await W.call('PUT', '/api/admin/admins/main', { phone: '9999999999', reauth_password: PW }, W.admin)).status, 400, 'must be an admin');
});

test('forgot password: code by e-mail, wrong code refused, right code sets the new password and unlocks', async () => {
  const unverified = await W.call('POST', '/api/auth/admin/reset/request', { phone: '9876511112' }); assert.equal(unverified.status, 200);
  W.db.prepare("UPDATE users SET email_verified_at=? WHERE name='Kavya'").run(new Date().toISOString());      // codes only go to a verified e-mail
  W.db.prepare("DELETE FROM admin_reset_codes").run();
  const before = testMailOutbox.length;
  const r = await W.call('POST', '/api/auth/admin/reset/request', { phone: '9876511112' }); assert.equal(r.status, 200);
  const unknown = await W.call('POST', '/api/auth/admin/reset/request', { phone: '9000000000' }); assert.equal(unknown.body.message, r.body.message, 'same answer either way');
  const mail = testMailOutbox.slice(before).find((m) => m.to === 'kavya@example.com'); assert.ok(mail); const code = mail.subject.match(/^(\d{6})/)[1];
  assert.equal((await W.call('POST', '/api/auth/admin/reset/verify', { phone: '9876511112', code: code === '000000' ? '111111' : '000000', password: 'brand-new-pass-1' })).status, 400);
  W.db.prepare("UPDATE users SET locked_until=? WHERE name='Kavya'").run(new Date(Date.now() + 600_000).toISOString());
  assert.equal((await W.call('POST', '/api/auth/admin/reset/verify', { phone: '9876511112', code, password: 'brand-new-pass-1' })).status, 200);
  assert.equal((await W.call('POST', '/api/auth/admin/reset/verify', { phone: '9876511112', code, password: 'another-pass-22' })).status, 400, 'single use');
  assert.equal((await W.call('POST', '/api/auth/login', { portal: 'admin', phone: '9876511112', password: 'brand-new-pass-1' })).status, 200);
});

test('an admin changes their own password and e-mail', async () => {
  const k = (await W.call('POST', '/api/auth/login', { portal: 'admin', phone: '9876511112', password: 'brand-new-pass-1' })).body.token;
  assert.equal((await W.call('PUT', '/api/admin/me/email', { email: 'kavya.new@example.com' }, k)).status, 200);
  assert.equal((await W.call('POST', '/api/admin/me/password', { password: 'mine-pass-12345', reauth_password: 'wrong-one-123' }, k)).status, 401);
  assert.equal((await W.call('POST', '/api/admin/me/password', { password: 'mine-pass-12345', reauth_password: 'brand-new-pass-1' }, k)).status, 200);
  assert.equal((await W.call('POST', '/api/auth/login', { portal: 'admin', phone: '9876511112', password: 'mine-pass-12345' })).status, 200);
});
