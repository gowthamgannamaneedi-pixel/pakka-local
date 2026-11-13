import fs from 'node:fs';
import path from 'node:path';
import { backupDb } from './db/index.js';
import { purgeLocations } from './services/tracking.js';
import { purgeRouteCache } from './services/routing.js';
import { expireStalePayments } from './services/core.js';
import { dispatchPush, processCampaigns } from './services/push.js';
// Runs on the server regardless of any browser session.
export function reopenDueRestaurants(db, now = new Date()) {
  return db.prepare(`UPDATE restaurant_operating_status SET is_open = 1, reopen_mode = NULL, reopen_at = NULL, updated_at = ?
    WHERE is_open = 0 AND reopen_mode = 'auto' AND reopen_at IS NOT NULL AND reopen_at <= ?`)
    .run(now.toISOString(), now.toISOString()).changes;
}

const BACKUP_RE = /^pakka-local-.*\.sqlite$/;
const backupsIn = (dir) => { try { return fs.readdirSync(dir).filter((f) => BACKUP_RE.test(f)).sort(); } catch { return []; } };
// A backup only when the newest one is older than everyHours; keeps the newest `keep` backups (older ones are deleted).
export async function backupIfDue(db, dir, { everyHours = 24, keep = 14, now = Date.now() } = {}) {
  const files = backupsIn(dir), last = files.length ? fs.statSync(path.join(dir, files.at(-1))).mtimeMs : 0;
  let made = null;
  if (now - last >= everyHours * 3600_000) made = await backupDb(db, dir);
  const all = backupsIn(dir), removed = all.slice(0, Math.max(0, all.length - keep));
  for (const f of removed) fs.rmSync(path.join(dir, f), { force: true });
  return { made, removed: removed.length };
}

// One pass of every scheduled task. Used by the cron entry point (scripts/run-jobs.js) on hosts that stop idle apps
// (Hostinger web apps), where in-process timers cannot be relied on. Each task is independent: one failure never stops the rest.
export async function runJobsOnce(db, backupDir, { backupEveryHours = 24, backupKeep = 14 } = {}) {
  const out = {}, run = async (name, fn) => { try { out[name] = await fn(); } catch (e) { out[name] = 'error'; console.error(`${name}:`, e.message); } };
  await run('reopened', () => reopenDueRestaurants(db));
  await run('payments_expired', () => expireStalePayments(db));
  await run('campaigns', () => processCampaigns(db));
  await run('push', () => dispatchPush(db));
  await run('locations_purged', () => purgeLocations(db));
  await run('routes_purged', () => purgeRouteCache(db));
  await run('backup', async () => { const r = await backupIfDue(db, backupDir, { everyHours: backupEveryHours, keep: backupKeep }); return { made: !!r.made, removed: r.removed }; });
  return out;
}

export function startJobs(db, backupDir, { backupKeep = 14 } = {}) {
  const timers = [
    setInterval(() => { try { reopenDueRestaurants(db); } catch (e) { console.error('reopen job:', e.message); } }, 15_000),
    setInterval(() => { try { expireStalePayments(db); } catch (e) { console.error('payment expiry:', e.message); } }, 60_000),
    (() => { let busy = false; return setInterval(async () => { if (busy) return; busy = true; try { processCampaigns(db); await dispatchPush(db); } catch (e) { console.error('push job:', e.message); } finally { busy = false; } }, 2000); })(),
    setInterval(() => { try { purgeLocations(db); } catch (e) { console.error('location cleanup:', e.message); } }, 60_000),      // backstop; the database trigger does the immediate cleanup
    setInterval(() => { try { purgeRouteCache(db); } catch (e) { console.error('route cache cleanup:', e.message); } }, 6 * 3600_000),      // expired road distances
    setInterval(() => backupIfDue(db, backupDir, { everyHours: 6, keep: backupKeep }).catch(e => console.error('backup:', e.message)), 6 * 3600_000)
  ];
  return () => timers.forEach(clearInterval);
}
