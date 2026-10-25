// "Send your CV to jobs@acme.com": spots job posts that want applications by email, and drafts
// that email from your profile. Like the CV, the draft only uses facts from data/profile.yaml.
import { config, type Variant } from './config.ts';
import { tailor, type JobInput } from './cv/tailor.ts';
import { loadProfile } from './profile.ts';
import { detectSkills } from './skills.ts';

export interface EmailApply {
  to: string;
  /** The sentence that asks for an email application, quoted in the UI. */
  evidence: string;
  /** Subject the post asks for, if it names one. */
  subjectHint?: string;
  reference?: string;
  /** Person to greet, when the post names one. */
  contactName?: string;
  /** What the post asks you to include, e.g. "your GitHub, a project you built". */
  asksFor?: string;
}

export interface EmailDraft extends EmailApply {
  subject: string;
  body: string;
  /** False when the post doesn't ask for email and the address is yours to fill in. */
  detected: boolean;
}

export interface DraftOptions {
  /** Draft even when the post doesn't ask for an email application (e.g. a recruiter you found yourself). */
  always?: boolean;
  /** CV variant whose headline and bullets the email uses (default: the job's suggested one). */
  variant?: Variant;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

// Addresses that are about something other than applying.
const NOT_APPLY = /accommodat|disabilit|fraud|scam|phishing|privacy|data protection|gdpr|report|disregard|affirmative action|questions?\b|assistance|newsletter|subscribe|accessib|security|alternative selection|legal|press|media inquir/i;
const NOT_APPLY_LOCAL = /^(no-?reply|support|privacy|security|legal|press|accommodations?|accessibility|abuse|billing|sales|info)$/i;
// Wording that means "apply by emailing this address".
const APPLY_CONTEXT =
  /\b(apply|applications?|send (us |me )?(your|a|an)\b|cv|resume|résumé|cover letter|portfolio|e-?mail (us|me)\b|e-?mail\s+\S+@|write to|reach out|shoot (us |me )?an? e-?mail|drop (us |me )?(a line|an e-?mail)|interested\b|get in touch)/i;

const GENERIC_LOCAL = /^(jobs?|careers?|hiring|hire|recruit(ing|ment|er)?|talent|people|hr|team|hello|hi|contact|apply|work|founders?|admin|office|cv|resumes?|join(us)?)$/i;

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z])|\n+/).map((s) => s.trim()).filter(Boolean);
}

