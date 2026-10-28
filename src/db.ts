// SQLite job store (node:sqlite, no native modules). The same job seen on several boards is stored once.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { DATA_DIR, type Variant } from './config.ts';
import type { Eligibility } from './eligibility.ts';
import type { JobScore, ScoreInput } from './match.ts';
import type { RawJob } from './sources/types.ts';
import { WORK_TYPE_RULES, workType, type WorkType } from './work-type.ts';

export type Status = 'new' | 'saved' | 'applied' | 'interview' | 'offer' | 'rejected' | 'skipped';

export interface JobRow {
  id: number;
  dedupe_key: string;
  source: string;
  source_id: string;
  seen_on: string[];
  url: string;
  apply_url: string | null;
  title: string;
  company: string;
  location: string | null;
  location_hints: string[];
  description: string;
  tags: string[];
  salary: string | null;
  posted_at: string | null;
  first_seen: string;
  last_seen: string;
  score: number;
  variant: Variant;
  eligibility: Eligibility;
  eligibility_reason: string;
  matched: string[];
  missing: string[];
  seniority: string;
  work_type: WorkType;
  status: Status;
  status_at: string | null;
  notes: string | null;
  /** When the job was sent in a Telegram digest. */
  notified_at: string | null;
  /** When the "applied N days ago" follow-up was sent. */
  reminded_at: string | null;
}

const JSON_COLS = ['seen_on', 'location_hints', 'tags', 'matched', 'missing'] as const;

