// Admins must verify e-mail (code by e-mail) and mobile (code by SMS) before using the admin portal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers/world.js';
import { testMailOutbox } from '../src/emailProviders.js';
import { testOutbox } from '../src/otpProviders.js';

const W = await makeWorld('9640');
test.after(() => W.close());
W.db.prepare("INSERT INTO app_settings (key,value,updated_at) VALUES ('admin_verify_required','1',?) ON CONFLICT(key) DO UPDATE SET value='1'").run(new Date().toISOString());

test('an unverified admin is blocked; e-mail then SMS codes unlock the portal', async () => {
  const blocked = await W.call('GET', '/api/admin/overview', null, W.admin); assert.equal(blocked.status, 403); assert.equal(blocked.body.code, 'VERIFY_REQUIRED');
  let v = (await W.call('GET', '/api/admin/me/verification', null, W.admin)).body; assert.deepEqual([v.required, v.email_verified, v.phone_verified], [true, false, false]);
  assert.equal((await W.call('POST', '/api/admin/me/verify/email/send', { email: 'Boss@Example.com' }, W.admin)).status, 200);
  const mail = testMailOutbox.filter((m) => m.to === 'boss@example.com').at(-1); const ecode = mail.subject.match(/^(\d{6})/)[1];
  assert.equal((await W.call('POST', '/api/admin/me/verify/email/confirm', { code: ecode === '000000' ? '111111' : '000000' }, W.admin)).status, 400);
  assert.equal((await W.call('POST', '/api/admin/me/verify/email/confirm', { code: ecode }, W.admin)).status, 200);
  assert.equal((await W.call('GET', '/api/admin/overview', null, W.admin)).status, 403, 'still needs the mobile');
  assert.equal((await W.call('POST', '/api/admin/me/verify/phone/send', {}, W.admin)).status, 200);
  const sms = testOutbox.at(-1); assert.equal(sms.phone, W.ph(1));
  assert.equal((await W.call('POST', '/api/admin/me/verify/phone/confirm', { code: sms.otp }, W.admin)).status, 200);
  v = (await W.call('GET', '/api/admin/me/verification', null, W.admin)).body; assert.deepEqual([v.email_verified, v.phone_verified], [true, true]);
  assert.equal((await W.call('GET', '/api/admin/overview', null, W.admin)).status, 200, 'unlocked');
});

test('changing the e-mail needs verifying again; codes are single-use', async () => {
  assert.equal((await W.call('PUT', '/api/admin/me/email', { email: 'new.boss@example.com' }, W.admin)).status, 200);
  assert.equal((await W.call('GET', '/api/admin/overview', null, W.admin)).status, 403);
  W.db.prepare("DELETE FROM admin_verify_codes WHERE kind='email'").run();
  await W.call('POST', '/api/admin/me/verify/email/send', { email: 'new.boss@example.com' }, W.admin);
  const code = testMailOutbox.filter((m) => m.to === 'new.boss@example.com').at(-1).subject.slice(0, 6);
  assert.equal((await W.call('POST', '/api/admin/me/verify/email/confirm', { code }, W.admin)).status, 200);
  assert.equal((await W.call('POST', '/api/admin/me/verify/email/confirm', { code }, W.admin)).status, 400, 'single use');
  assert.equal((await W.call('GET', '/api/admin/overview', null, W.admin)).status, 200);
});
