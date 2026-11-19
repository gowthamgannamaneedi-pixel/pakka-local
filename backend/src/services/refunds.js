// Manual UPI refunds (no payment gateway refund API yet).
// A refund is still started only by the system (restaurant rejected / order cancelled): customers never start one.
// Stages: awaiting_details -> requested (customer gave a UPI ID) -> approved -> completed (admin paid, UTR recorded)
//         and rejected / failed with a reason. A refund is "completed" only when the admin records the payment reference.
import { iso, notify, logEvent } from './core.js';

export const UPI_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.]{1,63}$/;
const STAGE_TEXT = { awaiting_details: 'Add your UPI ID to receive the refund', requested: 'Refund requested, waiting for review', approved: 'Refund approved, payment in progress',
  completed: 'Refund paid', rejected: 'Refund request rejected', failed: 'Refund payment failed' };
const event = (db, refundId, stage, actor, note) => db.prepare('INSERT INTO refund_events (refund_id,stage,actor_user_id,note) VALUES (?,?,?,?)').run(refundId, stage, actor ?? null, note ?? null);
const tellCustomer = (db, r, stage, body) => {
  const o = db.prepare('SELECT id, order_code, customer_id FROM orders WHERE id=?').get(r.order_id);
  notify(db, o.customer_id, 'transactional', STAGE_TEXT[stage], body || `${o.order_code}: ${STAGE_TEXT[stage]}.`, `/user/orders/${o.order_code}`, o.id, `rf:${r.id}:${stage}`, 'refund');
};

// What the customer sees for their own order (UPI shown back only to its owner).
export function customerRefund(db, orderId) {
  const r = db.prepare('SELECT * FROM refunds WHERE order_id=?').get(orderId); if (!r) return null;
  return { id: r.id, amount_paise: r.amount_paise, stage: r.stage, stage_text: STAGE_TEXT[r.stage], upi_id: r.upi_id, upi_name: r.upi_name, reference: r.stage === 'completed' ? r.utr : null,
    note: ['rejected', 'failed'].includes(r.stage) ? r.admin_note : null, can_edit: ['awaiting_details', 'requested', 'failed'].includes(r.stage), updated_at: r.updated_at,
    history: db.prepare('SELECT stage, created_at FROM refund_events WHERE refund_id=? ORDER BY id').all(r.id) };
}

export function submitUpi(db, customerId, orderCode, b) {
  const o = db.prepare('SELECT id FROM orders WHERE order_code=? AND customer_id=?').get(String(orderCode), customerId);
  if (!o) return { error: 'Order not found.', status: 404 };
  const upi = String(b.upi_id || '').trim(), name = String(b.upi_name || '').trim().slice(0, 80);
  if (!UPI_RE.test(upi)) return { error: 'Enter a valid UPI ID, for example name@okaxis.', status: 400 };
  return db.transaction(() => {
    const r = db.prepare('SELECT * FROM refunds WHERE order_id=?').get(o.id);
    if (!r) return { error: 'There is no refund for this order.', status: 404 };
    if (!['awaiting_details', 'requested', 'failed'].includes(r.stage)) return { error: 'This refund is already being processed.', status: 409 };
    const first = r.stage !== 'requested';
    db.prepare("UPDATE refunds SET upi_id=?, upi_name=?, upi_submitted_at=?, stage='requested', updated_at=? WHERE id=?").run(upi, name || null, iso(), iso(), r.id);
    if (first) event(db, r.id, 'requested', customerId, null);
    return { ok: true, refund: customerRefund(db, o.id) };
  })();
}

export function adminList(db, stage) {
  const where = stage ? 'WHERE f.stage=?' : '';
  return db.prepare(`SELECT f.id, f.amount_paise, f.stage, f.reason, f.upi_id, f.upi_name, f.upi_submitted_at, f.utr, f.admin_note, f.processed_at, f.created_at, f.updated_at, f.status,
      o.order_code, o.status AS order_status, o.rejection_reason, u.name AS customer_name, u.phone AS customer_phone, r.name AS restaurant
    FROM refunds f JOIN orders o ON o.id=f.order_id JOIN users u ON u.id=o.customer_id JOIN restaurants r ON r.id=o.restaurant_id ${where}
    ORDER BY CASE f.stage WHEN 'requested' THEN 0 WHEN 'approved' THEN 1 WHEN 'failed' THEN 2 WHEN 'awaiting_details' THEN 3 ELSE 4 END, f.id DESC LIMIT 200`).all(...(stage ? [stage] : []))
    .map((x) => ({ ...x, history: db.prepare('SELECT e.stage, e.note, e.created_at, u.name AS by_name FROM refund_events e LEFT JOIN users u ON u.id=e.actor_user_id WHERE e.refund_id=? ORDER BY e.id').all(x.id) }));
}

// approve | reject | paid | failed. Every change is checked against the current stage inside one transaction (no double payment).
export function adminAct(db, admin, id, action, b = {}) {
  return db.transaction(() => {
    const r = db.prepare('SELECT * FROM refunds WHERE id=?').get(id);
    if (!r) return { error: 'Refund not found.', status: 404 };
    const note = String(b.note || '').trim().slice(0, 300), now = iso();
    const to = (stage, extra = '', args = []) => db.prepare(`UPDATE refunds SET stage=?, admin_note=?, reviewed_by=?, updated_at=?${extra} WHERE id=?`).run(stage, note || null, admin.id, now, ...args, id);
    if (action === 'approve') {
      if (r.stage !== 'requested') return { error: 'Only refunds with UPI details can be approved.', status: 409 };
      to('approved'); event(db, id, 'approved', admin.id, note); tellCustomer(db, r, 'approved');
    } else if (action === 'reject') {
      if (!['requested', 'approved', 'awaiting_details'].includes(r.stage)) return { error: 'This refund can no longer be rejected.', status: 409 };
      if (!note) return { error: 'Give a reason for rejecting.', status: 400 };
      to('rejected'); event(db, id, 'rejected', admin.id, note); tellCustomer(db, r, 'rejected', `Refund request was not accepted: ${note}`);
    } else if (action === 'paid') {
      if (r.stage !== 'approved') return { error: 'Approve the refund before marking it paid.', status: 409 };
      const utr = String(b.utr || '').trim();
      if (!/^[A-Za-z0-9-]{6,40}$/.test(utr)) return { error: 'Enter the UPI transaction reference (UTR) from your bank app.', status: 400 };
      if (db.prepare("SELECT 1 FROM refunds WHERE utr=? AND id<>?").get(utr, id)) return { error: 'This transaction reference is already used for another refund.', status: 409 };
      to('completed', ", utr=?, processed_at=?, status='REFUND_COMPLETED'", [utr, now]); event(db, id, 'completed', admin.id, `UTR ${utr}`);
      logEvent(db, r.order_id, 'REFUND_COMPLETED', { id: admin.id, role: 'admin' }, { utr });
      tellCustomer(db, r, 'completed', `We sent ₹${(r.amount_paise / 100).toFixed(2).replace(/\.00$/, '')} to ${r.upi_id}. Reference: ${utr}.`);
    } else if (action === 'failed') {
      if (r.stage !== 'approved') return { error: 'Only an approved refund can be marked as failed.', status: 409 };
      if (!note) return { error: 'Say why the payment failed so the customer can fix it.', status: 400 };
      to('failed'); event(db, id, 'failed', admin.id, note); tellCustomer(db, r, 'failed', `The refund payment did not go through: ${note}. Please check your UPI ID.`);
    } else return { error: 'Unknown action.', status: 400 };
    return { ok: true };
  })();
}
