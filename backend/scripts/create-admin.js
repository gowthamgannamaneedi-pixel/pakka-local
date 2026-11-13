// Usage: ADMIN_PHONE=+91XXXXXXXXXX ADMIN_NAME="Owner" ADMIN_PASSWORD='long-passphrase' npm run create-admin
// No default credentials exist anywhere in the codebase.
import bcrypt from 'bcryptjs';
import { config } from '../src/config.js';
import { openDb } from '../src/db/index.js';
const { ADMIN_PHONE: phone, ADMIN_NAME: name, ADMIN_PASSWORD: pw } = process.env;
if (!phone || !name || !pw || pw.length < 12) { console.error('Set ADMIN_PHONE, ADMIN_NAME and ADMIN_PASSWORD (12+ chars).'); process.exit(1); }
const db = openDb(config.dbPath);
if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) { console.error('That phone is already registered.'); process.exit(1); }
db.prepare("INSERT INTO users (role, phone, name, password_hash) VALUES ('admin', ?, ?, ?)").run(phone, name, bcrypt.hashSync(pw, 12));
console.log('Admin created.');
