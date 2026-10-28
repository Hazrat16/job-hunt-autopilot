// Remote, hybrid or on-site: from the source's own field when it has one, else the location/title, else the description.
import type { RawJob } from './sources/types.ts';

export type WorkType = 'remote' | 'hybrid' | 'onsite' | 'unknown';
export const WORK_TYPES: WorkType[] = ['remote', 'hybrid', 'onsite', 'unknown'];
/** Bump when the rules below change: stored jobs are re-classified on the next start. */
export const WORK_TYPE_RULES = 2;

// Boards (and searches) that only list remote jobs.
const REMOTE_SOURCES = new Set(['remoteok', 'remotive', 'himalayas', 'jobicy', 'weworkremotely', 'arbeitnow', 'linkedin']);

const FIELD_HYBRID = /\bhybrid\b/i;
const FIELD_REMOTE = /\b(remote|anywhere|worldwide|work from home|wfh)\b/i;
const FIELD_ONSITE = /\b(on-?site|in[- ]office|in[- ]person|office[- ]based)\b/i;

// In a description "hybrid" alone is too loose ("hybrid cloud"), so these need context.
const DESC_HYBRID =
  /\b(hybrid (role|position|job|work|working|model|setup|schedule|arrangement|policy|opportunity)|(role|position|job) is hybrid|\d(-\d)? days? (a|per) week (in|at) (the|our) office|(in|at) (the|our) office \d(-\d)? days)\b/i;
const DESC_ONSITE =
  /\b(on-?site (role|position|job|opportunity)|(role|position|job) is (fully |100% )?on-?site|fully on-?site|in[- ]office (role|position|job)|5 days (a|per) week (in|at) (the|our) office|this is not a remote (role|position|job))\b/i;
const DESC_REMOTE =
  /\b(fully remote|100% remote|remote[- ](first|friendly|only)|work (from|at) home|work(ing)? remotely|remote (role|position|job|opportunity|work)|(role|position|job) is (fully )?remote|work from anywhere)\b/i;

export function workType(job: Pick<RawJob, 'source' | 'title' | 'location' | 'locationHints' | 'description'> & { workType?: WorkType }): WorkType {
  if (job.workType) return job.workType;
  const fields = [job.location, ...(job.locationHints ?? []), job.title].filter(Boolean).join(' | ');
  // "Hybrid or remote" still means you can work remotely.
  if (FIELD_REMOTE.test(fields)) return 'remote';
  if (FIELD_HYBRID.test(fields)) return 'hybrid';
  if (FIELD_ONSITE.test(fields)) return 'onsite';
  if (REMOTE_SOURCES.has(job.source)) return 'remote';
  const desc = job.description ?? '';
  if (DESC_HYBRID.test(desc)) return 'hybrid';
  if (DESC_ONSITE.test(desc)) return 'onsite';
  if (DESC_REMOTE.test(desc)) return 'remote';
  return 'unknown';
}

/** A source's own workplace field (Ashby "OnSite", Lever "onsite", ...), if it says something. */
export function parseWorkType(v: unknown): WorkType | undefined {
  const s = String(v ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return s === 'remote' ? 'remote' : s === 'hybrid' ? 'hybrid' : s === 'onsite' || s === 'inoffice' ? 'onsite' : undefined;
}