export const db = new DatabaseSync(path.join(DATA_DIR, 'jobs.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY,
    dedupe_key TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    seen_on TEXT NOT NULL DEFAULT '[]',
    url TEXT NOT NULL,
    apply_url TEXT,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT,
    location_hints TEXT NOT NULL DEFAULT '[]',
    description TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    salary TEXT,
    posted_at TEXT,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    score INTEGER NOT NULL,
    variant TEXT NOT NULL,
    eligibility TEXT NOT NULL,
    eligibility_reason TEXT NOT NULL,
    matched TEXT NOT NULL DEFAULT '[]',
    missing TEXT NOT NULL DEFAULT '[]',
    seniority TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    status_at TEXT,
    notes TEXT
  );
  CREATE TABLE IF NOT EXISTS job_sources (
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    job_id INTEGER NOT NULL REFERENCES jobs(id),
    PRIMARY KEY (source, source_id)
  );
  CREATE INDEX IF NOT EXISTS jobs_score ON jobs(score DESC);
  -- Fetched jobs that aren't stored (low score) or were cleaned up, so later fetches don't add them back.
  CREATE TABLE IF NOT EXISTS ignored_sources (source TEXT NOT NULL, source_id TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY (source, source_id));
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS job_events (job_id INTEGER NOT NULL REFERENCES jobs(id), status TEXT NOT NULL, at TEXT NOT NULL);
`);

// Columns added after the first release.
const cols = new Set(db.prepare('PRAGMA table_info(jobs)').all().map((c) => c.name as string));
for (const c of ['notified_at', 'reminded_at']) if (!cols.has(c)) db.exec(`ALTER TABLE jobs ADD COLUMN ${c} TEXT`);
if (!cols.has('work_type')) db.exec("ALTER TABLE jobs ADD COLUMN work_type TEXT NOT NULL DEFAULT 'unknown'");
// Stored jobs are classified from their text, so a source's own workplace field isn't reapplied here.
if (getKv('work_type_rules') !== String(WORK_TYPE_RULES)) {
  const update = db.prepare('UPDATE jobs SET work_type = ? WHERE id = ?');
  db.exec('BEGIN');
  for (const r of db.prepare('SELECT id, source, title, location, location_hints, description FROM jobs').all() as any[])
    update.run(workType({ ...r, locationHints: JSON.parse(r.location_hints) }), r.id);
  db.exec('COMMIT');
  setKv('work_type_rules', String(WORK_TYPE_RULES));
}

/** Small persistent settings/state (Telegram chat id, last fetch time, ...). */
export function getKv(key: string): string | undefined {
  return (db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined)?.value;
}

export function setKv(key: string, value: string): void {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

function parse(row: Record<string, unknown>): JobRow {
  const r: any = { ...row };
  for (const c of JSON_COLS) r[c] = JSON.parse(r[c] ?? '[]');
  return r as JobRow;
}

const COMPANY_SUFFIX = /\b(inc|llc|ltd|limited|gmbh|corp|corporation|co|plc|sa|bv|ag|pty|s\.?r\.?l)\b\.?/g;

/** Same company + same title (ignoring "(Remote)", punctuation, legal suffixes) = same job. */
export function dedupeKey(job: Pick<RawJob, 'company' | 'title'>): string {
  const company = job.company.toLowerCase().replace(COMPANY_SUFFIX, '').replace(/[^a-z0-9]+/g, '');
  const title = job.title
    .toLowerCase()
    .replace(/\((remote|worldwide|anywhere|global|contract|full[- ]?time)[^)]*\)/g, '')
    .replace(/[-–|,]\s*(remote|worldwide|anywhere|global)\b.*$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `${company}|${title}`;
}

export type UpsertResult = 'new' | 'duplicate' | 'updated' | 'seen' | 'low' | 'ignored';

/**
 * Inserts a job, or merges it into the stored copy: records the extra source, and keeps the
 * longer description (LinkedIn search cards often have none), re-scoring when it changes.
 * With minScore (fetches, not manual adds), a new job (with a description) scoring below it is not
 * stored and its source id is remembered; ignored source ids are skipped.
 */
export function upsertJob(job: RawJob, score: (j: ScoreInput) => JobScore, minScore?: number): UpsertResult {
  if (minScore !== undefined && isIgnored(job.source, job.sourceId)) return 'ignored';
  const now = new Date().toISOString();
  const known = db.prepare('SELECT job_id FROM job_sources WHERE source = ? AND source_id = ?').get(job.source, job.sourceId) as
    | { job_id: number }
    | undefined;
  const key = dedupeKey(job);
  const existing = known ? db.prepare('SELECT * FROM jobs WHERE id = ?').get(known.job_id) : db.prepare('SELECT * FROM jobs WHERE dedupe_key = ?').get(key);
  if (existing) {
    const row = parse(existing);
    if (!known) db.prepare('INSERT INTO job_sources (source, source_id, job_id) VALUES (?, ?, ?)').run(job.source, job.sourceId, row.id);
    const seenOn = [...new Set([...row.seen_on, job.source])];
    const better = job.description.length > row.description.length + 200;
    if (better) {
      // Score with everything known about the job, not just this source's location fields.
      const hints = [...new Set([...row.location_hints, ...(job.locationHints ?? [])])];
      const s = score({ title: row.title, description: job.description, location: job.location ?? row.location ?? undefined, locationHints: hints });
      db.prepare(
        `UPDATE jobs SET seen_on = ?, last_seen = ?, description = ?, location = COALESCE(?, location), location_hints = ?,
           salary = COALESCE(salary, ?), score = ?, variant = ?, eligibility = ?, eligibility_reason = ?, matched = ?, missing = ?, seniority = ?,
           work_type = ?
         WHERE id = ?`,
      ).run(
        JSON.stringify(seenOn), now, job.description, job.location ?? null, JSON.stringify(hints),
        job.salary ?? null, s.score, s.variant, s.eligibility, s.eligibilityReason,
        JSON.stringify(s.matched), JSON.stringify(s.missing), s.seniority,
        workType({ ...job, location: job.location ?? row.location ?? undefined, locationHints: hints }), row.id,
      );
    } else {
      db.prepare('UPDATE jobs SET seen_on = ?, last_seen = ?, salary = COALESCE(salary, ?) WHERE id = ?').run(JSON.stringify(seenOn), now, job.salary ?? null, row.id);
    }
    return better ? 'updated' : known ? 'seen' : 'duplicate';
  }

  const s = score(job);
  if (minScore !== undefined && s.score < minScore && job.description) {
    db.prepare("INSERT OR REPLACE INTO ignored_sources (source, source_id, reason) VALUES (?, ?, 'low score')").run(job.source, job.sourceId);
    return 'low';
  }
  const res = db
    .prepare(
      `INSERT INTO jobs (dedupe_key, source, source_id, seen_on, url, apply_url, title, company, location, location_hints, description,
         tags, salary, posted_at, first_seen, last_seen, score, variant, eligibility, eligibility_reason, matched, missing, seniority, work_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      key, job.source, job.sourceId, JSON.stringify([job.source]), job.url, job.applyUrl ?? null, job.title, job.company,
      job.location ?? null, JSON.stringify(job.locationHints ?? []), job.description, JSON.stringify(job.tags ?? []),
      job.salary ?? null, job.postedAt ?? null, now, now, s.score, s.variant, s.eligibility, s.eligibilityReason,
      JSON.stringify(s.matched), JSON.stringify(s.missing), s.seniority, workType(job),
    );
  db.prepare('INSERT INTO job_sources (source, source_id, job_id) VALUES (?, ?, ?)').run(job.source, job.sourceId, res.lastInsertRowid);
  return 'new';
}

