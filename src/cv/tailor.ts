// Builds a job-specific CV from the master profile. Purely selective: it chooses and orders
// your own bullets/projects/skills and never writes new claims.
import { config, type Variant } from '../config.ts';
import { loadProfile, profileSkills, type Profile, type Section } from '../profile.ts';
import { detectSkills, skillFrequency, skillMention } from '../skills.ts';
import { detectVariant } from '../match.ts';

export interface JobInput { title: string; company?: string; description: string }

export interface TailoredCv {
  variant: Variant;
  headline: string;
  summary: string;
  /** Matched job skills, most-mentioned first, shown as one line under the summary. */
  coreStack: string[];
  basics: Profile['basics'];
  sections: Section[];
  aiPractice: string[];
  experience: { company: string; role: string; location: string; dates: string; subRoles?: string; bullets: { text: string; score: number }[] }[];
  projects: { title: string; url?: string; text: string; score: number }[];
  skills: { label: string; items: string[] }[];
  education: Profile['education'];
  report: { jobSkills: string[]; matched: string[]; missing: string[] };
}

const RELATED: Record<Variant, Variant[]> = {
  fullstack: ['ai', 'backend', 'frontend'],
  ai: ['fullstack', 'backend'],
  backend: ['fullstack', 'ai'],
  frontend: ['fullstack', 'ai'],
  devops: ['cloud'],
  cloud: ['devops'],
};

const MAX_BULLETS_PER_ROLE = 5;
const MAX_CORE_STACK = 8;
const EXTRA_SKILLS_LABEL = 'Additional';

function tagScore(tags: Variant[], v: Variant): number {
  if (tags.includes(v)) return 10;
  if (tags.some((t) => RELATED[v].includes(t))) return 4;
  return 0;
}

function overlapScore(text: string, jobFreq: Map<string, number>): number {
  let s = 0;
  for (const skill of detectSkills(text, false)) s += Math.min(jobFreq.get(skill) ?? 0, 3);
  return s * 2;
}

// Standard titles the CV headline may use, by variant. The job's title picks among these;
// it is never copied verbatim, so the headline can't claim tech you don't have.
const HEADLINES: Record<Variant, [RegExp, string][]> = {
  devops: [
    [/site reliability|\bsre\b/i, 'Site Reliability Engineer'],
    [/platform engineer/i, 'Platform Engineer'],
    [/infrastructure engineer/i, 'Infrastructure Engineer'],
    [/devsecops/i, 'DevSecOps Engineer'],
  ],
  cloud: [
    [/platform engineer/i, 'Platform Engineer'],
    [/cloud (operations|ops)/i, 'Cloud Operations Engineer'],
  ],
  frontend: [
    [/react (developer|engineer)/i, 'React Developer'],
    [/front[- ]?end developer/i, 'Frontend Developer'],
  ],
  backend: [
    [/node(\.?js)? (developer|engineer)/i, 'Node.js Engineer'],
    [/back[- ]?end developer/i, 'Backend Developer'],
  ],
  fullstack: [
    [/full[- ]?stack developer/i, 'Full-Stack Developer'],
    [/software engineer/i, 'Software Engineer'],
    [/software developer/i, 'Software Developer'],
  ],
  ai: [[/full[- ]?stack developer/i, 'Full-Stack Developer']],
};

function headlineFor(job: JobInput, v: Variant, fallback: string): string {
  return HEADLINES[v].find(([re]) => re.test(job.title))?.[1] ?? fallback;
}

