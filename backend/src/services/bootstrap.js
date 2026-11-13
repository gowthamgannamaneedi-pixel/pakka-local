// First admin for a fresh deployment on a host without SSH (Hostinger web apps). Runs only while the database has no
// admin at all. The random password is written ONLY to a private file in SECRETS_DIR (mode 600), never to logs, the API
// or the frontend. The person deploying reads it once in the host's file manager, then deletes the file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

export const FIRST_LOGIN_FILE = 'ADMIN-FIRST-LOGIN.txt';

export function bootstrapAdmin(db, { phone, name, secretsDir }) {
  if (!phone) return { created: false, reason: 'not_requested' };
  if (!secretsDir) throw new Error('BOOTSTRAP_ADMIN_PHONE needs SECRETS_DIR (where the first password is saved).');
  if (!/^\+91[6-9]\d{9}$/.test(phone)) throw new Error('BOOTSTRAP_ADMIN_PHONE must look like +91XXXXXXXXXX.');
  if (db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get()) return { created: false, reason: 'admin_exists' };
  if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) throw new Error('BOOTSTRAP_ADMIN_PHONE is already used by another account.');
  const pw = crypto.randomBytes(18).toString('base64url');                 // 24 characters, ~144 bits
  fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  const file = path.join(secretsDir, FIRST_LOGIN_FILE);
  // the file is written before the account exists, so a crash can never leave an admin whose password nobody knows
  fs.writeFileSync(file, `Pakka Local first admin login (created ${new Date().toISOString()})\nPortal: /admin/\nMobile: ${phone}\nPassword: ${pw}\n\nDelete this file after you have saved the password somewhere safe.\n`, { mode: 0o600 });
  db.prepare("INSERT INTO users (role, phone, name, password_hash) VALUES ('admin', ?, ?, ?)").run(phone, name || 'Admin', bcrypt.hashSync(pw, 12));
  return { created: true, file };
}

// Facts for the startup log line: proves on the host which Node runs and whether the database survived a redeploy.
export function startupFacts(db) {
  const first = db.prepare('SELECT applied_at FROM schema_migrations ORDER BY applied_at LIMIT 1').pluck().get();
  return { node: process.version, db_created: first || null, migrations: db.prepare('SELECT COUNT(*) FROM schema_migrations').pluck().get(),
    rss_mb: Math.round(process.memoryUsage().rss / 1048576) };
}
