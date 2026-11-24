// Customer support: tickets with an ID, two-way messages with the admin team, notifications, privacy, and the help assistant.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers/world.js';

const W = await makeWorld('9520');
test.after(() => W.close());
const adminId = () => W.db.prepare("SELECT id FROM users WHERE role='admin'").pluck().get();
const pass = async (tok = W.cust) => (await W.call('POST', '/api/customer/support/assistant/unresolved', {}, tok)).body.pass;

test('the assistant comes first: no ticket without its pass; then a ticket with an ID; admins are notified', async () => {
  const no = await W.call('POST', '/api/customer/support/tickets', { topic: 'Delivery', message: 'Help please' }, W.cust); assert.equal(no.status, 403); assert.equal(no.body.code, 'ASK_ASSISTANT_FIRST');
  assert.equal((await W.call('POST', '/api/customer/support/tickets', { topic: 'Delivery', message: 'Help', pass: 'forged.0123456789abcdef0123456789abcdef' }, W.cust)).status, 403, 'forged pass refused');
  const p = await pass(); assert.ok(p, 'no order in progress: the assistant hands over');
  assert.equal((await W.call('POST', '/api/customer/support/tickets', { topic: 'Delivery', message: 'x', pass: p }, W.cust)).status, 400, 'needs a real message');
  const r = await W.call('POST', '/api/customer/support/tickets', { topic: 'Delivery', message: 'My last order had a cold biryani.', pass: p }, W.cust);
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
  assert.equal((await W.call('POST', '/api/customer/support/tickets', { message: 'Order missing', order_code: 'PL20990101AAAAAA', pass: await pass(other) }, other)).status, 400, 'only own orders can be attached');
  assert.equal((await W.call('POST', '/api/customer/support/tickets', { message: 'Order missing', pass: await pass(W.cust) }, other)).status, 403, 'a pass is only for the customer it was given to');
});

test('help assistant answers from the customer’s real orders and offers the team when it cannot help', async () => {
  const ask = async (q) => (await W.call('POST', '/api/customer/support/assistant', { q }, W.cust)).body;
  let a = await ask('where is my order');
  assert.match(a.reply, /no order in progress|no orders yet/i);
  const o = await W.paidOrder();
  a = await ask('Where is my order?'); assert.ok(a.reply.includes(o.order_code)); assert.match(a.reply, /waiting for the restaurant/);
  assert.equal(a.actions[0].path, `/orders/${o.order_code}`);
  a = await ask('can I cancel'); assert.match(a.reply, /can’t be cancelled/); assert.ok(!a.actions.some((x) => x.ask === 'ticket' || x.team), 'no direct way to the team: "Not solved" first');
  a = await ask('refund'); assert.match(a.reply, /5–7 working days/);
  a = await ask('qwerty asdf'); assert.equal(a.handoff, 'Other');
});

test('while an order is in progress the assistant keeps it; only a 30+ minute late order is handed over', async () => {
  const o = await W.paidOrder();
  const a = (await W.call('POST', '/api/customer/support/assistant/unresolved', {}, W.cust)).body;
  assert.equal(a.pass, undefined); assert.match(a.reply, /still in progress/); assert.equal(a.actions[0].path, `/orders/${o.order_code}`);
  const p = await (async () => { W.db.prepare('UPDATE orders SET eta_at=? WHERE id=?').run(new Date(Date.now() - 45 * 60_000).toISOString(), o.id); return (await W.call('POST', '/api/customer/support/assistant/unresolved', {}, W.cust)).body; })();
  assert.ok(p.pass); assert.equal(p.order_code, o.order_code);
  const t = await W.call('POST', '/api/customer/support/tickets', { topic: 'Delivery', message: 'Still not here', pass: p.pass }, W.cust);
  assert.equal(t.status, 201); assert.equal(t.body.ticket.order_code, o.order_code, 'the late order is attached');
  // an earlier "any" pass cannot be used to open a ticket about an order that is in progress and not late
  W.db.prepare('UPDATE orders SET eta_at=? WHERE id=?').run(new Date(Date.now() + 20 * 60_000).toISOString(), o.id);
  const o2 = W.db.prepare("SELECT order_code FROM orders WHERE customer_id=? AND status IN ('PLACED','ACCEPTED','PREPARING','READY','PICKED_UP')").pluck().get(W.custId);
  const anyPass = await (async () => { W.db.prepare("UPDATE orders SET status='DELIVERED' WHERE customer_id=?").run(W.custId); const x = (await W.call('POST', '/api/customer/support/assistant/unresolved', {}, W.cust)).body.pass; W.db.prepare("UPDATE orders SET status='PLACED' WHERE order_code=?").run(o2); return x; })();
  const r = await W.call('POST', '/api/customer/support/tickets', { topic: 'Order issue', message: 'about this order', order_code: o2, pass: anyPass }, W.cust);
  assert.equal(r.status, 409); assert.equal(r.body.code, 'ORDER_IN_PROGRESS');
});
