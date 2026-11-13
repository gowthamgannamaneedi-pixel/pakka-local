// One pass of every scheduled task, then exit. For hosts that stop idle apps (Hostinger web apps): run it from cron
// every minute, e.g.  /opt/alt/alt-nodejs22/root/bin/node --env-file=/home/USER/pakka-data/app.env /home/USER/domains/DOMAIN/hbuilds/current/nodejs/backend/scripts/run-jobs.js
// Safe to run while the app is running (SQLite WAL + busy timeout). Prints one summary line; never prints personal data.
import { config } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { runJobsOnce } from '../src/jobs.js';

const db = openDb(config.dbPath);
try {
  const r = await runJobsOnce(db, config.backupDir, { backupKeep: config.backupKeep });
  console.log(new Date().toISOString(), 'jobs', JSON.stringify(r));
} finally { db.close(); }
