// Test-data seeder. Usage: DEMO_PASSWORD='pick-a-password' npm run seed-demo
// Refuses to run in production unless ALLOW_DEMO_SEED=1. Creates sample restaurants, menu, locations, riders and logins.
import bcrypt from 'bcryptjs';
import { config } from '../src/config.js';
import { openDb } from '../src/db/index.js';
const pw = process.env.DEMO_PASSWORD;
if (!pw || pw.length < 10) { console.error('Set DEMO_PASSWORD (10+ characters).'); process.exit(1); }
if (config.isProd && process.env.ALLOW_DEMO_SEED !== '1') { console.error('Refusing to seed demo data in production (set ALLOW_DEMO_SEED=1 to override).'); process.exit(1); }
const db = openDb(config.dbPath), hash = bcrypt.hashSync(pw, 12);
if (db.prepare('SELECT COUNT(*) FROM restaurants').pluck().get() > 0) { console.error('Database already has restaurants; not seeding.'); process.exit(1); }
const user = (role, phone, name) => db.prepare('INSERT INTO users (role,phone,name,password_hash) VALUES (?,?,?,?)').run(role, phone, name, hash).lastInsertRowid;
db.transaction(() => {
  const menus = [['Spice Route Biryani', 'Hyderabadi', 1000, 2000, [['Chicken Dum Biryani', 14000, 20], ['Veg Biryani', 11000, 18], ['Mutton Biryani', 19000, 25]], '+919000010001'],
    ['Dosa Corner', 'South Indian', 1500, 1000, [['Masala Dosa', 6000, 10], ['Idli (3 pcs)', 4000, 8], ['Fried Rice', 9000, 15]], '+919000010002']];
  const owners = [];
  for (const [name, cuisine, bps, markup, items, phone] of menus) {
    const rid = db.prepare('INSERT INTO restaurants (name,cuisine,address,phone,commission_bps,markup_paise,admin_visible,approved) VALUES (?,?,?,?,?,?,1,1)').run(name, cuisine, 'Main Road, Pilot Area', phone, bps, markup).lastInsertRowid;
    for (const [n, p, t] of items) db.prepare('INSERT INTO food_items (restaurant_id,name,base_price_paise,prep_time_min) VALUES (?,?,?,?)').run(rid, n, p, t);
    db.prepare('INSERT INTO restaurant_operating_status (restaurant_id,is_open) VALUES (?,1)').run(rid);
    db.prepare('INSERT INTO restaurant_users VALUES (?,?)').run(user('restaurant', phone, name + ' Owner'), rid); owners.push(`restaurant  ${phone}  (${name})`);
  }
  for (const [n, k, a, fee, km] of [['Sunrise Hostel', 'Hostel', 'Block A, College Road', 3000, 1.2], ['Green PG', 'PG', '12 Lake View Street', 4000, 2.0], ['Skyline Apartments', 'Apartment', 'Ring Road', 5000, 3.1]])
    db.prepare('INSERT INTO delivery_locations (name,kind,address,delivery_fee_paise,distance_km) VALUES (?,?,?,?,?)').run(n, k, a, fee, km);
  for (const [phone, name, reg] of [['+919000020001', 'Rahul', 'TS 09 AB 1234'], ['+919000020002', 'Ravi', 'TS 08 CD 5678']]) {
    const id = user('rider', phone, name);
    db.prepare("INSERT INTO riders (user_id,verification_status,vehicle_category,vehicle_make,vehicle_model,vehicle_reg_no,address,emergency_phone,licence_no) VALUES (?,'approved','Scooter','Honda','Activa',?,'Pilot Area','+919000099999','DL1234567')").run(id, reg);
    owners.push(`rider       ${phone}  (${name})`);
  }
  console.log('Created logins (all use DEMO_PASSWORD):\n  ' + owners.join('\n  '));
})();
