// `npm start`: the local dashboard, the Telegram bot and the scheduler (fetch every few hours, digest once a day).
// The schedule is checked every minute against times stored in the database, so a laptop
// that was asleep or a restarted process catches up instead of skipping a run.
import { config } from './config.ts';
import { getKv, setKv } from './db.ts';
import { fetchAllShared } from './pipeline.ts';
import { startServer } from './server.ts';
import { sendDigest, startBot } from './telegram.ts';

const log = (msg: string) => console.log(`${new Date().toLocaleString('sv')} ${msg}`);

function localDate(d = new Date()): string {
  return d.toLocaleDateString('sv'); // YYYY-MM-DD in local time
}

function digestDue(now: Date): boolean {
  const [h, m] = config.schedule.digest_at.split(':').map(Number);
  const at = new Date(now);
  at.setHours(h, m, 0, 0);
  return now >= at && getKv('last_digest') !== localDate(now);
}

function fetchDue(now: Date): boolean {
  const last = getKv('last_fetch');
  return !last || now.getTime() - new Date(last).getTime() >= config.schedule.fetch_every_hours * 3600e3;
}

let busy = false;

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const now = new Date();
    if (fetchDue(now)) {
      log('fetching jobs…');
      const reports = await fetchAllShared();
      const failed = reports.filter((r) => r.error).map((r) => r.source);
      log(`fetched: ${reports.reduce((n, r) => n + r.counts.new, 0)} new${failed.length ? `, failed: ${failed.join(', ')}` : ''}`);
    }
    if (digestDue(now)) {
      const sent = await sendDigest();
      // No chat registered yet: try again next minute, so /start still gets today's digest.
      if (sent !== undefined) {
        setKv('last_digest', localDate(now));
        log(`digest sent: ${sent} job(s)`);
      }
    }
  } catch (err) {
    log(`scheduler error: ${(err as Error).message}`);
  } finally {
    busy = false;
  }
}

log(`started: fetch every ${config.schedule.fetch_every_hours}h, digest at ${config.schedule.digest_at}`);
startServer().catch((err) => log(`dashboard failed to start: ${(err as Error).message}`));
// Startup can hit a network blip; keep retrying rather than run without the bot.
(async function runBot() {
  for (;;) {
    try {
      return await startBot();
    } catch (err) {
      log(`bot failed to start (${(err as Error).message}), retrying in 15s`);
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
})();
void tick();
setInterval(tick, 60_000);
