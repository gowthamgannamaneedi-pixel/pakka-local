import { config } from './config.js';
import { openDb } from './db/index.js';
import { createApp } from './app.js';
import { startJobs, backupIfDue } from './jobs.js';
import { bootstrapAdmin, startupFacts } from './services/bootstrap.js';

const db = openDb(config.dbPath);
const boot = bootstrapAdmin(db, { phone: (process.env.BOOTSTRAP_ADMIN_PHONE || '').trim(), name: process.env.BOOTSTRAP_ADMIN_NAME, secretsDir: config.secretsDir });
if (boot.created) console.log('First admin created; its password is in the secrets folder (ADMIN-FIRST-LOGIN.txt).');
const server = createApp(db).listen(config.port, () => console.log(`Pakka Local API listening on ${config.port}`, JSON.stringify({ app_env: config.appEnv, ...startupFacts(db) })));
const stopJobs = startJobs(db, config.backupDir, { backupKeep: config.backupKeep });
// a host that restarts the app often (deployments, idle stops) still gets its daily backup soon after start
const firstBackup = setTimeout(() => backupIfDue(db, config.backupDir, { everyHours: 24, keep: config.backupKeep }).catch((e) => console.error('backup:', e.message)), 60_000);
const shutdown = () => { clearTimeout(firstBackup); stopJobs(); server.close(() => { db.close(); process.exit(0); }); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
