// Production clean-up: removes the test / demo accounts and test data before going live.
// Finds them by clear markers only (synthetic +91 5xxxxxxxxx numbers that cannot be real Indian mobiles, the staging admin
// +91 9700000099, the placeholder +91 1234567890, and names starting "TEST " or "Demo "). The main admin, the person running
// it and every real account are never touched. Each item is deleted when nothing points at it; when it has history
// (orders, payouts...) the database refuses the delete and the item is switched off instead, so order history stays intact.
// A full database backup is taken first; if the backup fails nothing is changed.
const TEST_PHONE = "(u.phone LIKE '+915%' OR u.phone IN ('+919700000099','+911234567890'))";
const TEST_NAME = "(u.name GLOB 'TEST *' OR u.name GLOB 'Demo *')";      // exact capitals: 'Test Kitchen' is not a test marker

export function cleanupPreview(db, { keepIds = [] } = {}) {
  const keep = new Set(keepIds.map(Number));
  const users = db.prepare(`SELECT u.id, u.role, u.name, u.phone, u.active FROM users u WHERE (${TEST_PHONE} OR ${TEST_NAME}) ORDER BY u.role, u.id`).all().filter((u) => !keep.has(u.id));
  const restaurants = db.prepare("SELECT id, name, admin_visible FROM restaurants WHERE name GLOB 'TEST *' OR name GLOB 'Demo Restaurant*' ORDER BY id").all();
  const places = db.prepare("SELECT id, name, active FROM delivery_locations WHERE name GLOB 'TEST *' ORDER BY id").all();
  // restaurant logins that belong only to test restaurants
  const rids = restaurants.map((r) => r.id);
  const owners = rids.length ? db.prepare(`SELECT u.id, u.role, u.name, u.phone, u.active FROM users u JOIN restaurant_users ru ON ru.user_id=u.id WHERE ru.restaurant_id IN (${rids.map(() => '?').join(',')})`).all(...rids) : [];
  for (const o of owners) if (!users.some((u) => u.id === o.id) && !keep.has(o.id)) users.push(o);
  return { users, restaurants, places };
}

function tryDelete(db, fn) { try { db.transaction(fn)(); return 'deleted'; } catch { return null; } }

export function runCleanup(db, { keepIds = [] } = {}) {
  const p = cleanupPreview(db, { keepIds }), out = [];
  const off = (id) => db.prepare('UPDATE users SET active = 0, token_version = token_version + 1 WHERE id = ?').run(id);
  for (const u of p.users) {
    const done = tryDelete(db, () => {
      for (const sql of ['DELETE FROM push_subscriptions WHERE user_id = ?', 'DELETE FROM notifications WHERE user_id = ?', 'DELETE FROM customer_addresses WHERE customer_id = ?',
        'DELETE FROM customers WHERE user_id = ?', 'DELETE FROM rider_verification_history WHERE rider_id = ?', 'DELETE FROM rider_phone_otps WHERE rider_id = ?',
        'DELETE FROM riders WHERE user_id = ?', 'DELETE FROM restaurant_users WHERE user_id = ?', 'DELETE FROM admin_verify_codes WHERE user_id = ?']) {
        try { db.prepare(sql).run(u.id); } catch (e) { if (!/no such (table|column)/.test(e.message)) throw e; }
      }
      db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    });
    if (!done) off(u.id);
    out.push({ kind: u.role, name: u.name, phone: u.phone, result: done || 'switched off (has history)' });
  }
  for (const r of p.restaurants) {
    const done = tryDelete(db, () => {
      for (const t of ['food_items', 'food_categories', 'restaurant_operating_status', 'restaurant_users']) { try { db.prepare(`DELETE FROM ${t} WHERE restaurant_id = ?`).run(r.id); } catch (e) { if (!/no such (table|column)/.test(e.message)) throw e; } }
      db.prepare('DELETE FROM restaurants WHERE id = ?').run(r.id);
    });
    if (!done) db.prepare('UPDATE restaurants SET admin_visible = 0 WHERE id = ?').run(r.id);
    out.push({ kind: 'restaurant', name: r.name, result: done || 'hidden (has orders)' });
  }
  for (const l of p.places) {
    const done = tryDelete(db, () => db.prepare('DELETE FROM delivery_locations WHERE id = ?').run(l.id));
    if (!done) db.prepare('UPDATE delivery_locations SET active = 0 WHERE id = ?').run(l.id);
    out.push({ kind: 'delivery place', name: l.name, result: done || 'switched off (has orders)' });
  }
  return out;
}
