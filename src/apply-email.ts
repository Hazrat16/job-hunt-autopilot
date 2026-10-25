// "Send your CV to jobs@acme.com": spots job posts that want applications by email, and drafts
// that email from your profile. Like the CV, the draft only uses facts from data/profile.yaml.
import { config, type Variant } from './config.ts';
import { tailor, type JobInput } from './cv/tailor.ts';
import { loadProfile } from './profile.ts';

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

// Bullets that read naturally after "At <company>, I …".
const VERB = /^(Built|Led|Set|Kept|Own|Owned|Reduced|Developed|Architected|Added|Integrated|Implemented|Containerized|Monitored|Optimized|Designed|Deployed|Automated|Created|Migrated|Improved|Shipped|Wrote|Ran|Delivered|Maintained|Configured|Provisioned)\b/;

function listJoin(items: string[]): string {
  return items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** Drafts the application email for a job (by default only when the post asks for one). */
export function draftEmail(job: JobInput & { apply_url?: string | null }, opts: DraftOptions = {}): EmailDraft | undefined {
  const detected = detectEmailApply(job.description, job.apply_url);
  const found: EmailApply | undefined = detected ?? (opts.always ? { to: '', evidence: '' } : undefined);
  if (!found) return undefined;
  const p = loadProfile();
  const cv = tailor(job, opts.variant);
  const b = p.basics;
  const years = `${Math.floor(config.experience_years)}+ years`;
  const company = job.company && !/^unknown/i.test(job.company) ? job.company : 'your team';

  // Your two strongest bullets for this job, from different employers when possible.
  const ranked = cv.experience
    .flatMap((x) => x.bullets.map((bl) => ({ ...bl, company: x.company.split(' — ')[0] })))
    .filter((bl) => VERB.test(bl.text))
    .sort((a, b) => b.score - a.score);
  const picks = ranked.slice(0, 1);
  const other = ranked.find((bl) => bl.company !== picks[0]?.company && bl.score >= (picks[0]?.score ?? 0) - 10) ?? ranked[1];
  if (other) picks.push(other);
  const sentence = (t: string) => `${t.charAt(0).toLowerCase()}${t.slice(1).replace(/\.?$/, '.')}`;
  const highlights = picks.map((bl, i) =>
    i > 0 && bl.company === picks[0].company ? `I also ${sentence(bl.text)}` : `At ${bl.company}, I ${sentence(bl.text)}`,
  );
  const project = cv.projects.find((pr) => pr.url);
  const github = b.links.find((l) => /github/i.test(l.url));
  const wantsGithub = /github|project|code|portfolio|repo/i.test(found.asksFor ?? found.evidence);

  const paragraphs = [
    `${found.contactName ? `Hi ${found.contactName}` : 'Dear Hiring Team'},`,
    `I'm applying for the ${job.title} role at ${company}. I'm a ${cv.headline} with ${years} of production experience` +
      (cv.coreStack.length >= 2 ? `, and my background covers much of your stack: ${listJoin(cv.coreStack.slice(0, 5))}.` : '.'),
    highlights.join(' '),
    project ? `Some related work: ${project.title.replace(/:.*$/, '')} (${project.url}).${wantsGithub && github ? ` More on my GitHub: ${github.url}` : ''}` : wantsGithub && github ? `My GitHub: ${github.url}` : '',
    `I've attached my CV, tailored to this role.${b.availability ? ` ${b.availability}` : ''} I'd be glad to talk about how I can help ${company}.`,
    `Best regards,\n${b.name}\n${[b.phone, b.email].join(' | ')}\n${b.links.map((l) => l.label).join(' | ')}`,
  ].filter(Boolean);

  // Posts sometimes give a template, e.g. "Forward Deployed: your name, your city".
  const subject =
    found.subjectHint?.replace(/\byour (full )?name\b/i, b.name).replace(/\byour (city|location)\b/i, b.location.split(',')[0]) ??
    `Application: ${job.title}${found.reference ? ` (Ref ${found.reference})` : ''} – ${b.name}`;
  return { ...found, subject, body: paragraphs.join('\n\n'), detected: Boolean(detected) };
}
