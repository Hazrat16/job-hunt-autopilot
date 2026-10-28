// Local dashboard: job list, details, CV preview/download and the application pipeline.
// Listens on 127.0.0.1 only, so it is never reachable from the network.
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { config, env, VARIANTS, type Variant } from './config.ts';
import { cvFileName, cvFolder, FONT_DIR, fitLimitPx, renderCvQueued } from './cv/render.ts';
import { formatCoverage, tailor } from './cv/tailor.ts';
import { renderHtml } from './cv/template.ts';
import {
  getJob, getKv, jobEvents, listJobs, setNotes, setStatus, sourceCounts, stats, type JobRow, type Status,
} from './db.ts';
import type { Eligibility } from './eligibility.ts';
import { addManualJob, fetchAllShared } from './pipeline.ts';
import { detectEmailApply, draftEmail } from './apply-email.ts';

const STATUSES: Status[] = ['new', 'saved', 'applied', 'interview', 'offer', 'rejected', 'skipped'];
const ELIGIBILITY: Eligibility[] = ['worldwide', 'asia', 'unknown', 'restricted'];

const list = (v: unknown) => (typeof v === 'string' && v ? v.split(',') : undefined);

/** List rows without the (long) description; flags jobs that want an email application. */
function summary(j: JobRow) {
  const { description, dedupe_key, location_hints, ...rest } = j;
  return { ...rest, apply_email: detectEmailApply(description, j.apply_url)?.to ?? null };
}

function jobOr404(req: Request, res: Response): JobRow | undefined {
  const j = getJob(Number(req.params.id));
  if (!j) res.status(404).json({ error: 'Job not found' });
  return j;
}

function variantParam(req: Request): Variant | undefined {
  const v = req.query.variant;
  return typeof v === 'string' && VARIANTS.includes(v as Variant) ? (v as Variant) : undefined;
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/fonts', express.static(FONT_DIR, { maxAge: '7d' }));
  app.use(express.static(path.join(import.meta.dirname, 'web')));

  app.get('/api/meta', (_req, res) => {
    res.json({
      statuses: STATUSES,
      eligibility: ELIGIBILITY,
      variants: VARIANTS,
      sources: sourceCounts(),
      stats: stats(),
      lastFetch: getKv('last_fetch') ?? null,
      minScore: config.digest.min_score,
    });
  });

  app.get('/api/jobs', (req, res) => {
    const q = req.query;
    // "Apply by email" is read from the description, so that filter runs here, after the query.
    const emailOnly = q.apply === 'email';
    const limit = Math.min(Number(q.limit) || 200, 1000);
    const rows = listJobs({
      q: typeof q.q === 'string' && q.q.trim() ? q.q.trim() : undefined,
      minScore: q.min ? Number(q.min) : undefined,
      eligibility: list(q.eligibility) as Eligibility[] | undefined,
      status: list(q.status) as Status[] | undefined,
      source: typeof q.source === 'string' && q.source ? q.source : undefined,
      sinceDays: q.days ? Number(q.days) : undefined,
      freshDays: q.fresh ? config.open_max_age_days : undefined,
      limit: emailOnly ? 5000 : limit,
    });
    const jobs = rows.map(summary);
    res.json(emailOnly ? jobs.filter((j) => j.apply_email).slice(0, limit) : jobs);
  });

  app.get('/api/jobs/:id', (req, res) => {
    const j = jobOr404(req, res);
    if (j) res.json({ ...j, events: jobEvents(j.id), emailDraft: draftEmail(j) ?? null });
  });

  app.patch('/api/jobs/:id', (req, res) => {
    const j = jobOr404(req, res);
    if (!j) return;
    const { status, notes } = req.body ?? {};
    if (status !== undefined) {
      if (!STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
      if (status !== j.status) setStatus(j.id, status);
    }
    if (typeof notes === 'string') setNotes(j.id, notes);
    const updated = getJob(j.id)!;
    res.json({ ...updated, events: jobEvents(j.id), emailDraft: draftEmail(updated) ?? null });
  });

  app.post('/api/jobs', async (req, res, next) => {
    try {
      const { text, url, title, company } = req.body ?? {};
      if (!text && !url) return res.status(400).json({ error: 'Paste a job description or a link.' });
      const j = await addManualJob({ text, url, title: title || undefined, company: company || undefined });
      res.status(201).json(summary(j));
    } catch (err) {
      next(err);
    }
  });

  // Application email for any job: the post's address when it gives one, else yours to fill in.
  app.get('/api/jobs/:id/email', (req, res) => {
    const j = jobOr404(req, res);
    if (j) res.json(draftEmail(j, { always: true, variant: variantParam(req) }));
  });

  // Instant preview: the page fits itself to one page in your browser (no Chrome needed).
  app.get('/api/jobs/:id/cv/preview', (req, res) => {
    const j = jobOr404(req, res);
    if (!j) return;
    const cv = tailor(j, variantParam(req));
    res.type('html').send(renderHtml(cv, { paper: config.cv.paper, fontBase: '/fonts', fitLimitPx: fitLimitPx() }));
  });

  // The real PDF, rendered by Chrome with the print-accurate fit.
  app.get('/api/jobs/:id/cv.pdf', async (req, res, next) => {
    try {
      const j = jobOr404(req, res);
      if (!j) return;
      const cv = tailor(j, variantParam(req));
      const r = await renderCvQueued(cv, cvFolder(j));
      res.setHeader('X-ATS', encodeURIComponent(formatCoverage(r.coverage)));
      res.setHeader('X-Dropped', String(r.dropped.length));
      res.download(r.pdf, `${cvFileName(cv, cv.basics.name)}.pdf`);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/fetch', async (_req, res, next) => {
    try {
      const reports = await fetchAllShared();
      res.json({
        added: reports.reduce((n, r) => n + r.counts.new, 0),
        fetched: reports.reduce((n, r) => n + r.fetched, 0),
        failed: reports.filter((r) => r.error).map((r) => ({ source: r.source, error: r.error })),
      });
    } catch (err) {
      next(err);
    }
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[server]', err);
    res.status(500).json({ error: err.message });
  });
  return app;
}

export function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createApp().listen(env.port, '127.0.0.1', () => {
      console.log(`[dashboard] http://localhost:${env.port}`);
      resolve();
    });
    server.on('error', reject);
  });
}
