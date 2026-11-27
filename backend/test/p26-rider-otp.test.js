// Delivery partners sign up / sign in with an SMS code; new ones start as a draft application with the number verified.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers/world.js';
import { testOutbox } from '../src/otpProviders.js';

const W = await makeWorld('9660');
test.after(() => W.close());
const signIn = async (phone, name) => { const r1 = await W.raw('POST', '/api/auth/rider/otp/request', { phone }); assert.equal(r1.status, 200, JSON.stringify(r1.body));
  return W.raw('POST', '/api/auth/rider/otp/verify', { phone, otp: testOutbox.at(-1).otp, name }); };

test('a new number becomes a draft rider with the mobile verified; cannot take orders until approved', async () => {
  const r = await signIn('+919811122233', 'Kiran'); assert.equal(r.status, 200); assert.equal(r.body.is_new, true); assert.equal(r.body.user.role, 'rider');
  const row = W.db.prepare("SELECT r.verification_status, r.phone_verified_at FROM riders r JOIN users u ON u.id=r.user_id WHERE u.phone='+919811122233'").get();
  assert.equal(row.verification_status, 'draft'); assert.ok(row.phone_verified_at);
  const me = (await W.call('GET', '/api/rider/me', null, r.body.token)).body.rider; assert.equal(me.can_take_orders, false);
  assert.equal((await W.call('POST', '/api/rider/online', { online: true }, r.body.token)).status >= 400, true, 'cannot go online before approval');
  const list = (await W.call('GET', '/api/admin/riders', null, W.admin)).body.riders; assert.ok(list.some((x) => (x.phone || x.user?.phone) === '+919811122233'), 'admin sees the new rider');
});

test('the same number signs in again (no second account); wrong code refused; existing rider passwords still work', async () => {
  W.db.prepare("DELETE FROM otp_challenges WHERE phone='+919811122233'").run();      // skip the 45 s resend wait
  const again = await signIn('+919811122233'); assert.equal(again.status, 200); assert.equal(again.body.is_new, false);
  assert.equal(W.db.prepare("SELECT COUNT(*) FROM users WHERE phone='+919811122233' AND role='rider'").pluck().get(), 1);
  await W.raw('POST', '/api/auth/rider/otp/request', { phone: '+919811122244' });
  assert.equal((await W.raw('POST', '/api/auth/rider/otp/verify', { phone: '+919811122244', otp: '000000' })).status >= 400, true);
  assert.ok(W.rider, 'world rider (password login) still signs in');
});
