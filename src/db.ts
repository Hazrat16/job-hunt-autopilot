// SQLite job store (node:sqlite, no native modules). The same job seen on several boards is stored once.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { DATA_DIR, type Variant } from './config.ts';
import type { Eligibility } from './eligibility.ts';
import type { JobScore, ScoreInput } from './match.ts';
import type { RawJob } from './sources/types.ts';

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
  status: Status;
  status_at: string | null;
  notes: string | null;
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
`);

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

export type UpsertResult = 'new' | 'duplicate' | 'updated' | 'seen';

/**
 * Inserts a job, or merges it into the stored copy: records the extra source, and keeps the
 * longer description (LinkedIn search cards often have none), re-scoring when it changes.
 */
export function upsertJob(job: RawJob, score: (j: ScoreInput) => JobScore): UpsertResult {
  const now = new Date().toISOString();
  const known = db.prepare('SELECT job_id FROM job_sources WHERE source = ? AND source_id = ?').get(job.source, job.sourceId) as
    | { job_id: number }
    | undefined;
  if (known) {
    db.prepare('UPDATE jobs SET last_seen = ? WHERE id = ?').run(now, known.job_id);
    return 'seen';
  }

  const key = dedupeKey(job);
  const existing = db.prepare('SELECT * FROM jobs WHERE dedupe_key = ?').get(key);
  if (existing) {
    const row = parse(existing);
    db.prepare('INSERT OR IGNORE INTO job_sources (source, source_id, job_id) VALUES (?, ?, ?)').run(job.source, job.sourceId, row.id);
    const seenOn = [...new Set([...row.seen_on, job.source])];
    const better = job.description.length > row.description.length + 200;
    if (better) {
      // Score with everything known about the job, not just this source's location fields.
      const hints = [...new Set([...row.location_hints, ...(job.locationHints ?? [])])];
      const s = score({ title: row.title, description: job.description, location: job.location ?? row.location ?? undefined, locationHints: hints });
      db.prepare(
        `UPDATE jobs SET seen_on = ?, last_seen = ?, description = ?, location = COALESCE(?, location), location_hints = ?,
           salary = COALESCE(salary, ?), score = ?, variant = ?, eligibility = ?, eligibility_reason = ?, matched = ?, missing = ?, seniority = ?
         WHERE id = ?`,
      ).run(
        JSON.stringify(seenOn), now, job.description, job.location ?? null, JSON.stringify(hints),
        job.salary ?? null, s.score, s.variant, s.eligibility, s.eligibilityReason,
        JSON.stringify(s.matched), JSON.stringify(s.missing), s.seniority, row.id,
      );
    } else {
      db.prepare('UPDATE jobs SET seen_on = ?, last_seen = ?, salary = COALESCE(salary, ?) WHERE id = ?').run(JSON.stringify(seenOn), now, job.salary ?? null, row.id);
    }
    return better ? 'updated' : 'duplicate';
  }

  const s = score(job);
  const res = db
    .prepare(
      `INSERT INTO jobs (dedupe_key, source, source_id, seen_on, url, apply_url, title, company, location, location_hints, description,
         tags, salary, posted_at, first_seen, last_seen, score, variant, eligibility, eligibility_reason, matched, missing, seniority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      key, job.source, job.sourceId, JSON.stringify([job.source]), job.url, job.applyUrl ?? null, job.title, job.company,
      job.location ?? null, JSON.stringify(job.locationHints ?? []), job.description, JSON.stringify(job.tags ?? []),
      job.salary ?? null, job.postedAt ?? null, now, now, s.score, s.variant, s.eligibility, s.eligibilityReason,
      JSON.stringify(s.matched), JSON.stringify(s.missing), s.seniority,
    );
  db.prepare('INSERT INTO job_sources (source, source_id, job_id) VALUES (?, ?, ?)').run(job.source, job.sourceId, res.lastInsertRowid);
  return 'new';
}

export function getJob(id: number): JobRow | undefined {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  return row && parse(row);
}

export interface JobFilter { minScore?: number; eligibility?: Eligibility[]; status?: Status[]; sinceDays?: number; firstSeenAfter?: string; limit?: number }

/** Best matches first. */
export function listJobs(f: JobFilter = {}): JobRow[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.minScore !== undefined) (where.push('score >= ?'), args.push(f.minScore));
  if (f.eligibility?.length) (where.push(`eligibility IN (${f.eligibility.map(() => '?').join(',')})`), args.push(...f.eligibility));
  if (f.status?.length) (where.push(`status IN (${f.status.map(() => '?').join(',')})`), args.push(...f.status));
  if (f.sinceDays) (where.push("COALESCE(posted_at, first_seen) >= ?"), args.push(new Date(Date.now() - f.sinceDays * 864e5).toISOString()));
  if (f.firstSeenAfter) (where.push('first_seen >= ?'), args.push(f.firstSeenAfter));
  const sql = `SELECT * FROM jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY score DESC, COALESCE(posted_at, first_seen) DESC LIMIT ?`;
  return db.prepare(sql).all(...args, f.limit ?? 50).map(parse);
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

export function setStatus(id: number, status: Status, notes?: string): void {
  db.prepare('UPDATE jobs SET status = ?, status_at = ?, notes = COALESCE(?, notes) WHERE id = ?').run(status, new Date().toISOString(), notes ?? null, id);
}
