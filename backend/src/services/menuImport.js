// Admin "Import menu": add many dishes to one restaurant from a pasted list (CSV: Category, Dish, Price, Diet, Prep_min).
// Categories are created when missing, dishes already on the menu (same name) are skipped, nothing is ever deleted.
// Imported dishes have no photo of their own: customers see a photo of that kind of dish, labelled "Representative image",
// until the restaurant uploads its own photo.
const DIETS = { veg: 'veg', v: 'veg', vegetarian: 'veg', nonveg: 'nonveg', 'non-veg': 'nonveg', 'non veg': 'nonveg', nv: 'nonveg', egg: 'egg' };
export const MAX_ROWS = 400;

// one CSV line -> fields (handles "quoted, fields" and "" inside quotes)
function fields(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out.map((s) => s.trim());
}

export function parseMenu(text) {
  const rows = [], errors = [];
  String(text || '').split(/\r?\n/).forEach((raw, idx) => {
    const line = idx + 1; if (!raw.trim()) return;
    const [cat, name, price, diet = '', prep = ''] = fields(raw);
    if (idx === 0 && /^category$/i.test(cat) && /^dish|name/i.test(name || '')) return;          // header row
    const rupees = Number(String(price || '').replace(/[₹,\s]|rs\.?/gi, ''));
    if (!name || name.length > 80) return errors.push({ line, error: 'Dish name missing or longer than 80 letters.' });
    if (!Number.isFinite(rupees) || rupees <= 0 || rupees > 100000) return errors.push({ line, error: `Price for ${name} is not a number.` });
    const d = diet ? DIETS[diet.toLowerCase()] : null;
    if (diet && !d) return errors.push({ line, error: `Food type for ${name} should be veg, nonveg or egg.` });
    const p = prep ? Number(prep) : 15;
    if (!Number.isInteger(p) || p < 1 || p > 180) return errors.push({ line, error: `Cooking time for ${name} should be 1 to 180 minutes.` });
    rows.push({ line, category: (cat || '').slice(0, 40), name, price_paise: Math.round(rupees * 100), diet: d, prep: p });
  });
  if (rows.length > MAX_ROWS) errors.push({ line: 0, error: `Up to ${MAX_ROWS} dishes at a time.` });
  return { rows, errors };
}

// dryRun: count only. Otherwise everything is added in one go, or nothing when the list has a mistake.
export function importMenu(db, rid, text, { dryRun = false } = {}) {
  const { rows, errors } = parseMenu(text);
  if (!rows.length && !errors.length) return { ok: false, status: 400, error: 'Paste the menu first: one dish per line.' };
  if (errors.length) return { ok: false, status: 400, error: `Line ${errors[0].line}: ${errors[0].error}`, errors };
  const have = new Set(db.prepare('SELECT lower(name) FROM food_items WHERE restaurant_id=? AND deleted=0').pluck().all(rid));
  const cats = new Map(db.prepare('SELECT id, name FROM food_categories WHERE restaurant_id=?').all(rid).map((c) => [c.name.toLowerCase(), c.id]));
  const seen = new Set(), add = [], skipped = [];
  for (const r of rows) { const k = r.name.toLowerCase(); if (have.has(k) || seen.has(k)) skipped.push(r.name); else { seen.add(k); add.push(r); } }
  const newCats = [...new Set(add.map((r) => r.category).filter((c) => c && !cats.has(c.toLowerCase())).map((c) => c))]
    .filter((c, i, a) => a.findIndex((x) => x.toLowerCase() === c.toLowerCase()) === i);
  const out = { ok: true, added: add.length, skipped: skipped.length, skipped_names: skipped.slice(0, 20), new_categories: newCats };
  if (dryRun || !add.length) return out;
  db.transaction(() => {
    let order = db.prepare('SELECT COALESCE(MAX(sort_order),0) FROM food_categories WHERE restaurant_id=?').pluck().get(rid);
    for (const c of newCats) cats.set(c.toLowerCase(), db.prepare('INSERT INTO food_categories (restaurant_id,name,sort_order) VALUES (?,?,?)').run(rid, c, ++order).lastInsertRowid);
    const ins = db.prepare('INSERT INTO food_items (restaurant_id,category_id,name,image_path,base_price_paise,prep_time_min,available,diet) VALUES (?,?,?,NULL,?,?,1,?)');
    for (const r of add) ins.run(rid, r.category ? cats.get(r.category.toLowerCase()) : null, r.name, r.price_paise, r.prep, r.diet);
  })();
  return out;
}
