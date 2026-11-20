// Restaurant opening hours and availability, always in Asia/Kolkata (IST = UTC+05:30, no daylight saving).
// One opening interval per weekday; a closing time at or before the opening time means it closes after midnight
// (e.g. 18:00-02:00 on Friday covers Friday 18:00 to Saturday 02:00).
// A customer can order only when: approved + visible, a confirmed location exists, the owner's Open switch is on,
// and (if hours are set) the time is within today's hours. Orders already placed are never affected by any of this.
const IST = 330 * 60_000;
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const istParts = (t) => { const d = new Date(t + IST); return { dow: d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes(), dayStartUtc: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - IST }; };
export const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const toMin = (s) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

// Weekly hours; a restaurant that has only the older single opening/closing time (profile form, or an app page loaded before
// the weekly hours existed) gets that time on all seven days until weekly hours are saved.
export const getHours = (db, rid) => {
  const rows = db.prepare('SELECT dow, closed, open_min, close_min FROM restaurant_hours WHERE restaurant_id=? ORDER BY dow').all(rid);
  if (rows.length) return rows;
  const r = db.prepare('SELECT opens_at, closes_at FROM restaurants WHERE id=?').get(rid), o = toMin(r?.opens_at), c = toMin(r?.closes_at);
  return o == null || c == null || o === c ? [] : [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, closed: 0, open_min: o, close_min: c }));
};

// Is "now" inside the weekly hours? null when no hours are set at all (then only the Open switch decides).
export function withinHours(rows, now = Date.now()) {
  if (!rows.length) return null;
  const { dow, min } = istParts(now), by = Object.fromEntries(rows.map((r) => [r.dow, r]));
  const t = by[dow], y = by[(dow + 6) % 7];
  if (t && !t.closed && t.open_min != null) {
    if (t.close_min > t.open_min ? min >= t.open_min && min < t.close_min : min >= t.open_min) return true;
  }
  if (y && !y.closed && y.open_min != null && y.close_min <= y.open_min && min < y.close_min) return true;      // yesterday's late shift
  return false;
}

// Next time the restaurant opens by its hours (ISO), within the coming 8 days; null if never (all days closed / no hours).
export function nextOpening(rows, now = Date.now()) {
  if (!rows.length) return null;
  const { dow, min, dayStartUtc } = istParts(now), by = Object.fromEntries(rows.map((r) => [r.dow, r]));
  for (let k = 0; k <= 7; k++) {
    const r = by[(dow + k) % 7]; if (!r || r.closed || r.open_min == null) continue;
    if (k === 0 && r.open_min <= min) continue;
    return new Date(dayStartUtc + k * 864e5 + r.open_min * 60_000).toISOString();
  }
  return null;
}

// Today's hours as shown to customers: { open: 'HH:MM', close: 'HH:MM' } | { closed: true } | null (not set)
export function todayHours(rows, now = Date.now()) {
  if (!rows.length) return null;
  const r = rows.find((x) => x.dow === istParts(now).dow);
  return !r || r.closed || r.open_min == null ? { closed: true } : { open: hhmm(r.open_min), close: hhmm(r.close_min) };
}

// Full availability for customers. reason: 'ok' | 'hidden' | 'no_location' | 'paused' | 'outside_hours'
export function availability(db, rid, now = Date.now()) {
  const r = db.prepare('SELECT approved, admin_visible, pickup_lat, location_confirmed_at FROM restaurants WHERE id=?').get(rid);
  if (!r || !r.approved || !r.admin_visible) return { open: false, reason: 'hidden' };
  const rows = getHours(db, rid), next = nextOpening(rows, now), today = todayHours(rows, now);
  if (r.pickup_lat == null || !r.location_confirmed_at) return { open: false, reason: 'no_location', today, next_open_at: null };
  const st = db.prepare('SELECT is_open, reopen_at FROM restaurant_operating_status WHERE restaurant_id=?').get(rid);
  if (!st?.is_open) return { open: false, reason: 'paused', today, next_open_at: st?.reopen_at || null };
  const inside = withinHours(rows, now);
  if (inside === false) return { open: false, reason: 'outside_hours', today, next_open_at: next };
  return { open: true, reason: 'ok', today, hours_set: inside !== null };
}

// Validate a full week from the restaurant portal. days: [{ dow, closed, open: 'HH:MM', close: 'HH:MM' }] x7
export function validateWeek(days) {
  if (!Array.isArray(days) || days.length !== 7) return { error: 'Send all seven days.' };
  const seen = new Set(), out = [];
  for (const d of days) {
    const dow = Number(d?.dow); if (!Number.isInteger(dow) || dow < 0 || dow > 6 || seen.has(dow)) return { error: 'Each day must appear once.' }; seen.add(dow);
    if (d.closed) { out.push({ dow, closed: 1, open_min: null, close_min: null }); continue; }
    const o = toMin(d.open), c = toMin(d.close);
    if (o == null || c == null) return { error: `${DAYS[dow]}: enter opening and closing time (e.g. 10:00 and 23:00), or mark it closed.` };
    if (o === c) return { error: `${DAYS[dow]}: opening and closing time cannot be the same.` };
    out.push({ dow, closed: 0, open_min: o, close_min: c });
  }
  return { ok: out };
}
export function saveWeek(db, rid, rows) {
  db.transaction(() => {
    db.prepare('DELETE FROM restaurant_hours WHERE restaurant_id=?').run(rid);
    const ins = db.prepare('INSERT INTO restaurant_hours (restaurant_id,dow,closed,open_min,close_min) VALUES (?,?,?,?,?)');
    for (const r of rows) ins.run(rid, r.dow, r.closed, r.open_min, r.close_min);
  })();
}
export const weekOut = (rows) => DAYS.map((name, dow) => { const r = rows.find((x) => x.dow === dow);
  return { dow, name, set: !!r, closed: r ? !!r.closed : false, open: r?.open_min != null ? hhmm(r.open_min) : '', close: r?.close_min != null ? hhmm(r.close_min) : '', overnight: !!(r && !r.closed && r.close_min <= r.open_min) }; });
