// Coupons. All checks happen on the server; the browser only sends a code. The discount is paid by Pakka Local:
// restaurant payout and rider earnings are calculated exactly as before.
import { iso } from './core.js';

export const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,23}$/;
const used = (db, couponId, customerId) => db.prepare(`SELECT COUNT(*) FROM coupon_redemptions WHERE coupon_id=? AND status IN ('reserved','used')${customerId ? ' AND customer_id=?' : ''}`).pluck().get(...(customerId ? [couponId, customerId] : [couponId]));
const rupees = (p) => '₹' + (p / 100).toFixed(2).replace(/\.00$/, '');

// Is this code usable for this customer, restaurant and food subtotal right now? Returns { coupon, discount } or { error }.
export function evaluate(db, rawCode, { customerId, restaurantId, subtotal }) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!CODE_RE.test(code)) return { error: 'That coupon code is not valid.' };
  const c = db.prepare('SELECT * FROM coupons WHERE code=? AND deleted_at IS NULL').get(code), now = iso();
  if (!c || !c.active) return { error: 'That coupon code is not valid.' };
  if (c.starts_at && now < c.starts_at) return { error: 'This coupon is not active yet.' };
  if (c.ends_at && now > c.ends_at) return { error: 'This coupon has expired.' };
  if (c.restaurant_id && c.restaurant_id !== restaurantId) return { error: 'This coupon is not valid for this restaurant.' };
  if (subtotal < c.min_order_paise) return { error: `Add items worth ${rupees(c.min_order_paise - subtotal)} more to use ${code} (minimum ${rupees(c.min_order_paise)}).` };
  if (c.max_uses != null && used(db, c.id) >= c.max_uses) return { error: 'This coupon has been fully used.' };
  if (customerId && used(db, c.id, customerId) >= c.per_customer_limit) return { error: c.per_customer_limit === 1 ? 'You have already used this coupon.' : `You can use this coupon ${c.per_customer_limit} times.` };
  let d = c.discount_type === 'percent' ? Math.floor(subtotal * c.value / 10000) : c.value;
  if (c.max_discount_paise != null) d = Math.min(d, c.max_discount_paise);
  d = Math.max(0, Math.min(d, subtotal));                     // never more than the food itself
  return { coupon: c, discount: d };
}

export const reserve = (db, couponId, orderId, customerId, discount) => db.prepare('INSERT INTO coupon_redemptions (coupon_id,order_id,customer_id,discount_paise) VALUES (?,?,?,?)').run(couponId, orderId, customerId, discount);
export const markUsed = (db, orderId) => db.prepare("UPDATE coupon_redemptions SET status='used' WHERE order_id=? AND status='reserved'").run(orderId);
export const release = (db, orderId) => db.prepare("UPDATE coupon_redemptions SET status='released' WHERE order_id=? AND status='reserved'").run(orderId);

// Offers a customer can see in the cart: active, current, not used up, with their own remaining uses.
export function visibleCoupons(db, customerId, restaurantId) {
  const now = iso();
  return db.prepare(`SELECT * FROM coupons WHERE deleted_at IS NULL AND active=1 AND (starts_at IS NULL OR starts_at<=?) AND (ends_at IS NULL OR ends_at>=?)
      AND (restaurant_id IS NULL OR restaurant_id=?) ORDER BY id DESC LIMIT 20`).all(now, now, restaurantId ?? -1)
    .filter((c) => (c.max_uses == null || used(db, c.id) < c.max_uses) && (!customerId || used(db, c.id, customerId) < c.per_customer_limit))
    .map((c) => ({ code: c.code, description: c.description, discount_type: c.discount_type, value: c.value, min_order_paise: c.min_order_paise, max_discount_paise: c.max_discount_paise, ends_at: c.ends_at }));
}