export function jobIdBySource(source: string, sourceId: string): number | undefined {
  return (db.prepare('SELECT job_id FROM job_sources WHERE source = ? AND source_id = ?').get(source, sourceId) as { job_id: number } | undefined)?.job_id;
}

function isIgnored(source: string, sourceId: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM ignored_sources WHERE source = ? AND source_id = ?').get(source, sourceId));
}

/** Whether a source's job is stored with a description (LinkedIn search cards arrive without one). */
export function hasDescription(source: string, sourceId: string): boolean {
  return (
    isIgnored(source, sourceId) ||
    Boolean(db.prepare("SELECT 1 FROM job_sources s JOIN jobs j ON j.id = s.job_id WHERE s.source = ? AND s.source_id = ? AND j.description != ''").get(source, sourceId))
  );
}

export function getJob(id: number): JobRow | undefined {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  return row && parse(row);
}

export interface JobFilter {
  workType?: WorkType[];
  /** Hides untouched (status new) jobs posted more than this many days ago. */
  freshDays?: number;
  minScore?: number; eligibility?: Eligibility[]; status?: Status[]; sinceDays?: number; firstSeenAfter?: string; source?: string; q?: string; limit?: number }

/** Best matches first. */
export function listJobs(f: JobFilter = {}): JobRow[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.minScore !== undefined) (where.push('score >= ?'), args.push(f.minScore));
  if (f.eligibility?.length) (where.push(`eligibility IN (${f.eligibility.map(() => '?').join(',')})`), args.push(...f.eligibility));
  if (f.workType?.length) (where.push(`work_type IN (${f.workType.map(() => '?').join(',')})`), args.push(...f.workType));
  if (f.status?.length) (where.push(`status IN (${f.status.map(() => '?').join(',')})`), args.push(...f.status));
  if (f.sinceDays) (where.push("COALESCE(posted_at, first_seen) >= ?"), args.push(new Date(Date.now() - f.sinceDays * 864e5).toISOString()));
  if (f.freshDays) (where.push("(status != 'new' OR COALESCE(posted_at, first_seen) >= ?)"), args.push(new Date(Date.now() - f.freshDays * 864e5).toISOString()));
  if (f.firstSeenAfter) (where.push('first_seen >= ?'), args.push(f.firstSeenAfter));
  // Any board the job was seen on, not just the first one.
  if (f.source) (where.push('EXISTS (SELECT 1 FROM job_sources s WHERE s.job_id = jobs.id AND s.source = ?)'), args.push(f.source));
  if (f.q) {
    where.push('(title LIKE ? OR company LIKE ? OR description LIKE ?)');
    const like = `%${f.q}%`;
    args.push(like, like, like);
  }
  const sql = `SELECT * FROM jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY score DESC, COALESCE(posted_at, first_seen) DESC LIMIT ?`;
  return db.prepare(sql).all(...args, f.limit ?? 50).map(parse);
}

/**
 * Deletes jobs posted more than `days` ago that you never acted on (still "new", no notes, no status
 * changes), remembering their source ids so fetches don't add them back. Returns how many were deleted.
 */
export function deleteStaleJobs(days: number): number {
  const before = new Date(Date.now() - days * 864e5).toISOString();
  const stale = `SELECT id FROM jobs WHERE status = 'new' AND (notes IS NULL OR notes = '') AND COALESCE(posted_at, first_seen) < ?
    AND NOT EXISTS (SELECT 1 FROM job_events e WHERE e.job_id = jobs.id)`;
  db.exec('BEGIN');
  db.prepare(`INSERT OR REPLACE INTO ignored_sources (source, source_id, reason) SELECT source, source_id, 'stale' FROM job_sources WHERE job_id IN (${stale})`).run(before);
  db.prepare(`DELETE FROM job_sources WHERE job_id IN (${stale})`).run(before);
  const n = Number(db.prepare(`DELETE FROM jobs WHERE id IN (${stale})`).run(before).changes);
  db.exec('COMMIT');
  return n;
}

