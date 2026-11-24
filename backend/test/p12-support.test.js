// Customer support: tickets with an ID, two-way messages with the admin team, notifications, privacy, and the help assistant.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers/world.js';

const W = await makeWorld('9520');
test.after(() => W.close());
const adminId = () => W.db.prepare("SELECT id FROM users WHERE role='admin'").pluck().get();

test('customer opens a ticket and gets a ticket ID; admins are notified', async () => {
  assert.equal((await W.call('POST', '/api/customer/support/tickets', { topic: 'Delivery', message: 'x' }, W.cust)).status, 400, 'needs a real message');
  const r = await W.call('POST', '/api/customer/support/tickets', { topic: 'Delivery', message: 'My rider is not moving for 20 minutes.' }, W.cust);
  assert.equal(r.status, 201); assert.match(r.body.ticket.code, /^PLS-\d{4,}$/); assert.equal(r.body.ticket.status, 'open');
  assert.ok(W.db.prepare("SELECT 1 FROM notifications WHERE user_id=? AND title LIKE 'New support ticket%'").get(adminId()));
  const list = (await W.call('GET', '/api/customer/support/tickets', null, W.cust)).body.tickets; assert.equal(list[0].code, r.body.ticket.code);
});

test('admin sees it, replies; the customer is notified and sees the reply; the customer can answer back', async () => {
  const t = (await W.call('GET', '/api/admin/support', null, W.admin)).body.tickets[0];
  assert.equal(t.customer.name, 'Asha'); assert.equal(t.unread, 1);
  const rep = await W.call('POST', `/api/admin/support/${t.id}/reply`, { body: 'Checking with the rider now.' }, W.admin);
  assert.equal(rep.status, 200); assert.equal(rep.body.ticket.status, 'answered'); assert.equal(rep.body.messages.at(-1).from, 'admin');
  assert.ok(W.db.prepare("SELECT 1 FROM notifications WHERE user_id=? AND title LIKE 'Pakka Local support replied%'").get(W.custId));
  const mine = (await W.call('GET', `/api/customer/support/tickets/${t.code}`, null, W.cust)).body;
  assert.deepEqual(mine.messages.map((m) => m.from), ['customer', 'admin']);
  const back = await W.call('POST', `/api/customer/support/tickets/${t.code}/messages`, { body: 'Thanks!' }, W.cust); assert.equal(back.status, 201); assert.equal(back.body.ticket.status, 'open');
  assert.equal((await W.call('POST', `/api/admin/support/${t.id}/reply`, { body: 'Delivered now. Closing.', close: true }, W.admin)).body.ticket.status, 'closed');
  assert.ok(W.db.prepare("SELECT 1 FROM audit_logs WHERE action='support.reply'").get());
});

test('privacy: nobody sees another customer’s ticket; only admins use the inbox', async () => {
  const other = await W.customer(W.ph(399), 'Ravi');
  const code = (await W.call('GET', '/api/customer/support/tickets', null, W.cust)).body.tickets[0].code;
  assert.equal((await W.call('GET', `/api/customer/support/tickets/${code}`, null, other)).status, 404);
  assert.equal((await W.call('POST', `/api/customer/support/tickets/${code}/messages`, { body: 'hi' }, other)).status, 404);
  assert.equal((await W.call('GET', '/api/admin/support', null, W.owner)).status, 403);
  assert.equal((await W.call('POST', '/api/customer/support/tickets', { message: 'Order missing', order_code: 'PL20990101AAAAAA' }, other)).status, 400, 'only own orders can be attached');
});

test('help assistant answers from the customer’s real orders and offers the team when it cannot help', async () => {
  const ask = async (q) => (await W.call('POST', '/api/customer/support/assistant', { q }, W.cust)).body;
  let a = await ask('where is my order');
  assert.match(a.reply, /no order in progress|no orders yet/i);
  const o = await W.paidOrder();
  a = await ask('Where is my order?'); assert.ok(a.reply.includes(o.order_code)); assert.match(a.reply, /waiting for the restaurant/);
  assert.equal(a.actions[0].path, `/orders/${o.order_code}`);
  a = await ask('can I cancel'); assert.match(a.reply, /can’t be cancelled/); assert.equal(a.actions[0].ask, 'ticket');
  a = await ask('refund'); assert.match(a.reply, /5–7 working days/);
  a = await ask('qwerty asdf'); assert.equal(a.handoff, 'Other');
});
