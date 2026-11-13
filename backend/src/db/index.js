import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { migrations } from './migrations.js';

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const done = new Set(db.prepare('SELECT id FROM schema_migrations').pluck().all());
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(m.id, new Date().toISOString());
    })();
  }
}

// Online, consistent backup (safe while the app is running).
export async function backupDb(db, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `pakka-local-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
  await db.backup(dest);
  return dest;
}
