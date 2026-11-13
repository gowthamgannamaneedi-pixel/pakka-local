import { backupDb } from './db/index.js';
import { purgeLocations } from './services/tracking.js';
import { expireStalePayments } from './services/core.js';
import { dispatchPush, processCampaigns } from './services/push.js';
// Runs on the server regardless of any browser session.
export function reopenDueRestaurants(db, now = new Date()) {
  return db.prepare(`UPDATE restaurant_operating_status SET is_open = 1, reopen_mode = NULL, reopen_at = NULL, updated_at = ?
    WHERE is_open = 0 AND reopen_mode = 'auto' AND reopen_at IS NOT NULL AND reopen_at <= ?`)
    .run(now.toISOString(), now.toISOString()).changes;
}
export function startJobs(db, backupDir) {
  const timers = [
    setInterval(() => { try { reopenDueRestaurants(db); } catch (e) { console.error('reopen job:', e.message); } }, 15_000),
    setInterval(() => { try { expireStalePayments(db); } catch (e) { console.error('payment expiry:', e.message); } }, 60_000),
    (() => { let busy = false; return setInterval(async () => { if (busy) return; busy = true; try { processCampaigns(db); await dispatchPush(db); } catch (e) { console.error('push job:', e.message); } finally { busy = false; } }, 2000); })(),
    setInterval(() => { try { purgeLocations(db); } catch (e) { console.error('location cleanup:', e.message); } }, 60_000),      // backstop; the database trigger does the immediate cleanup
    setInterval(() => backupDb(db, backupDir).catch(e => console.error('backup:', e.message)), 6 * 3600_000)
  ];
  return () => timers.forEach(clearInterval);
}
