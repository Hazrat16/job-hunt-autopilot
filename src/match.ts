import { config, type Variant } from './config.ts';
import { detectSkills } from './skills.ts';
import { phraseRegex } from './util.ts';
import { eligibility, type Eligibility } from './eligibility.ts';
import { profileSkills } from './profile.ts';
import type { RawJob } from './sources/types.ts';

const DEVOPS_SKILLS = new Set(['Kubernetes', 'Terraform', 'Ansible', 'AWS', 'Azure', 'GCP', 'CI/CD', 'Linux', 'Helm', 'Argo CD / GitOps', 'Prometheus', 'Grafana', 'Observability', 'Datadog', 'Jenkins', 'GitLab CI', 'GitHub Actions', 'Bash', 'Docker', 'Security scanning', 'Serverless', 'Nginx']);
const FRONTEND_SKILLS = new Set(['React', 'Next.js', 'Redux', 'TanStack Query', 'Tailwind CSS', 'Vite', 'HTML/CSS', 'Accessibility', 'Vue.js', 'Angular', 'Playwright']);
const BACKEND_SKILLS = new Set(['Node.js', 'Express', 'Fastify', 'NestJS', 'REST APIs', 'GraphQL', 'MongoDB', 'PostgreSQL', 'MySQL', 'Redis', 'Prisma', 'Message queues', 'Microservices', 'Socket.IO / WebSockets', 'JWT']);

const LANGUAGES = new Set(['Python', 'Go', 'Java', 'PHP', 'Ruby', '.NET / C#', 'Rust', 'C++', 'Scala', 'Elixir', 'Kotlin', 'Haskell', 'Clojure', 'Erlang', 'OCaml']);

const roleRe = Object.fromEntries(Object.entries(config.roles).map(([k, v]) => [k, phraseRegex(v)])) as Record<Exclude<Variant, 'ai'>, RegExp>;
const excludeRe = phraseRegex(config.exclude_titles);
const devopsCoreRe = /devops|dev ops|devsecops|\bsre\b|site reliability|platform|infrastructure/i;

/** Which role families a job title belongs to (empty = not a role you'd apply for). */
export function titleFamilies(title: string): Set<Exclude<Variant, 'ai'>> {
  const fams = new Set<Exclude<Variant, 'ai'>>();
  for (const [fam, re] of Object.entries(roleRe)) if (re.test(title)) fams.add(fam as Exclude<Variant, 'ai'>);
  return fams;
}

export function isRelevantTitle(title: string): boolean {
  return !excludeRe.test(title) && titleFamilies(title).size > 0;
}

/** Picks the CV variant that best fits a job. */
export function detectVariant(title: string, description: string): Variant {
  const fams = titleFamilies(title);
  const skills = detectSkills(`${title}\n${description}`);
  const count = (set: Set<string>) => [...skills].filter((s) => set.has(s)).length;
  const dev = count(DEVOPS_SKILLS), fe = count(FRONTEND_SKILLS), be = count(BACKEND_SKILLS);

  let v: Variant;
  if (fams.has('devops') && devopsCoreRe.test(title)) v = 'devops';
  else if (fams.has('cloud') || fams.has('devops')) v = 'cloud';
  else if (fams.has('frontend') && !fams.has('fullstack')) v = 'frontend';
  else if (fams.has('backend') && !fams.has('fullstack')) v = 'backend';
  else if (/full[- ]?stack|mern/i.test(title)) v = 'fullstack';
  // Generic titles ("Software Engineer"): decide from the description.
  else if (dev >= 5 && dev > (fe + be) * 0.8) v = 'devops';
  else if (fe >= 3 && fe > be * 1.5) v = 'frontend';
  else if (be >= 3 && be > fe * 1.5) v = 'backend';
  else v = 'fullstack';

  if ((v === 'fullstack' || v === 'backend') && skills.has('AI coding tools')) v = 'ai';
  return v;
}

