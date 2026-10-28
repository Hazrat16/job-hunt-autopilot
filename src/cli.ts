import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { VARIANTS, type Variant } from './config.ts';
import { formatCoverage, tailor } from './cv/tailor.ts';
import { cvFolder, renderCv } from './cv/render.ts';
import type { Paper } from './cv/template.ts';
import { jobFromInput } from './sources/manual.ts';
import type { Eligibility } from './eligibility.ts';

const STATUSES = ['new', 'saved', 'applied', 'interview', 'offer', 'rejected', 'skipped'] as const;
const ELIG_ICON: Record<Eligibility, string> = { worldwide: '🌍', asia: '🌏', unknown: '❓', restricted: '🚫' };

const USAGE = `Usage:
  npm run fetch [-- --source remoteok,himalayas]        collect, dedupe and score new jobs
  npm run jobs [-- --min 50 --all --days 7 --source linkedin]  best matches (restricted hidden unless --all)
  npm run job -- <id>                                   one job in detail
  npm run status -- <id> ${STATUSES.join('|')} ["note"]
  npm run rescore                                       re-score stored jobs after editing config/profile
  npm run cv -- <id>
  npm run cv -- --file jd.txt [--title "DevOps Engineer"] [--company Acme]
  npm run cv -- --url https://www.linkedin.com/jobs/view/123456/
  cv options: --variant ${VARIANTS.join('|')}   --paper A4|Letter|Legal`;

async function cmdCv(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      file: { type: 'string' },
      url: { type: 'string' },
      text: { type: 'string' },
      title: { type: 'string' },
      company: { type: 'string' },
      variant: { type: 'string' },
      paper: { type: 'string' },
    },
  });
  const id = positionals[0] && Number(positionals[0]);
  if (!id && !values.file && !values.url && !values.text) throw new Error(USAGE);
  if (values.variant && !VARIANTS.includes(values.variant as Variant)) throw new Error(`Unknown variant. ${USAGE}`);

  let job: { title: string; company: string; description: string };
  if (id) {
    const { getJob } = await import('./db.ts');
    const row = getJob(id);
    if (!row) throw new Error(`No job with id ${id}. Run: npm run jobs`);
    job = row;
  } else {
    const text = values.file ? fs.readFileSync(values.file, 'utf8') : values.text;
    job = await jobFromInput({ text, url: values.url, title: values.title, company: values.company });
  }
  const cv = tailor(job, values.variant as Variant | undefined);
  const res = await renderCv(cv, cvFolder({ ...job, id: id || undefined }), values.paper as Paper | undefined);

  const r = cv.report;
  console.log(`\nJob:       ${job.title} @ ${job.company}`);
  console.log(`Variant:   ${cv.variant}   Headline: ${cv.headline}`);
  console.log(`Skills:    matched ${r.matched.length}/${r.jobSkills.length}: ${r.matched.join(', ') || '-'}`);
  console.log(`ATS:       ${formatCoverage(res.coverage)}`);
  console.log(`Fit:       ${res.pages ?? '?'} page(s), font ${res.fontSize}${res.dropped.length ? `, dropped ${res.dropped.length}:` : ''}`);
  for (const d of res.dropped) console.log(`             - ${d}…`);
  console.log(`PDF:       ${res.pdf}\n`);
}

async function cmdFetch(argv: string[]) {
  const { values } = parseArgs({ args: argv, options: { source: { type: 'string' } } });
  const { fetchJobs } = await import('./pipeline.ts');
  const t0 = Date.now();
  const reports = await fetchJobs(values.source?.split(',').map((s) => s.trim()));
  console.log(`\n${'source'.padEnd(16)}${'fetched'.padStart(8)}${'new'.padStart(6)}${'dup'.padStart(6)}${'upd'.padStart(6)}${'seen'.padStart(6)}${'low'.padStart(6)}${'old'.padStart(6)}   time`);
  for (const r of reports) {
    const c = r.counts;
    console.log(
      `${r.source.padEnd(16)}${String(r.fetched).padStart(8)}${String(c.new).padStart(6)}${String(c.duplicate).padStart(6)}${String(c.updated).padStart(6)}${String(c.seen).padStart(6)}${String(c.low).padStart(6)}${String(r.tooOld).padStart(6)}   ${(r.ms / 1000).toFixed(1)}s${r.error ? `   ERROR: ${r.error}` : ''}`,
    );
  }
  const added = reports.reduce((n, r) => n + r.counts.new, 0);
  console.log(`\n${added} new job(s) in ${((Date.now() - t0) / 1000).toFixed(0)}s.${added ? ' Best new matches:' : ''}`);
  if (added) await cmdJobs(['--limit', '10', '--since', new Date(t0).toISOString()]);
}

