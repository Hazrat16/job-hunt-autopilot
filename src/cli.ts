import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { OUTPUT_DIR, VARIANTS, type Variant } from './config.ts';
import { tailor } from './cv/tailor.ts';
import { renderCv } from './cv/render.ts';
import type { Paper } from './cv/template.ts';
import { jobFromInput } from './sources/manual.ts';

const USAGE = `Usage:
  npm run cv -- --file jd.txt [--title "DevOps Engineer"] [--company Acme]
  npm run cv -- --url https://www.linkedin.com/jobs/view/123456/
  options: --variant ${VARIANTS.join('|')}   --paper A4|Letter|Legal`;

async function cmdCv(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
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
  if (!values.file && !values.url && !values.text) throw new Error(USAGE);
  if (values.variant && !VARIANTS.includes(values.variant as Variant)) throw new Error(`Unknown variant. ${USAGE}`);

  const text = values.file ? fs.readFileSync(values.file, 'utf8') : values.text;
  const job = await jobFromInput({ text, url: values.url, title: values.title, company: values.company });
  const cv = tailor(job, values.variant as Variant | undefined);
  const folder = path.join(OUTPUT_DIR, 'cvs', `${job.company}-${job.title}`.replace(/[^\w]+/g, '-').slice(0, 80));
  const res = await renderCv(cv, folder, values.paper as Paper | undefined);

  const r = cv.report;
  console.log(`\nJob:       ${job.title} @ ${job.company}`);
  console.log(`Variant:   ${cv.variant}   Headline: ${cv.headline}`);
  console.log(`Skills:    matched ${r.matched.length}/${r.jobSkills.length}: ${r.matched.join(', ') || '-'}`);
  const c = res.coverage;
  const pct = c.total ? Math.round((c.covered.length / c.total) * 100) : 100;
  const gaps = [...c.notInProfile.map((s) => `${s} (not in your profile)`), ...c.notOnCv.map((s) => `${s} (in your profile, not on this CV)`)];
  console.log(`ATS:       covers ${c.covered.length} of ${c.total} job keywords (${pct}%).${gaps.length ? ` Missing: ${gaps.join(', ')}.` : ''}`);
  console.log(`Fit:       ${res.pages ?? '?'} page(s), font ${res.fontSize}${res.dropped.length ? `, dropped ${res.dropped.length}:` : ''}`);
  for (const d of res.dropped) console.log(`             - ${d}…`);
  console.log(`PDF:       ${res.pdf}\n`);
}

const [cmd, ...rest] = process.argv.slice(2);
const commands: Record<string, (a: string[]) => Promise<void>> = { cv: cmdCv };
if (!cmd || !commands[cmd]) {
  console.log(USAGE);
  process.exit(cmd ? 1 : 0);
}
commands[cmd](rest).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