/** Re-scores every stored job, e.g. after editing config.yaml or the profile. */
export function rescoreAll(score: (j: ScoreInput) => JobScore): number {
  const rows = db.prepare('SELECT * FROM jobs').all().map(parse);
  const update = db.prepare('UPDATE jobs SET score = ?, variant = ?, eligibility = ?, eligibility_reason = ?, matched = ?, missing = ?, seniority = ? WHERE id = ?');
  db.exec('BEGIN');
  for (const r of rows) {
    const s = score({ title: r.title, description: r.description, locationHints: r.location_hints, location: r.location ?? undefined });
    update.run(s.score, s.variant, s.eligibility, s.eligibilityReason, JSON.stringify(s.matched), JSON.stringify(s.missing), s.seniority, r.id);
  }
  db.exec('COMMIT');
  return rows.length;
}

/** Good matches not sent yet, best first. */
export function digestJobs(minScore: number, eligibility: Eligibility[], limit: number): JobRow[] {
  return db
    .prepare(
      `SELECT * FROM jobs WHERE status = 'new' AND notified_at IS NULL AND score >= ?
         AND eligibility IN (${eligibility.map(() => '?').join(',')})
       ORDER BY score DESC, COALESCE(posted_at, first_seen) DESC LIMIT ?`,
    )
    .all(minScore, ...eligibility, limit)
    .map(parse);
}

export function markNotified(ids: number[]): void {
  const stmt = db.prepare('UPDATE jobs SET notified_at = ? WHERE id = ?');
  const now = new Date().toISOString();
  for (const id of ids) stmt.run(now, id);
}

/** Jobs you applied to at least `days` ago that haven't moved on and haven't been reminded about. */
export function followUps(days: number): JobRow[] {
  const before = new Date(Date.now() - days * 864e5).toISOString();
  return db.prepare("SELECT * FROM jobs WHERE status = 'applied' AND status_at <= ? AND reminded_at IS NULL").all(before).map(parse);
}

export function markReminded(id: number): void {
  db.prepare('UPDATE jobs SET reminded_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}

export function stats(): { total: number; week: number; good: number; byStatus: Record<string, number> } {
  const week = new Date(Date.now() - 7 * 864e5).toISOString();
  const one = (sql: string, ...a: string[]) => Number((db.prepare(sql).get(...a) as { n: number }).n);
  const byStatus = Object.fromEntries(
    (db.prepare('SELECT status, COUNT(*) n FROM jobs GROUP BY status').all() as { status: string; n: number }[]).map((r) => [r.status, r.n]),
  );
  return {
    total: one('SELECT COUNT(*) n FROM jobs'),
    week: one('SELECT COUNT(*) n FROM jobs WHERE first_seen >= ?', week),
    good: one("SELECT COUNT(*) n FROM jobs WHERE score >= 50 AND eligibility != 'restricted' AND first_seen >= ?", week),
    byStatus,
  };
}

export function setStatus(id: number, status: Status, notes?: string): void {
  const now = new Date().toISOString();
  db.prepare('UPDATE jobs SET status = ?, status_at = ?, notes = COALESCE(?, notes) WHERE id = ?').run(status, now, notes ?? null, id);
  db.prepare('INSERT INTO job_events (job_id, status, at) VALUES (?, ?, ?)').run(id, status, now);
}

export function setNotes(id: number, notes: string): void {
  db.prepare('UPDATE jobs SET notes = ? WHERE id = ?').run(notes, id);
}

/** Status changes for a job, oldest first. */
export function jobEvents(id: number): { status: Status; at: string }[] {
  return db.prepare('SELECT status, at FROM job_events WHERE job_id = ? ORDER BY at').all(id) as { status: Status; at: string }[];
}

/** Source names with job counts, for filters. */
export function sourceCounts(): { source: string; n: number }[] {
  return db.prepare('SELECT source, COUNT(DISTINCT job_id) n FROM job_sources GROUP BY source ORDER BY n DESC').all() as { source: string; n: number }[];
}