const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const YEARS_RE =
  /(?:at least|minimum(?: of)?|min\.?)?\s*\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*\+?\s*(?:(?:-|–|to)\s*(\d{1,2})\s*\+?\s*)?(?:\(\d+\)\s*)?years?['’]?\s*(?:of\s+)?(?:[\w/.+#-]+\s+){0,4}?(?:experience|exp\b|in (?:a |an )?(?:similar|professional|software|devops|production))/gi;

/** Minimum years of experience the job asks for, if stated. */
export function requiredYears(text: string): { years: number; phrase: string } | undefined {
  let best: { years: number; phrase: string } | undefined;
  for (const m of text.matchAll(YEARS_RE)) {
    const n = NUM_WORDS[m[1].toLowerCase()] ?? Number(m[1]);
    if (!n || n > 15) continue;
    // The headline requirement is usually the largest one ("5+ years overall, 2+ with K8s").
    if (!best || n > best.years) best = { years: n, phrase: m[0].trim().replace(/\s+/g, ' ') };
  }
  return best;
}

/** Score adjustment for seniority, based on required years (falls back to title words). */
export function seniorityFit(title: string, description: string): { delta: number; note: string } {
  const mine = config.experience_years;
  const req = requiredYears(description);
  if (req) {
    if (req.years <= Math.ceil(mine)) return { delta: 5, note: `asks ${req.years}y (you have ${mine}y)` };
    if (req.years <= Math.ceil(mine) + 1) return { delta: -8, note: `asks ${req.years}y, slight stretch` };
    if (req.years <= Math.ceil(mine) + 2) return { delta: -18, note: `asks ${req.years}y, stretch` };
    return { delta: -35, note: `asks ${req.years}y, likely too senior` };
  }
  if (phraseRegex(config.seniority.title_penalty).test(title)) return { delta: -25, note: 'staff/principal title' };
  if (phraseRegex(config.seniority.title_bonus).test(title)) return { delta: 5, note: 'junior/mid title' };
  return { delta: 0, note: 'years not stated' };
}

const REQUIREMENT_LINE = /\b(strong|solid|deep|proficien|expert|fluent|required|must|essential|\d\+? ?years?)/i;

/** Skills named on a line that reads like a hard requirement ("Strong Haskell skills", "3+ years of Go"). */
function requiredSkills(description: string): Set<string> {
  const out = new Set<string>();
  for (const line of description.split('\n')) {
    if (line.length < 200 && REQUIREMENT_LINE.test(line) && !/nice to have|bonus|plus\b|preferred/i.test(line)) {
      for (const s of detectSkills(line, false)) out.add(s);
    }
  }
  return out;
}

export interface JobScore {
  score: number;
  variant: Variant;
  eligibility: Eligibility;
  eligibilityReason: string;
  matched: string[];
  missing: string[];
  seniority: string;
}

/**
 * Match score 0–100: role fit (30), skill overlap (up to 50), eligibility (up to 15),
 * plus the seniority adjustment. Restricted jobs are capped at 20 so they never reach the digest.
 */
export type ScoreInput = Pick<RawJob, 'title' | 'description' | 'location' | 'locationHints'>;

export function scoreJob(job: ScoreInput): JobScore {
  const mine = profileSkills();
  const jobSkills = [...detectSkills(`${job.title}\n${job.description}`)];
  const matched = jobSkills.filter((s) => mine.has(s));
  const missing = jobSkills.filter((s) => !mine.has(s));
  const el = eligibility(job);
  const sen = seniorityFit(job.title, job.description);

  const role = isRelevantTitle(job.title) ? 30 : 0;
  // Match ratio pulled toward 50% when few skills are detected: 3 of 3 is weaker evidence than 12 of 12.
  const overlap = (matched.length + 1.5) / (jobSkills.length + 3);
  // Every missing skill also costs a little, so a long list of gaps outweighs a high ratio.
  // A missing language costs more (it's usually the job's main stack), and one named in the title most.
  const titleSkills = detectSkills(job.title);
  const required = requiredSkills(job.description);
  const gaps = missing.reduce((n, s) => n + (titleSkills.has(s) ? 25 : LANGUAGES.has(s) ? (required.has(s) ? 20 : 6) : 2), 0);
  const skills = 50 * overlap - Math.min(gaps, 35);
  const elig = { worldwide: 15, asia: 15, unknown: 5, restricted: 0 }[el.eligibility];
  let score = Math.round(Math.max(0, Math.min(100, role + skills + elig + sen.delta)));
  if (el.eligibility === 'restricted') score = Math.min(score, 20);

  return {
    score,
    variant: detectVariant(job.title, job.description),
    eligibility: el.eligibility,
    eligibilityReason: el.reason,
    matched,
    missing,
    seniority: sen.note,
  };
}
