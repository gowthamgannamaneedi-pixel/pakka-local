// "Not now" on a delivery offer needs a reason; admin sees accepted / turned-down counts with reasons, is alerted from the
// 2nd turn-down in a day (each one), gets the partner listed under "Turn-downs to review", is alerted when every online
// partner has turned an order down, can offer it again, and can suspend a partner for a set number of days (ends on its own).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, PW } from './helpers/world.js';

const W = await makeWorld('9527');
test.after(() => W.close());
const set = (s) => W.call('PUT', '/api/admin/settings', { settings: s }, W.admin);
const newOrder = async () => { const r = await W.call('POST', '/api/customer/orders', W.cart(), W.cust); assert.equal(r.status, 201, JSON.stringify(r.body));
  await W.call('POST', `/api/customer/payments/sandbox/${r.body.order_code}/complete`, { outcome: 'success' }, W.cust);
  const o = W.db.prepare('SELECT * FROM orders WHERE order_code=?').get(r.body.order_code); await W.call('POST', `/api/restaurant/orders/${o.id}/accept`, {}, W.owner); return o; };
const adminNotes = (like) => W.db.prepare("SELECT title, body FROM notifications n JOIN users u ON u.id=n.user_id WHERE u.role='admin' AND n.title LIKE ? ORDER BY n.id").all(like);
const dismiss = (o, body) => W.call('POST', `/api/rider/orders/${o.id}/dismiss`, body, W.rider);
const offered = async (o) => (await W.call('GET', '/api/rider/offers', null, W.rider)).body.offers.some((x) => x.id === o.id);

test('Not now: a valid reason is required ("Other" needs words); without one nothing is recorded and the offer stays', async () => {
  const o = await newOrder();
  assert.equal((await dismiss(o, { reason: 'nope' })).status, 400);
  assert.equal((await dismiss(o, { reason: 'other' })).status, 400, 'Other without details');
  // no reason (Reject on an older app's ringing alert, or a page not reloaded since the update)
  const nr = await dismiss(o, undefined); assert.equal(nr.status, 200); assert.equal(nr.body.need_reason, true);
  assert.ok(await offered(o), 'still offered until a reason is given');
  assert.equal((await dismiss(o, { reason: 'too_far', note: 'across the lake' })).status, 200);
  assert.equal(W.db.prepare('SELECT reason FROM rider_assignments WHERE order_id=? AND rider_id=?').pluck().get(o.id, W.riderId), 'Too far (across the lake)');
  assert.ok(!(await offered(o)));
  // only partner online turned it down: admin is told nobody is left, then offers it again and the partner sees it again
  assert.equal(adminNotes(`No delivery partner for ${o.order_code}%`).length, 1);
  const r = await W.call('POST', `/api/admin/orders/${o.id}/reoffer`, {}, W.admin); assert.equal(r.status, 200); assert.equal(r.body.riders, 1);
  assert.ok(await offered(o), 'offered again');
  assert.ok(W.db.prepare('SELECT reason FROM rider_assignments WHERE order_id=?').pluck().get(o.id), 'reason kept on record');
  assert.equal(adminNotes('Review %').length, 0, 'one turn-down today: no review alert yet');
});

test('from the 2nd turn-down in a day admin is alerted each time and the partner is listed for review until reviewed', async () => {
  const o2 = await newOrder(); await dismiss(o2, { reason: 'low_pay' });
  const a2 = adminNotes('Review %turned down 2 offers today'); assert.equal(a2.length, 1); assert.match(a2[0].body, /Accepted 0, turned down 2/);
  const o4 = await newOrder(); await dismiss(o4, { reason: 'busy' });
  assert.equal(adminNotes('Review %turned down 3 offers today').length, 1, 'every further one alerts too');
  let list = (await W.call('GET', '/api/admin/riders?status=review', null, W.admin)).body; assert.equal(list.counts.review, 1);
  assert.deepEqual([list.riders[0].id, list.riders[0].turndowns.rejected], [W.riderId, 3]);
  assert.equal((await W.call('GET', `/api/admin/riders/${W.riderId}`, null, W.admin)).body.application.needs_review, true);
  const o3 = await newOrder(); assert.equal((await W.call('POST', `/api/rider/orders/${o3.id}/accept`, {}, W.rider)).status, 200);
  const a = (await W.call('GET', `/api/admin/riders/${W.riderId}`, null, W.admin)).body.application.offers;
  assert.deepEqual(a.today, { accepted: 1, rejected: 3 }); assert.equal(a.week.rejected, 3); assert.equal(a.recent.length, 3);
  assert.ok(a.reasons.some((x) => x.reason === 'Busy with another order') && a.reasons.some((x) => x.reason === 'Payout too low'));
  assert.equal((await W.call('POST', `/api/admin/riders/${W.riderId}/turndown-review`, { note: '' }, W.admin)).status, 400);
  assert.equal((await W.call('POST', `/api/admin/riders/${W.riderId}/turndown-review`, { note: 'Spoke to him, warned once' }, W.admin)).status, 200);
  list = (await W.call('GET', '/api/admin/riders?status=review', null, W.admin)).body; assert.equal(list.counts.review, 0, 'reviewed: off the list until new turn-downs');
  assert.equal((await set({ rider_reject_alert: '0' })).status, 400);
});

test('suspend for 2 days: partner goes offline with an end time, cannot take offers, and is restored automatically when it ends', async () => {
  const bad = await W.call('POST', `/api/admin/riders/${W.riderId}/verify`, { action: 'suspend', note: 'Too many turn-downs', days: 99, reauth_password: PW }, W.admin); assert.equal(bad.status, 400);
  const r = await W.call('POST', `/api/admin/riders/${W.riderId}/verify`, { action: 'suspend', note: 'Too many turn-downs', days: 2, reauth_password: PW }, W.admin);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const me = (await W.call('GET', '/api/rider/me', null, W.rider)).body.rider; assert.equal(me.verification_status, 'suspended');
  const hours = (Date.parse(me.suspended_until) - Date.now()) / 3600_000; assert.ok(hours > 47 && hours <= 48, String(hours));
  assert.match(me.decision_note, /suspended for 2 days/);
  const { endSuspensions } = await import('../src/services/core.js');
  assert.equal(endSuspensions(W.db), 0, 'not yet');
  W.db.prepare('UPDATE riders SET suspended_until=? WHERE user_id=?').run(new Date(Date.now() - 1000).toISOString(), W.riderId);
  assert.equal(endSuspensions(W.db), 1);
  const after = (await W.call('GET', '/api/rider/me', null, W.rider)).body.rider; assert.equal(after.verification_status, 'approved'); assert.equal(after.suspended_until, null);
  assert.equal(W.db.prepare("SELECT action FROM rider_verification_history WHERE rider_id=? ORDER BY id DESC LIMIT 1").pluck().get(W.riderId), 'suspension_ended');
});
