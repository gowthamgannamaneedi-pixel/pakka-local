// Customer support: tickets with a readable ID (PLS-1001), a message thread between the customer and the Pakka Local team,
// and a help assistant that answers common questions from the customer's own data (no outside service, no cost).
// Admins see every ticket in the admin portal and reply when free; each side is notified of new messages.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { iso, notify, notifyAdmins } from './core.js';

// ---------- the assistant comes first ----------
// A ticket can only be opened with a pass the assistant gives after the customer says its answer did not solve the problem.
// While an order is in progress the assistant handles it; the team is reachable for finished orders (or no order),
// and for an order in progress only when it is 30+ minutes late. Passes expire after 30 minutes.
const FINISHED = ['DELIVERED', 'REJECTED', 'CANCELLED', 'PAYMENT_FAILED', 'EXPIRED'];
const LATE_MS = 30 * 60_000, PASS_MS = 30 * 60_000;
const sign = (s2) => crypto.createHmac('sha256', config.jwtSecret).update(`support:${s2}`).digest('hex').slice(0, 32);
const makePass = (uid, scope) => { const exp = Date.now() + PASS_MS, body = `${uid}.${exp}.${scope}`; return `${Buffer.from(body).toString('base64url')}.${sign(body)}`; };
function readPass(uid, pass) {
  const [b64, sig] = String(pass || '').split('.'); if (!b64 || !sig) return null;
  let body; try { body = Buffer.from(b64, 'base64url').toString(); } catch { return null; }
  if (sig.length !== 32 || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(body)))) return null;
  const [u, exp, scope] = body.split('.'); if (Number(u) !== uid || Date.now() > Number(exp)) return null;
  return { scope };                                                   // 'any' (finished orders / no order) or 'late:<ORDER_CODE>'
}
const activeOrders = (db, uid) => db.prepare(`SELECT o.*, r.name AS restaurant FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.customer_id=? AND o.status IN ('PLACED','ACCEPTED','PREPARING','READY','PICKED_UP') ORDER BY o.id DESC`).all(uid);
// the customer said "Not solved": decide whether to hand over to the team, and give a pass if so
export function unresolved(db, user) {
  const act = activeOrders(db, user.id), late = act.find((o) => o.eta_at && Date.parse(o.eta_at) < Date.now() - LATE_MS);
  if (late) return { reply: `Sorry about the delay with ${late.order_code}. I’m connecting you to the Pakka Local team so they can check with the restaurant and the delivery partner.`, pass: makePass(user.id, `late:${late.order_code}`), order_code: late.order_code, topic: 'Delivery' };
  if (act.length) {
    const o = act[0];
    return { reply: `Your order ${o.order_code} is still in progress, so I’ll keep helping with it here: you can track it live and message your delivery partner from the order page. If something is wrong once it’s delivered (or if it becomes very late), you can reach our team from here.`,
      actions: [{ label: 'Track my order', path: `/orders/${o.order_code}` }] };
  }
  return { reply: 'Sorry I couldn’t sort that out. I’m connecting you to the Pakka Local team: tell them what happened and they will reply here.', pass: makePass(user.id, 'any') };
}