export function tailor(job: JobInput, forceVariant?: Variant): TailoredCv {
  const p = loadProfile();
  const v = forceVariant ?? detectVariant(job.title, job.description);
  const spec = p.variants[v];
  const jobText = `${job.title}\n${job.description}`;
  const jobFreq = skillFrequency(jobText);
  const mine = profileSkills();

  const experience = p.experience.map((exp) => {
    // Best phrasing per group, then the top bullets, most relevant first (ties keep profile order).
    const best = new Map<string, { text: string; score: number; order: number }>();
    exp.bullets.forEach((b, i) => {
      const base = tagScore(b.tags, v);
      if (!base) return;
      const score = base + overlapScore(b.text, jobFreq);
      const key = b.group ?? `#${i}`;
      const prev = best.get(key);
      if (!prev || score > prev.score) best.set(key, { text: b.text, score, order: prev?.order ?? i });
    });
    const bullets = [...best.values()]
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .slice(0, MAX_BULLETS_PER_ROLE)
      .map(({ text, score }) => ({ text, score }));
    return {
      company: exp.company,
      role: exp.role,
      location: exp.location,
      dates: `${exp.start} – ${exp.end}`,
      subRoles: exp.sub_roles,
      bullets,
    };
  });

  const maxProjects = config.cv.max_projects[v] ?? config.cv.max_projects.default ?? 3;
  const projects = p.projects
    .map((proj) => {
      const options = proj.descriptions
        .map((d) => ({ d, score: tagScore(d.tags, v) && tagScore(d.tags, v) + overlapScore(d.text, jobFreq) }))
        .filter((o) => o.score > 0)
        .sort((a, b) => b.score - a.score);
      const top = options[0];
      return top && { title: top.d.title, url: proj.url, text: top.d.text, score: top.score };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxProjects);

  let lines = p.skills.filter((s) => s.tags.includes(v));
  if (!lines.length) lines = p.skills.filter((s) => s.tags.some((t) => RELATED[v].includes(t)));
  const skills = lines.map((line) => {
    const hit = (item: string) => [...detectSkills(item, false)].reduce((n, s) => n + (jobFreq.get(s) ?? 0), 0);
    // Stable sort: job-relevant items first, original order otherwise.
    const items = line.items.map((item, i) => ({ item, i, h: hit(item) })).sort((a, b) => (b.h > 0 ? 1 : 0) - (a.h > 0 ? 1 : 0) || a.i - b.i).map((x) => x.item);
    return { label: line.label, items };
  });

  const jobSkills = [...jobFreq.keys()];
  const matched = jobSkills.filter((s) => mine.has(s));
  const cv: TailoredCv = {
    variant: v,
    headline: headlineFor(job, v, spec.title),
    summary: spec.summary,
    coreStack: matched.length >= 2 ? [...matched].sort((a, b) => jobFreq.get(b)! - jobFreq.get(a)!).slice(0, MAX_CORE_STACK) : [],
    basics: p.basics,
    sections: spec.sections,
    aiPractice: spec.sections.includes('ai_practice') ? p.ai_practice : [],
    experience,
    projects,
    skills,
    education: p.education,
    report: {
      jobSkills,
      matched,
      missing: jobSkills.filter((s) => !mine.has(s)),
    },
  };
  // Keyword guarantee: a matched skill whose bullets didn't make the cut is listed under skills instead.
  return addToSkills(cv, uncovered(cv, cvText(cv)));
}

/**
 * The CV's content as plain text, for keyword checks before rendering. Leaves out the
 * core-stack line, so every skill named there is also backed by a bullet or skills entry.
 */
function cvText(cv: TailoredCv): string {
  return [
    cv.headline,
    cv.summary,
    ...cv.aiPractice,
    ...cv.experience.flatMap((x) => x.bullets.map((b) => b.text)),
    ...cv.projects.flatMap((p) => [p.title, p.text]),
    ...cv.skills.flatMap((l) => l.items),
  ].join('\n');
}

/** Matched job skills that `text` (the CV's content) never mentions. */
export function uncovered(cv: TailoredCv, text: string): string[] {
  const present = detectSkills(text, false);
  return cv.report.matched.filter((s) => !present.has(s));
}

/** How a skill is worded in your profile: the shortest skills-section item naming it, else the phrase a bullet uses. */
function profileWording(p: Profile, skill: string): string {
  const items = p.skills.flatMap((l) => l.items).filter((i) => detectSkills(i, false).has(skill));
  if (items.length) return items.reduce((a, b) => (b.length < a.length ? b : a));
  return skillMention(JSON.stringify(p), skill) ?? skill;
}

/** Returns a copy of the CV with these skills added to an "Additional" skills line. */
export function addToSkills(cv: TailoredCv, skills: string[]): TailoredCv {
  if (!skills.length) return cv;
  const p = loadProfile();
  const words = [...new Set(skills.map((s) => profileWording(p, s)))];
  const lines = cv.skills.map((l) => ({ ...l, items: [...l.items] }));
  const extra = lines.find((l) => l.label === EXTRA_SKILLS_LABEL);
  if (extra) extra.items.push(...words.filter((w) => !extra.items.includes(w)));
  else lines.push({ label: EXTRA_SKILLS_LABEL, items: words });
  return { ...cv, skills: lines };
}

export interface KeywordCoverage { total: number; covered: string[]; notInProfile: string[]; notOnCv: string[] }

/** "covers 7 of 8 job keywords (88%). Missing: Microservices (not in your profile)." */
export function formatCoverage(c: KeywordCoverage): string {
  const pct = c.total ? Math.round((c.covered.length / c.total) * 100) : 100;
  const gaps = [...c.notInProfile.map((s) => `${s} (not in your profile)`), ...c.notOnCv.map((s) => `${s} (in your profile, not on this CV)`)];
  return `covers ${c.covered.length} of ${c.total} job keywords (${pct}%).${gaps.length ? ` Missing: ${gaps.join(', ')}.` : ''}`;
}

/** ATS-style keyword check of the final CV text against the job's skills. */
export function keywordCoverage(cv: TailoredCv, text: string): KeywordCoverage {
  const present = detectSkills(text, false);
  const { jobSkills, missing } = cv.report;
  return {
    total: jobSkills.length,
    covered: jobSkills.filter((s) => present.has(s)),
    notInProfile: missing.filter((s) => !present.has(s)),
    notOnCv: jobSkills.filter((s) => !present.has(s) && !missing.includes(s)),
  };
}