// ---- admin ----
export function adminList(db) {
  return db.prepare('SELECT * FROM coupons WHERE deleted_at IS NULL ORDER BY id DESC').all().map((c) => {
    const st = db.prepare("SELECT COUNT(*) AS uses, COUNT(DISTINCT customer_id) AS customers, COALESCE(SUM(discount_paise),0) AS discount FROM coupon_redemptions WHERE coupon_id=? AND status='used'").get(c.id);
    const pending = db.prepare("SELECT COUNT(*) FROM coupon_redemptions WHERE coupon_id=? AND status='reserved'").pluck().get(c.id);
    const now = iso(), state = !c.active ? 'disabled' : c.ends_at && c.ends_at < now ? 'expired' : c.starts_at && c.starts_at > now ? 'scheduled' : c.max_uses != null && st.uses + pending >= c.max_uses ? 'used_up' : 'live';
    return { ...c, uses: st.uses, customers: st.customers, discount_given_paise: st.discount, reserved: pending, state, restaurant: c.restaurant_id ? db.prepare('SELECT name FROM restaurants WHERE id=?').pluck().get(c.restaurant_id) : null };
  });
}
export function validateInput(db, b, existingId) {
  const code = String(b.code || '').trim().toUpperCase();
  if (!CODE_RE.test(code)) return { error: 'Code: 3–24 letters, numbers, - or _ (e.g. WELCOME50).' };
  if (db.prepare('SELECT 1 FROM coupons WHERE code=? AND deleted_at IS NULL AND id<>?').get(code, existingId ?? -1)) return { error: 'A coupon with this code already exists.' };
  const type = b.discount_type === 'flat' ? 'flat' : b.discount_type === 'percent' ? 'percent' : null; if (!type) return { error: 'Choose percentage or fixed amount.' };
  const int = (v) => (v === '' || v == null ? null : Number(v));
  const value = int(b.value), min = int(b.min_order_paise) ?? 0, maxD = int(b.max_discount_paise), maxU = int(b.max_uses), per = int(b.per_customer_limit) ?? 1;
  if (!Number.isInteger(value) || value <= 0 || (type === 'percent' && value > 10000) || (type === 'flat' && value > 1_000_000)) return { error: type === 'percent' ? 'Percentage must be between 0.01% and 100%.' : 'Discount amount must be ₹0.01–₹10,000.' };
  for (const [v, n] of [[min, 'Minimum order'], [maxD, 'Maximum discount'], [maxU, 'Total uses'], [per, 'Uses per customer']]) if (v != null && (!Number.isInteger(v) || v < 0 || v > 100_000_000)) return { error: `${n} is not valid.` };
  if (per < 1) return { error: 'Uses per customer must be at least 1.' };
  if (maxU != null && maxU < 1) return { error: 'Total uses must be at least 1 (or empty for no limit).' };
  const d = (v) => (v ? new Date(v) : null), sa = d(b.starts_at), ea = d(b.ends_at);
  if ((sa && isNaN(sa)) || (ea && isNaN(ea))) return { error: 'Dates are not valid.' };
  if (sa && ea && ea <= sa) return { error: 'Expiry must be after the start date.' };
  const rid = b.restaurant_id ? Number(b.restaurant_id) : null;
  if (rid && !db.prepare('SELECT 1 FROM restaurants WHERE id=?').get(rid)) return { error: 'Unknown restaurant.' };
  return { ok: { code, description: String(b.description || '').trim().slice(0, 160) || null, discount_type: type, value, min_order_paise: min, max_discount_paise: maxD, max_uses: maxU, per_customer_limit: per,
    starts_at: sa ? sa.toISOString() : null, ends_at: ea ? ea.toISOString() : null, active: b.active === false || b.active === 0 ? 0 : 1, restaurant_id: rid } };
}
export function save(db, admin, b, id) {
  const v = validateInput(db, b, id); if (v.error) return { error: v.error, status: 400 };
  const c = v.ok;
  if (id) {
    if (!db.prepare('SELECT 1 FROM coupons WHERE id=? AND deleted_at IS NULL').get(id)) return { error: 'Coupon not found.', status: 404 };
    db.prepare(`UPDATE coupons SET code=?,description=?,discount_type=?,value=?,min_order_paise=?,max_discount_paise=?,max_uses=?,per_customer_limit=?,starts_at=?,ends_at=?,active=?,restaurant_id=?,updated_at=? WHERE id=?`)
      .run(c.code, c.description, c.discount_type, c.value, c.min_order_paise, c.max_discount_paise, c.max_uses, c.per_customer_limit, c.starts_at, c.ends_at, c.active, c.restaurant_id, iso(), id);
    return { ok: true, id };
  }
  const nid = db.prepare(`INSERT INTO coupons (code,description,discount_type,value,min_order_paise,max_discount_paise,max_uses,per_customer_limit,starts_at,ends_at,active,restaurant_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(c.code, c.description, c.discount_type, c.value, c.min_order_paise, c.max_discount_paise, c.max_uses, c.per_customer_limit, c.starts_at, c.ends_at, c.active, c.restaurant_id, admin.id).lastInsertRowid;
  return { ok: true, id: nid };
}
// Delete keeps the row (orders keep pointing at it) but frees the code and hides it everywhere.
export const remove = (db, id) => (db.prepare('UPDATE coupons SET deleted_at=?, active=0 WHERE id=? AND deleted_at IS NULL').run(iso(), id).changes ? { ok: true } : { error: 'Coupon not found.', status: 404 });