function title(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Finds an "apply by email" instruction in a job post. */
export function detectEmailApply(description: string, applyUrl?: string | null): EmailApply | undefined {
  if (applyUrl?.startsWith('mailto:')) {
    const to = decodeURIComponent(applyUrl.slice(7).split('?')[0]);
    return { to, evidence: 'The job board lists an email address as the way to apply.' };
  }
  const text = description ?? '';
  const all = sentences(text);
  for (const [i, s] of all.entries()) {
    // "Interested? Contact Jason, j@x.com." and "To do so, contact hr@x.com." lean on the sentence before.
    const prev = all[i - 1] ?? '';
    const refersBack = /^(to do so|for (this|that|these)|to request|if so)\b/i.test(s);
    for (const m of s.matchAll(EMAIL_RE)) {
      const to = m[0].replace(/\.$/, '');
      if (NOT_APPLY.test(s) || (refersBack && NOT_APPLY.test(prev)) || NOT_APPLY_LOCAL.test(to.split('@')[0])) continue;
      if (!APPLY_CONTEXT.test(`${prev.length < 40 ? prev : ''} ${s}`)) continue;

      const subjectHint =
        s.match(/subject(?: line)?(?: of| as)?[:\s]+["“'‘]([^"”'’]{3,100})["”'’]/i)?.[1] ??
        s.match(/["“]([^"”]{3,100})["”]\s+in the subject/i)?.[1];
      const reference = text.match(/\b(?:job|ref(?:erence)?|requisition|position)\s*(?:id|code|no\.?|number|#)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,20})\b/i)?.[1];
      const asksFor = s.match(/\bwith (your [^.;]{3,120}?|a [^.;]{3,120}?)(?=[.;]|$| in the subject| to\b)/i)?.[1]?.trim();

      // Greet a named person: "Contact Jason Forbes, ..." or a personal address like scott.deakin@...
      let contactName = s.match(/\b(?:[Cc]ontact|[Ee]-?mail|[Ww]rite to|[Rr]each out to)\s+([A-Z][a-z]+)(?:\s+[A-Z][a-z]+)?\b(?!@)/)?.[1];
      const local = to.split('@')[0];
      const first = local.split(/[._-]/)[0];
      if (!contactName && !GENERIC_LOCAL.test(local) && /^[a-z]{3,12}$/i.test(first) && !/\d/.test(local)) contactName = title(first);
      if (contactName && GENERIC_LOCAL.test(contactName)) contactName = undefined;

      return { to, evidence: s.length > 320 ? `${s.slice(0, 317)}…` : s, subjectHint, reference, contactName, asksFor };
    }
  }
  return undefined;
}

const SOURCE_NAME: Record<string, string> = {
  hn: 'the Hacker News "Who is Hiring" thread',
  linkedin: 'LinkedIn',
  weworkremotely: 'We Work Remotely',
  remoteok: 'Remote OK',
  remotive: 'Remotive',
  himalayas: 'Himalayas',
  jobicy: 'Jobicy',
  arbeitnow: 'Arbeitnow',
  greenhouse: 'your careers page',
  ashby: 'your careers page',
  lever: 'your careers page',
};

const BASIC_SKILLS = new Set(['HTML/CSS', 'Git', 'Code review', 'Agile / Scrum', 'Testing', 'OOP / SOLID', 'JavaScript', 'AI coding tools']);

const METRIC = /\d+(\.\d+)?\s?[%x]|\d+K\+|\d+\+|\$\d|zero\b/i;

function listJoin(items: string[]): string {
  return items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** Keeps a bullet scannable: drops a trailing clause when it runs long, never the start. */
function trimBullet(text: string, max = 170): string {
  let t = text.replace(/\.$/, '');
  if (t.length > max) {
    const cut = t.slice(0, max).search(/(;|, including|, coordinating| with [^,]*$)[^;]*$/);
    if (cut > 60) t = t.slice(0, cut);
  }
  return t;
}

/**
 * Drafts the application email for a job (by default only when the post asks for one).
 * Recruiter-friendly shape: role and source, a one-line fit, 3 quantified wins, what the post
 * asked for, remote logistics, a clear next step and a signature with links. Profile facts only.
 */
export function draftEmail(job: JobInput & { apply_url?: string | null; source?: string; seen_on?: string[] }, opts: DraftOptions = {}): EmailDraft | undefined {
  const detected = detectEmailApply(job.description, job.apply_url);
  const found: EmailApply | undefined = detected ?? (opts.always ? { to: '', evidence: '' } : undefined);
  if (!found) return undefined;
  const p = loadProfile();
  const cv = tailor(job, opts.variant);
  const b = p.basics;
  const years = `${Math.floor(config.experience_years)}+ years`;
  const company = job.company && !/^unknown/i.test(job.company) ? job.company : '';
  const pretty = (skill: string) => skill.replace(/ \/ /g, '/');
  // Lead with skills that sell; basics like HTML/CSS or Git add nothing in an opening line.
  const stack = cv.coreStack.filter((sk) => !BASIC_SKILLS.has(sk)).slice(0, 4).map(pretty);

  // Three wins: the ones naming the most skills this job asks for, numbers preferred, at most two per employer.
  const wanted = new Set(cv.report.matched);
  const ranked = cv.experience
    .flatMap((x) => x.bullets.map((bl) => ({ ...bl, company: x.company.split(' — ')[0] })))
    .map((bl) => {
      const hits = [...detectSkills(bl.text, false)].filter((sk) => wanted.has(sk)).length;
      return { ...bl, rank: hits * 5 + (METRIC.test(bl.text) ? 5 : 0) + bl.score };
    })
    .sort((a, b) => b.rank - a.rank);
  const wins: typeof ranked = [];
  for (const bl of ranked) {
    if (wins.length === 3) break;
    if (wins.filter((w) => w.company === bl.company).length < 2) wins.push(bl);
  }

  const link = (re: RegExp) => b.links.find((l) => re.test(l.url))?.url;
  const linkedin = link(/linkedin/i);
  const github = link(/github/i);
  const project = cv.projects.find((pr) => pr.url);
  const asked = `${found.asksFor ?? ''} ${found.evidence}`;
  const wantsCode = /github|project|code|portfolio|repo|pr\b|built/i.test(asked);
  const wantsLinkedin = /linkedin/i.test(asked);
  const source = SOURCE_NAME[job.source ?? job.seen_on?.[0] ?? ''];
  const remoteTeams = p.experience
    .filter((x) => /remote/i.test(x.location) && /,/.test(x.location))
    .map((x) => `${x.company.split(' — ')[0]}, ${x.location.split(',')[0]}`);

  const greeting = found.contactName ? `Hi ${found.contactName},` : company ? `Dear ${company} Hiring Team,` : 'Dear Hiring Manager,';
  const intro =
    `I'm writing to apply for the ${job.title} role${company ? ` at ${company}` : ''}${source ? `, which I came across on ${source}` : ''}. ` +
    `I'm a ${cv.headline} with ${years} of production experience${stack.length >= 2 ? ` in ${listJoin(stack)}, which lines up closely with this role` : ''}.`;
  const winsBlock = wins.length ? `A few highlights:\n${wins.map((w) => `• ${w.company}: ${trimBullet(w.text)}`).join('\n')}` : '';

  const extras: string[] = [];
  if (project) extras.push(`Relevant project: ${project.title.replace(/:.*$/, '')} – ${project.url}`);
  if (wantsCode && github) extras.push(`GitHub: ${github}`);
  if (wantsLinkedin && linkedin) extras.push(`LinkedIn: ${linkedin}`);
  const extrasBlock = extras.length ? `${found.asksFor ? 'As requested:' : 'You can see more of my work here:'}\n${extras.join('\n')}` : '';

  const logistics = [
    `I'm based in ${b.location.split(',').at(-1)!.trim()}${b.timezone ? ` (${b.timezone})` : ''}` +
      (remoteTeams.length ? ` and have worked remotely with international teams (${remoteTeams.join('; ')}).` : '.'),
    b.availability ?? '',
  ].filter(Boolean).join(' ');

  const closing = `My CV is attached. Would you be open to a short call to discuss the role? I'm happy to work around your schedule.`;
  const signature = [
    'Best regards,',
    b.name,
    cv.headline,
    `${b.phone} · ${b.email}`,
    ...(linkedin ? [`LinkedIn: ${linkedin}`] : []),
    ...(github ? [`GitHub: ${github}`] : []),
  ].join('\n');

  const body = [greeting, intro, winsBlock, extrasBlock, logistics, closing, signature].filter(Boolean).join('\n\n');

  // Posts sometimes give a template, e.g. "Forward Deployed: your name, your city".
  const subject =
    found.subjectHint?.replace(/\byour (full )?name\b/i, b.name).replace(/\byour (city|location)\b/i, b.location.split(',')[0]) ??
    `Application: ${job.title}${found.reference ? ` (Ref ${found.reference})` : ''} – ${b.name}` +
      (stack.length >= 2 ? ` | ${years.replace(' years', ' yrs')} ${stack.slice(0, 2).join('/')}` : '');
  return { ...found, subject, body, detected: Boolean(detected) };
}