const MAX_LEN = 1000, BURST = 15;                                   // at most 15 customer messages per 10 minutes
export const TOPICS = ['Order issue', 'Payment or refund', 'Delivery', 'Account', 'Other'];
const clean = (s, n = MAX_LEN) => String(s ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
const code = (id) => `PLS-${1000 + id}`;
const STATUS = { PLACED: 'waiting for the restaurant to accept', ACCEPTED: 'accepted by the restaurant', PREPARING: 'being prepared', READY: 'packed and waiting for the delivery partner',
  PICKED_UP: 'on the way to you', DELIVERED: 'delivered', REJECTED: 'not accepted by the restaurant', CANCELLED: 'cancelled', PAYMENT_PENDING: 'waiting for payment', PAYMENT_FAILED: 'not paid (payment failed)', EXPIRED: 'expired (payment not completed)' };
const rs = (p) => '₹' + (Number(p || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const day = (d) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const t12 = (iso2) => { const d = new Date(iso2), tm = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  return day(d) === day(new Date()) ? tm : `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}, ${tm}`; };

const shapeT = (t) => ({ id: t.id, code: code(t.id), topic: t.topic, status: t.status, order_code: t.order_code, created_at: t.created_at, updated_at: t.updated_at,
  last: t.last_body ?? null, unread: t.unread ?? 0, customer: t.customer_name !== undefined ? { name: t.customer_name, phone: t.customer_phone } : undefined });
const shapeM = (m) => ({ id: m.id, from: m.sender_role, body: m.body, created_at: m.created_at });

function addMsg(db, ticketId, role, senderId, body) {
  const id = db.prepare('INSERT INTO support_messages (ticket_id,sender_role,sender_id,body) VALUES (?,?,?,?)').run(ticketId, role, senderId ?? null, body).lastInsertRowid;
  db.prepare('UPDATE support_tickets SET updated_at=? WHERE id=?').run(iso(), ticketId);
  return id;
}

// ---------- customer ----------
export function create(db, user, b) {
  const pass = readPass(user.id, b?.pass);
  if (!pass) return { error: 'Please ask the help assistant first. If it can’t solve your problem, it will connect you to our team.', status: 403, code: 'ASK_ASSISTANT_FIRST' };
  const topic = TOPICS.includes(b?.topic) ? b.topic : 'Other', body = clean(b?.message);
  if (body.length < 3) return { error: 'Tell us a little about the problem.', status: 400 };
  let orderCode = null;
  if (b?.order_code) { const o = db.prepare('SELECT order_code, status FROM orders WHERE order_code=? AND customer_id=?').get(String(b.order_code).trim().toUpperCase(), user.id);
    if (!o) return { error: 'That order is not on your account.', status: 400 }; orderCode = o.order_code;
    if (!FINISHED.includes(o.status) && pass.scope !== `late:${o.order_code}`) return { error: 'This order is still in progress. The help assistant and the order page can help until it is delivered.', status: 409, code: 'ORDER_IN_PROGRESS' }; }
  if (pass.scope.startsWith('late:') && !orderCode) orderCode = pass.scope.slice(5);
  if (db.prepare("SELECT COUNT(*) FROM support_tickets WHERE customer_id=? AND created_at>?").pluck().get(user.id, new Date(Date.now() - 3600_000).toISOString()) >= 5)
    return { error: 'You have opened several tickets in the last hour. Please continue in an existing ticket.', status: 429 };
  const id = db.transaction(() => { const tid = db.prepare("INSERT INTO support_tickets (customer_id,topic,order_code,status) VALUES (?,?,?,'open')").run(user.id, topic, orderCode).lastInsertRowid;
    addMsg(db, tid, 'customer', user.id, body); return tid; })();
  notifyAdmins(db, `New support ticket ${code(id)}`, `${topic}${orderCode ? ` · ${orderCode}` : ''}: ${body.slice(0, 120)}`, null, `sup:new:${id}`);
  return { ticket: shapeT(db.prepare('SELECT * FROM support_tickets WHERE id=?').get(id)) };
}
const mine = (db, user, ref) => db.prepare('SELECT * FROM support_tickets WHERE id=? AND customer_id=?').get(Number(String(ref).replace(/^PLS-/i, '')) - 1000, user.id);
export function listMine(db, user) {
  return { tickets: db.prepare(`SELECT t.*, (SELECT body FROM support_messages m WHERE m.ticket_id=t.id ORDER BY id DESC LIMIT 1) AS last_body,
      (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id=t.id AND m.sender_role='admin' AND m.read_by_customer=0) AS unread
    FROM support_tickets t WHERE t.customer_id=? ORDER BY t.updated_at DESC LIMIT 50`).all(user.id).map(shapeT) };
}
export function getMine(db, user, ref) {
  const t = mine(db, user, ref); if (!t) return { error: 'Ticket not found.', status: 404 };
  db.prepare("UPDATE support_messages SET read_by_customer=1 WHERE ticket_id=? AND sender_role='admin'").run(t.id);
  return { ticket: shapeT(t), messages: db.prepare('SELECT * FROM support_messages WHERE ticket_id=? ORDER BY id').all(t.id).map(shapeM) };
}
export function customerSend(db, user, ref, raw) {
  const t = mine(db, user, ref); if (!t) return { error: 'Ticket not found.', status: 404 };
  const body = clean(raw); if (!body) return { error: 'Type a message.', status: 400 };
  if (db.prepare("SELECT COUNT(*) FROM support_messages m JOIN support_tickets t ON t.id=m.ticket_id WHERE t.customer_id=? AND m.sender_role='customer' AND m.created_at>?").pluck().get(user.id, new Date(Date.now() - 600_000).toISOString()) >= BURST)
    return { error: 'You are sending messages too quickly. Please wait a few minutes.', status: 429 };
  addMsg(db, t.id, 'customer', user.id, body);
  if (t.status !== 'open') db.prepare("UPDATE support_tickets SET status='open' WHERE id=?").run(t.id);      // a reply reopens a closed ticket
  notifyAdmins(db, `Reply on ${code(t.id)}`, body.slice(0, 140), null, `sup:c:${t.id}:${Date.now()}`);
  return getMine(db, user, t.id + 1000);
}

// ---------- admin ----------
export function adminList(db, { status } = {}) {
  const st = ['open', 'answered', 'closed'].includes(status) ? status : null;
  const rows = db.prepare(`SELECT t.*, u.name AS customer_name, u.phone AS customer_phone,
      (SELECT body FROM support_messages m WHERE m.ticket_id=t.id ORDER BY id DESC LIMIT 1) AS last_body,
      (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id=t.id AND m.sender_role='customer' AND m.read_by_admin=0) AS unread
    FROM support_tickets t JOIN users u ON u.id=t.customer_id ${st ? 'WHERE t.status=?' : ''} ORDER BY (t.status='open') DESC, t.updated_at DESC LIMIT 200`).all(...(st ? [st] : []));
  const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM support_tickets GROUP BY status').all().map((x) => [x.status, x.n]));
  return { tickets: rows.map(shapeT), counts };
}
export function adminGet(db, id) {
  const t = db.prepare('SELECT t.*, u.name AS customer_name, u.phone AS customer_phone FROM support_tickets t JOIN users u ON u.id=t.customer_id WHERE t.id=?').get(id);
  if (!t) return { error: 'Ticket not found.', status: 404 };
  db.prepare("UPDATE support_messages SET read_by_admin=1 WHERE ticket_id=? AND sender_role='customer'").run(t.id);
  const order = t.order_code ? db.prepare('SELECT o.order_code, o.status, o.total_paise, o.created_at, r.name AS restaurant FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.order_code=?').get(t.order_code) : null;
  return { ticket: shapeT(t), order, messages: db.prepare('SELECT * FROM support_messages WHERE ticket_id=? ORDER BY id').all(t.id).map(shapeM) };
}
export function adminReply(db, admin, id, raw, closeAfter = false) {
  const t = db.prepare('SELECT * FROM support_tickets WHERE id=?').get(id); if (!t) return { error: 'Ticket not found.', status: 404 };
  const body = clean(raw); if (!body) return { error: 'Type a reply.', status: 400 };
  addMsg(db, t.id, 'admin', admin.id, body);
  db.prepare('UPDATE support_tickets SET status=? WHERE id=?').run(closeAfter ? 'closed' : 'answered', t.id);
  notify(db, t.customer_id, 'transactional', `Pakka Local support replied (${code(t.id)})`, body.slice(0, 160), `/user/#/support/${code(t.id)}`, null, `sup:a:${t.id}:${Date.now()}`, 'support');
  return adminGet(db, t.id);
}
export function adminStatus(db, id, status) {
  if (!['open', 'answered', 'closed'].includes(status)) return { error: 'Unknown status.', status: 400 };
  const c = db.prepare('UPDATE support_tickets SET status=?, updated_at=? WHERE id=?').run(status, iso(), id).changes;
  return c ? adminGet(db, id) : { error: 'Ticket not found.', status: 404 };
}

// ---------- help assistant (rule-based, answers from the customer's real data) ----------
// Returns { reply, actions: [{ label, path } | { label, ask }], handoff? }. Never invents order details.
const has = (q, ...w) => w.some((x) => q.includes(x));
export function assistant(db, user, raw) {
  const q = ` ${String(raw ?? '').toLowerCase().replace(/[^a-z0-9₹ ]+/g, ' ')} `;
  const orders = db.prepare(`SELECT o.*, r.name AS restaurant FROM orders o JOIN restaurants r ON r.id=o.restaurant_id WHERE o.customer_id=? AND o.status NOT IN ('EXPIRED') ORDER BY o.id DESC LIMIT 5`).all(user.id);
  const active = orders.filter((o) => ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP'].includes(o.status));
  const human = null;      // the team is reached through "Not solved" (see unresolved)
  if (has(q, ' where ', ' track', ' status', ' late', ' delay', ' eta', ' when will', ' how long', ' my order', ' not arrived', ' not received', ' still not')) {
    if (!active.length) {
      const last = orders[0];
      return { reply: last ? `You have no order in progress right now. Your last order ${last.order_code} from ${last.restaurant} is ${STATUS[last.status] || last.status.toLowerCase()}.` : 'You have no orders yet. Pick a restaurant on Home to place your first order.',
        actions: last ? [{ label: 'Open last order', path: `/orders/${last.order_code}` }] : [{ label: 'Browse restaurants', path: '/home' }] };
    }
    const o = active[0];
    const eta = o.eta_at ? ` Expected around ${t12(o.eta_at)}.` : '';
    const late = o.eta_at && Date.parse(o.eta_at) < Date.now() - 10 * 60_000;
    return { reply: `Your order ${o.order_code} from ${o.restaurant} is ${STATUS[o.status]}.${eta}${late ? ' It is running late; sorry about that. If it does not arrive soon, our team can check with the restaurant and the delivery partner.' : ''}${active.length > 1 ? ` You have ${active.length} orders in progress.` : ''}`,
      actions: [{ label: 'Track live on the map', path: `/orders/${o.order_code}` }, ...(late ? [] : [])] };
  }
  if (has(q, ' refund', ' money back', ' charged', ' deducted', ' payment fail', ' paid but')) {
    const r = db.prepare("SELECT o.order_code, rf.status, rf.amount_paise FROM refunds rf JOIN orders o ON o.id=rf.order_id WHERE o.customer_id=? ORDER BY rf.id DESC LIMIT 1").get(user.id);
    return { reply: r ? `Your latest refund (order ${r.order_code}, ${rs(r.amount_paise)}) is ${String(r.status).toLowerCase().replace(/_/g, ' ')}. Refunds go back to the same UPI/payment method, usually within 5–7 working days after it is marked paid.`
      : 'Refunds are started automatically when a restaurant cannot accept your order or Pakka Local cancels it, and go back to the same payment method in 5–7 working days. If money left your account but no order was placed, tap “Not solved” and I’ll connect you to our team.',
      actions: [] };
  }
  if (has(q, ' cancel')) return { reply: 'Orders can’t be cancelled from the app once they are paid, because the restaurant starts cooking right away. If something is wrong once it arrives, tell me here; if I can’t fix it, I’ll connect you to our team, who can refund when needed.', actions: [] };
  if (has(q, ' delivery charge', ' delivery fee', ' charges', ' why so much', ' fee ')) return { reply: 'Delivery charges are shown in your cart before you pay. Places on Pakka Local’s list (PGs, hostels, colleges) have their own fixed charge; other addresses are charged by distance from the restaurant. Some restaurants give free delivery above an order amount.', actions: [{ label: 'Open cart', path: '/cart' }] };
  if (has(q, ' address', ' location', ' deliver to', ' wrong place')) return { reply: 'You choose the delivery place in the cart before paying: pick your PG, hostel or college from the list, or use your phone’s location. After an order is placed its delivery point can’t be changed in the app; message the delivery partner from the order page or ask our team.', actions: [{ label: 'Open cart', path: '/cart' }] };
  if (has(q, ' coupon', ' offer', ' discount', ' promo')) return { reply: 'Available coupons are shown in your cart under “Offers & coupons”. Tap Apply, and the saving appears in the bill before you pay.', actions: [{ label: 'Open cart', path: '/cart' }] };
  if (has(q, ' rider', ' delivery partner', ' call ', ' contact ')) return { reply: active.length ? 'You can message your delivery partner from the order page once one is assigned.' : 'Once a delivery partner is assigned to your order, you can message them from the order page.', actions: active.length ? [{ label: 'Open my order', path: `/orders/${active[0].order_code}` }] : [] };
  if (has(q, ' missing', ' wrong item', ' spilled', ' cold', ' quality', ' bad food', ' damaged')) return { reply: 'Sorry about that. Tap “Not solved” and I’ll connect you to our team: tell them what went wrong and they will sort it out with the restaurant.', actions: [], handoff: 'Order issue' };
  if (has(q, ' hi ', ' hello', ' hey ', ' namaste')) return { reply: 'Hi! I can tell you where your order is and explain refunds, delivery charges, coupons and more. Ask me anything.', actions: [{ label: 'Where is my order?', ask: 'Where is my order?' }, { label: 'Refund status', ask: 'Refund status' }] };
  return { reply: 'I’m not sure about that one. Could you say it another way (for example “where is my order”, “refund”, “delivery charge”)? If I still can’t help, tap “Not solved” and I’ll connect you to our team.', actions: [], handoff: 'Other' };
}
