import { config } from './config.js';
import { openDb } from './db/index.js';
import { createApp } from './app.js';
import { startJobs } from './jobs.js';

const db = openDb(config.dbPath);
const server = createApp(db).listen(config.port, () => console.log(`Pakka Local API listening on ${config.port}`));
const stopJobs = startJobs(db, config.backupDir);
const shutdown = () => { stopJobs(); server.close(() => { db.close(); process.exit(0); }); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
