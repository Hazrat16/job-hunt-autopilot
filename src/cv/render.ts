// Renders a tailored CV to a one-page PDF using the locally installed Chrome (headless).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { config, env, OUTPUT_DIR } from '../config.ts';
import { PAPER, renderHtml, type Paper } from './template.ts';
import * as cheerio from 'cheerio';
import { addToSkills, keywordCoverage, uncovered, type KeywordCoverage, type TailoredCv } from './tailor.ts';

const run = promisify(execFile);
export const FONT_DIR = path.join(import.meta.dirname, 'fonts');
const CHROME_PROFILE = path.join(OUTPUT_DIR, '.chrome-profile');

async function chrome(args: string[]): Promise<string> {
  // A separate profile dir so this never attaches to (or disturbs) your normal Chrome window.
  const { stdout } = await run(
    env.chromePath,
    ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', `--user-data-dir=${CHROME_PROFILE}`, ...args],
    { maxBuffer: 20 * 1024 * 1024, timeout: 60_000 },
  );
  return stdout;
}

async function pageCount(pdf: string): Promise<number | undefined> {
  try {
    const { stdout } = await run('pdfinfo', [pdf]);
    return Number(stdout.match(/Pages:\s+(\d+)/)?.[1]);
  } catch {
    return undefined; // pdfinfo (poppler-utils) not installed
  }
}

/** Bottom of the last line of text on page 1, in CSS px; undefined without poppler-utils. */
async function printedBottomPx(pdf: string): Promise<number | undefined> {
  try {
    const { stdout } = await run('pdftotext', ['-f', '1', '-l', '1', '-bbox', pdf, '-'], { maxBuffer: 20 * 1024 * 1024 });
    const ys = [...stdout.matchAll(/yMax="([\d.]+)"/g)].map((m) => Number(m[1]));
    return ys.length ? (Math.max(...ys) * 96) / 72 : undefined;
  } catch {
    return undefined;
  }
}

export interface RenderResult { pdf: string; html: string; pages?: number; fontSize: string; dropped: string[]; coverage: KeywordCoverage }

/** Output folder for a job's CV, e.g. output/cvs/86-Vercel-Software-Engineer-Backend. */
export function cvFolder(job: { id?: number; company: string; title: string }): string {
  return path.join(OUTPUT_DIR, 'cvs', `${job.id ? `${job.id}-` : ''}${job.company}-${job.title}`.replace(/[^\w]+/g, '-').slice(0, 80));
}

export function cvFileName(cv: TailoredCv, name: string): string {
  const who = name.replace(/^[A-Z]\.?[A-Z]?\.?\s*/, '').replace(/\W+/g, '_');
  return `CV_${who}_${cv.headline.replace(/[^\w]+/g, '_').replace(/_+$/, '')}`;
}

const BOTTOM_MARGIN_MM = 9;
const mmToPx = (mm: number) => (mm * 96) / 25.4;

/** Where the last line may end (CSS px) for the in-browser fit, e.g. the dashboard preview. */
export function fitLimitPx(paper: Paper = config.cv.paper): number {
  return mmToPx(PAPER[paper].heightMm - BOTTOM_MARGIN_MM);
}

// One Chrome at a time: renders share a profile directory.
let queue: Promise<unknown> = Promise.resolve();

/** renderCv, but waits for any render already running (bot and dashboard share Chrome). */
export function renderCvQueued(...args: Parameters<typeof renderCv>): Promise<RenderResult> {
  const run = queue.then(() => renderCv(...args));
  queue = run.catch(() => {});
  return run;
}

/**
 * Renders the CV, then checks the final text: if fitting dropped the only bullet that named a
 * matched skill, that skill is added to the skills section and the CV is rendered again.
 */
export async function renderCv(cv: TailoredCv, outDir: string, paper: Paper = config.cv.paper): Promise<RenderResult> {
  for (let i = 0; ; i++) {
    const r = await renderOnce(cv, outDir, paper);
    const html = fs.readFileSync(r.html, 'utf8').replace(/<\/(li|p|div|h1|h2)>/g, '\n$&');
    const $ = cheerio.load(html);
    const text = $('.page').text();
    const lost = uncovered(cv, ($('.core').remove(), $('.page').text()));
    if (!lost.length || i === 2) return { ...r, coverage: keywordCoverage(cv, text) };
    cv = addToSkills(cv, lost);
  }
}

/**
 * Chrome lays text out slightly tighter when printing than on screen, so a screen-measured
 * fit leaves empty space. We fit, print, measure where the printed text really ends, then
 * re-fit with the corrected ratio, and finally verify the PDF is a single page.
 * @param outDir folder for the files; the PDF gets a clean, recruiter-friendly name.
 */
async function renderOnce(cv: TailoredCv, outDir: string, paper: Paper): Promise<Omit<RenderResult, 'coverage'>> {
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, cvFileName(cv, cv.basics.name));
  const fontBase = pathToFileURL(FONT_DIR).href;
  const html = `${base}.html`;
  const pdf = `${base}.pdf`;
  const draft = `${base}.draft.html`;
  const target = fitLimitPx(paper);

  const attempt = async (limitPx: number) => {
    fs.writeFileSync(draft, renderHtml(cv, { paper, fontBase, fitLimitPx: limitPx }));
    const dom = await chrome(['--virtual-time-budget=3000', '--dump-dom', pathToFileURL(draft).href]);
    const resultRe = /<script type="application\/json" id="fit-result">([\s\S]*?)<\/script>/;
    const fit = JSON.parse(dom.match(resultRe)?.[1] ?? '{}');
    fs.writeFileSync(html, '<!doctype html>\n' + dom.replace(resultRe, ''));
    await chrome(['--no-pdf-header-footer', `--print-to-pdf=${pdf}`, pathToFileURL(html).href]);
    return { fit, pages: await pageCount(pdf), printed: await printedBottomPx(pdf) };
  };

  let limit = target;
  let r = await attempt(limit);
  for (let i = 0; i < 6; i++) {
    if (!r.printed || !r.fit.bottom) break; // no poppler: trust the screen fit
    if ((r.pages ?? 1) > 1) {
      limit *= 0.95; // overflowed: the page-1 measurement is meaningless, just shrink
    } else {
      const slack = target - r.printed;
      if (slack >= 0 && slack < mmToPx(4)) break; // fits, with at most ~4mm spare
      // Scale the screen limit by how far the printed text ended from where we wanted it.
      limit *= target / r.printed;
    }
    r = await attempt(limit * 0.997);
  }
  if ((r.pages ?? 1) > 1) throw new Error(`Could not fit the CV on one page (${pdf})`);
  fs.rmSync(draft, { force: true });
  return { pdf, html, pages: r.pages, fontSize: r.fit.fontSize ?? '?', dropped: r.fit.dropped ?? [] };
}
