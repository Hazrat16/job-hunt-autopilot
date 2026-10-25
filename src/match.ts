import { config, type Variant } from './config.ts';
import { detectSkills } from './skills.ts';
import { phraseRegex } from './util.ts';

const DEVOPS_SKILLS = new Set(['Kubernetes', 'Terraform', 'Ansible', 'AWS', 'Azure', 'GCP', 'CI/CD', 'Linux', 'Helm', 'Argo CD / GitOps', 'Prometheus', 'Grafana', 'Observability', 'Datadog', 'Jenkins', 'GitLab CI', 'GitHub Actions', 'Bash', 'Docker', 'Security scanning', 'Serverless', 'Nginx']);
const FRONTEND_SKILLS = new Set(['React', 'Next.js', 'Redux', 'TanStack Query', 'Tailwind CSS', 'Vite', 'HTML/CSS', 'Accessibility', 'Vue.js', 'Angular', 'Playwright']);
const BACKEND_SKILLS = new Set(['Node.js', 'Express', 'Fastify', 'NestJS', 'REST APIs', 'GraphQL', 'MongoDB', 'PostgreSQL', 'MySQL', 'Redis', 'Prisma', 'Message queues', 'Microservices', 'Socket.IO / WebSockets', 'JWT']);

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
