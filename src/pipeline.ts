// One fetch run: every source in parallel, then dedupe, score and store.
import { config } from './config.ts';
import { setKv, upsertJob, type UpsertResult } from './db.ts';
import { isRelevantTitle, scoreJob } from './match.ts';
import { arbeitnow, himalayas, hnWhosHiring, jobicy, remoteok, remotive, weworkremotely } from './sources/boards.ts';
import { ashby, greenhouse, lever } from './sources/companies.ts';
import { linkedin } from './sources/linkedin.ts';
import type { RawJob, Source } from './sources/types.ts';

export function allSources(): Source[] {
  const w = config.watchlist;
  return [
    remoteok, remotive, himalayas, jobicy, weworkremotely, arbeitnow,
    ...(config.hn_whos_hiring ? [hnWhosHiring] : []),
    ...(w.greenhouse.length ? [greenhouse(w.greenhouse)] : []),
    ...(w.ashby.length ? [ashby(w.ashby)] : []),
    ...(w.lever.length ? [lever(w.lever)] : []),
    ...(config.linkedin.enabled ? [linkedin(config.linkedin)] : []),
  ];
}

export interface SourceReport { source: string; fetched: number; tooOld: number; counts: Record<UpsertResult, number>; error?: string; ms: number }

function isTooOld(job: RawJob): boolean {
  if (!job.postedAt) return false;
  return Date.now() - new Date(job.postedAt).getTime() > config.max_job_age_days * 864e5;
}

let inFlight: Promise<SourceReport[]> | undefined;

/** A full fetch of every source; joins the running one instead of starting a second. */
export function fetchAllShared(): Promise<SourceReport[]> {
  inFlight ??= fetchJobs()
    .then((r) => (setKv('last_fetch', new Date().toISOString()), r))
    .finally(() => (inFlight = undefined));
  return inFlight;
}

/** @param only source names to run (default: all). */
export async function fetchJobs(only?: string[]): Promise<SourceReport[]> {
  const sources = allSources().filter((s) => !only?.length || only.includes(s.name));
  return Promise.all(
    sources.map(async (s): Promise<SourceReport> => {
      const t0 = Date.now();
      const counts: Record<UpsertResult, number> = { new: 0, duplicate: 0, updated: 0, seen: 0 };
      try {
        const jobs = await s.fetch(isRelevantTitle);
        const fresh = jobs.filter((j) => !isTooOld(j) && j.title && j.company);
        for (const j of fresh) counts[upsertJob(j, scoreJob)]++;
        return { source: s.name, fetched: jobs.length, tooOld: jobs.length - fresh.length, counts, ms: Date.now() - t0 };
      } catch (e) {
        return { source: s.name, fetched: 0, tooOld: 0, counts, error: (e as Error).message, ms: Date.now() - t0 };
      }
    }),
  );
}
