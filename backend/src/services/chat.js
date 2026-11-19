// Order chat between the customer and the delivery partner assigned to that order. Nobody else can read or write it
// (restaurants and other riders get 404). Writing is open while the delivery is active; history stays readable for both.
// No phone numbers are exchanged through it; the customer sees "Delivery partner" until pickup (identity rule unchanged).
import { iso, notify } from './core.js';

const OPEN = ['ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP'];
const MAX_LEN = 500, BURST = 20;                                   // at most 20 messages per person per order in 10 minutes

function access(db, user, orderRef) {
  const o = user.role === 'customer'
    ? db.prepare('SELECT * FROM orders WHERE order_code=? AND customer_id=?').get(String(orderRef), user.id)
    : user.role === 'rider' ? db.prepare('SELECT * FROM orders WHERE id=? AND rider_id=?').get(Number(orderRef), user.id) : null;
  return o || null;
}
const shape = (m, me, o) => ({ id: m.id, mine: m.sender_role === me, from: m.sender_role === 'customer' ? (o.customer_name || 'Customer') : 'Delivery partner',
  body: m.body, created_at: m.created_at, read_at: m.read_at });

export function list(db, user, orderRef, { markRead = true, after = 0 } = {}) {
  const o = access(db, user, orderRef); if (!o) return { error: 'Order not found.', status: 404 };
  if (markRead) db.prepare('UPDATE order_messages SET read_at=? WHERE order_id=? AND sender_role<>? AND read_at IS NULL').run(iso(), o.id, user.role);
  const rows = db.prepare('SELECT * FROM order_messages WHERE order_id=? AND id>? ORDER BY id LIMIT 200').all(o.id, Number(after) || 0);
  return { messages: rows.map((m) => shape(m, user.role, o)), can_send: !!o.rider_id && OPEN.includes(o.status), unread: 0 };
}

export const unreadFor = (db, role, orderId) => db.prepare('SELECT COUNT(*) FROM order_messages WHERE order_id=? AND sender_role<>? AND read_at IS NULL').pluck().get(orderId, role);

export function send(db, user, orderRef, rawBody) {
  const o = access(db, user, orderRef); if (!o) return { error: 'Order not found.', status: 404 };
  if (!o.rider_id || !OPEN.includes(o.status)) return { error: 'Chat is open only while the delivery is in progress.', status: 409 };
  const body = String(rawBody ?? '').replace(/\s+/g, ' ').trim();
  if (!body) return { error: 'Type a message.', status: 400 };
  if (body.length > MAX_LEN) return { error: `Keep messages under ${MAX_LEN} characters.`, status: 400 };
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  if (db.prepare('SELECT COUNT(*) FROM order_messages WHERE order_id=? AND sender_id=? AND created_at>?').pluck().get(o.id, user.id, since) >= BURST)
    return { error: 'Too many messages. Please wait a few minutes.', status: 429 };
  const id = db.prepare('INSERT INTO order_messages (order_id,sender_id,sender_role,body) VALUES (?,?,?,?)').run(o.id, user.id, user.role, body).lastInsertRowid;
  const preview = body.length > 80 ? body.slice(0, 77) + '…' : body;
  if (user.role === 'customer') notify(db, o.rider_id, 'transactional', `Message from ${o.customer_name || 'customer'}`, `${o.order_code}: ${preview}`, `/rider/#/job/${o.id}`, o.id, `msg:${id}`, 'message');
  else notify(db, o.customer_id, 'transactional', 'Message from your delivery partner', preview, `/user/orders/${o.order_code}`, o.id, `msg:${id}`, 'message');
  return { ok: true, message: shape(db.prepare('SELECT * FROM order_messages WHERE id=?').get(id), user.role, o) };
}