function printJobs(rows: import('./db.ts').JobRow[]) {
  if (!rows.length) return console.log('  (none)');
  for (const j of rows) {
    const status = j.status === 'new' ? '' : ` [${j.status}]`;
    console.log(`${String(j.id).padStart(5)}  ${String(j.score).padStart(3)}  ${ELIG_ICON[j.eligibility]}  ${j.variant.padEnd(9)} ${j.title.slice(0, 55)} @ ${j.company.slice(0, 30)}${j.salary ? `  (${j.salary})` : ''}${status}`);
  }
}

async function cmdJobs(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: { min: { type: 'string' }, all: { type: 'boolean' }, days: { type: 'string' }, limit: { type: 'string' }, status: { type: 'string' }, since: { type: 'string' }, source: { type: 'string' } },
  });
  const { listJobs } = await import('./db.ts');
  const rows = listJobs({
    minScore: values.min ? Number(values.min) : undefined,
    eligibility: values.all ? undefined : ['worldwide', 'asia', 'unknown'],
    status: values.status ? (values.status.split(',') as (typeof STATUSES)[number][]) : values.all ? undefined : ['new', 'saved'],
    sinceDays: values.days ? Number(values.days) : undefined,
    firstSeenAfter: values.since,
    source: values.source,
    limit: values.limit ? Number(values.limit) : 30,
  });
  console.log(`   id  scr  loc  variant   title @ company`);
  printJobs(rows);
}

async function cmdJob(argv: string[]) {
  const { getJob } = await import('./db.ts');
  const j = getJob(Number(argv[0]));
  if (!j) throw new Error(`No job with id ${argv[0]}`);
  console.log(`\n${j.title} @ ${j.company}   (#${j.id}, ${j.status})`);
  console.log(`Score:       ${j.score}   variant ${j.variant}   ${j.seniority}`);
  console.log(`Location:    ${ELIG_ICON[j.eligibility]} ${j.eligibility} (${j.eligibility_reason})${j.location ? `   listed: ${j.location}` : ''}`);
  console.log(`Matched:     ${j.matched.join(', ') || '-'}`);
  console.log(`Missing:     ${j.missing.join(', ') || 'none'}`);
  if (j.salary) console.log(`Salary:      ${j.salary}`);
  console.log(`Posted:      ${j.posted_at?.slice(0, 10) ?? '?'}   seen on ${j.seen_on.join(', ')}`);
  console.log(`Link:        ${j.apply_url ?? j.url}`);
  if (j.notes) console.log(`Notes:       ${j.notes}`);
  const { draftEmail } = await import('./apply-email.ts');
  const mail = draftEmail(j);
  if (mail) console.log(`Email:       apply by email to ${mail.to}, subject "${mail.subject}" (draft in the dashboard or the bot's ✉️ button)`);
  console.log(`\n${j.description.slice(0, 1500)}${j.description.length > 1500 ? '…' : ''}\n`);
  console.log(`CV:          npm run cv -- ${j.id}\n`);
}

async function cmdStatus(argv: string[]) {
  const [id, status, note] = argv;
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) throw new Error(USAGE);
  const { getJob, setStatus } = await import('./db.ts');
  if (!getJob(Number(id))) throw new Error(`No job with id ${id}`);
  setStatus(Number(id), status as (typeof STATUSES)[number], note);
  console.log(`#${id} → ${status}`);
}

async function cmdRescore() {
  const { rescoreAll } = await import('./db.ts');
  const { scoreJob } = await import('./match.ts');
  console.log(`Re-scored ${rescoreAll(scoreJob)} job(s).`);
}

const [cmd, ...rest] = process.argv.slice(2);
const commands: Record<string, (a: string[]) => Promise<void>> = { cv: cmdCv, fetch: cmdFetch, jobs: cmdJobs, job: cmdJob, status: cmdStatus, rescore: cmdRescore };
if (!cmd || !commands[cmd]) {
  console.log(USAGE);
  process.exit(cmd ? 1 : 0);
}
commands[cmd](rest).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
