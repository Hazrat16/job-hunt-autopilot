// One fetch run: every source in parallel, then dedupe, score and store.
import { config } from './config.ts';
import { deleteStaleJobs, getJob, jobIdBySource, setKv, upsertJob, type JobRow, type UpsertResult } from './db.ts';
import { isRelevantTitle, scoreJob } from './match.ts';
import { arbeitnow, himalayas, hnWhosHiring, jobicy, remoteok, remotive, weworkremotely } from './sources/boards.ts';
import { ashby, greenhouse, lever } from './sources/companies.ts';
import { linkedin } from './sources/linkedin.ts';
import { jobFromInput } from './sources/manual.ts';
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

/** A job you found yourself (pasted text or a link): scored and stored whatever the score. */
export async function addManualJob(input: { text?: string; url?: string; title?: string; company?: string }): Promise<JobRow> {
  const job = await jobFromInput(input);
  if (job.description.length < 80) throw new Error("Couldn't read a job description from that. Paste the job text instead.");
  upsertJob(job, scoreJob);
  return getJob(jobIdBySource(job.source, job.sourceId)!)!;
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
  deleteStaleJobs(config.delete_untouched_after_days);
  const sources = allSources().filter((s) => !only?.length || only.includes(s.name));
  return Promise.all(
    sources.map(async (s): Promise<SourceReport> => {
      const t0 = Date.now();
      const counts: Record<UpsertResult, number> = { new: 0, duplicate: 0, updated: 0, seen: 0, low: 0, ignored: 0 };
      try {
        const jobs = await s.fetch(isRelevantTitle);
        const fresh = jobs.filter((j) => !isTooOld(j) && j.title && j.company);
        for (const j of fresh) counts[upsertJob(j, scoreJob, config.min_score_to_save)]++;
        return { source: s.name, fetched: jobs.length, tooOld: jobs.length - fresh.length, counts, ms: Date.now() - t0 };
      } catch (e) {
        return { source: s.name, fetched: 0, tooOld: 0, counts, error: (e as Error).message, ms: Date.now() - t0 };
      }
    }),
  );
}
