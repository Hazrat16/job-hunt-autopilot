// Can you (remote, based in Bangladesh) actually be hired for this job?
// Restricted jobs are stored but never sent, so the restriction patterns are kept strict.
import { config } from './config.ts';
import type { RawJob } from './sources/types.ts';
import { phraseRegex } from './util.ts';

export type Eligibility = 'worldwide' | 'asia' | 'unknown' | 'restricted';

const eligibleRe = phraseRegex(config.eligible_locations);
const asiaRe = /\b(asia|apac|asia[- ]pacific|south asia|bangladesh|gmt\s?\+\s?[5-8]|utc\s?\+\s?[5-8]|ist|bst\s?\+6)\b/i;

// Places/regions that, named in a location field without "worldwide" etc., limit who can apply.
const REGION =
  /\b(us|usa|u\.s\.a?\.?|united states|america|americas|north america|latam|latin america|south america|canada|mexico|brazil|argentina|colombia|uk|u\.k\.|united kingdom|england|ireland|europe|european|eu|eea|emea|dach|germany|france|spain|portugal|italy|netherlands|poland|romania|sweden|norway|denmark|finland|switzerland|austria|belgium|czech|ukraine|israel|uae|dubai|saudi|qatar|africa|nigeria|kenya|south africa|egypt|australia|new zealand|anz|japan|singapore|philippines|vietnam|indonesia|malaysia|pakistan|india|cet|cest|est|pst|edt|pdt|[a-z]+,\s*[A-Z]{2})\b/i;

// Cities: restricting only when the field doesn't also just say "remote" ("NYC or Remote" is unclear).
const CITY =
  /\b(london|paris|berlin|munich|hamburg|amsterdam|copenhagen|stockholm|oslo|helsinki|zurich|dublin|lisbon|madrid|barcelona|warsaw|prague|vienna|tokyo|seoul|sydney|melbourne|toronto|vancouver|montreal|new york|nyc|san francisco|sf|bay area|seattle|boston|austin|chicago|denver|los angeles|miami|atlanta|tel aviv)\b/i;

// Words in a location field that say nothing about where you must live.
const FILLER = /\b(remote|remotely|fully|full[- ]?time|part[- ]?time|contract|contractor|freelance|hybrid|flexible|home[- ]?based|work from home|wfh|100%|anywhere|only|first|friendly|or|and|in|from|the|of|any|location|locations|based|distributed|team|position|job)\b|[\s,;:/|()\-–•.+&]+/gi;

// Phrases in a description that clearly restrict the hiring location.
const DESC_RESTRICTED = [
  /\b(US|USA|U\.S\.|United States|Canada|UK|EU|Europe|EMEA|LATAM|North America)[- ](only|based (candidates|applicants) only)\b/,
  /\bonly (open to|accepting|hiring|considering) (candidates|applicants|residents|people)? ?(based |located |residing )?(in|from) (the )?(US|USA|U\.S\.|United States|Canada|UK|United Kingdom|EU|Europe|EMEA|LATAM|North America|Americas)\b/i,
  /\bmust (be )?(currently )?(be )?(based|located|reside|residing|live|living) in (the )?(US|USA|U\.S\.|United States|Canada|UK|United Kingdom|EU|European Union|Europe|EMEA|EEA|LATAM|Latin America|North America|Americas|Germany|Spain|Poland|Portugal|Brazil|Mexico|Australia)\b/i,
  /\b(legally )?(authorized|authorised|eligible|permitted) to work in (the )?(US|USA|U\.S\.|United States|Canada|UK|United Kingdom|EU|European Union|Europe)\b/i,
  /\b(US|U\.S\.) (work authorization|citizens?(hip)?|persons?|residents?)\b/,
  /\b(green card|security clearance|active clearance|ts\/sci)\b/i,
  /\b(we (are|'re) )?(not|unable to) (able to )?(sponsor|hire|consider) .{0,40}outside (of )?(the )?(US|USA|United States|Canada|UK|EU|Europe)\b/i,
];

const DESC_WORLDWIDE =
  /\b(work from anywhere|from anywhere in the world|anywhere in the world|remote[- ]worldwide|worldwide remote|fully remote,? (global|worldwide)|hire (globally|worldwide|from anywhere)|(open|available) to (candidates|applicants) (worldwide|globally|anywhere)|location:?\s*(worldwide|anywhere|global))\b/i;

function classifyLocation(loc: string): { e: Eligibility; why: string } | undefined {
  const s = loc.trim();
  if (!s) return undefined;
  if (asiaRe.test(s)) return { e: 'asia', why: s };
  if (eligibleRe.test(s)) return { e: 'worldwide', why: s };
  const remote = /remote/i.test(s);
  if (REGION.test(s) || (!remote && (CITY.test(s) || /\b(on-?site|in[- ]person|in[- ]office)\b/i.test(s)))) return { e: 'restricted', why: s };
  return undefined;
}

export function eligibility(job: Pick<RawJob, 'location' | 'locationHints' | 'description'>): { eligibility: Eligibility; reason: string } {
  const desc = job.description ?? '';
  for (const re of DESC_RESTRICTED) {
    const m = desc.match(re);
    if (m) return { eligibility: 'restricted', reason: `"${m[0]}"` };
  }

  // Structured hints from the source: a listed place you're not in means restricted.
  const hints = (job.locationHints ?? []).filter(Boolean);
  const fromHints = hints.map(classifyLocation).filter((x) => x !== undefined);
  const best = (list: { e: Eligibility; why: string }[]) =>
    list.find((x) => x.e === 'asia') ?? list.find((x) => x.e === 'worldwide') ?? list.find((x) => x.e === 'restricted');
  const h = best(fromHints);
  if (h) return { eligibility: h.e, reason: `location: ${h.why}` };
  const unnamed = hints.find((x) => x.replace(FILLER, '').length > 1);
  if (unnamed) return { eligibility: 'restricted', reason: `location: ${unnamed}` };

  const l = job.location && classifyLocation(job.location);
  if (l) return { eligibility: l.e, reason: `location: ${l.why}` };

  const w = desc.match(DESC_WORLDWIDE);
  if (w) return { eligibility: 'worldwide', reason: `"${w[0]}"` };
  const a = desc.match(/\b(APAC|Asia[- ]Pacific|anywhere in Asia|South Asia)\b/);
  if (a) return { eligibility: 'asia', reason: `"${a[0]}"` };
  return { eligibility: 'unknown', reason: 'no location requirement found' };
}
