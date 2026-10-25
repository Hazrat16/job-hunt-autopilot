// Telegram bot: daily digest with CV/Applied/Skip buttons, paste-to-CV, commands and follow-up reminders.
// Plain Bot API over fetch with long polling, so no webhook or public URL is needed.
import fs from 'node:fs';
import path from 'node:path';
import { config, env } from './config.ts';
import { cvFolder, renderCvQueued } from './cv/render.ts';
import { formatCoverage, tailor } from './cv/tailor.ts';
import {
  digestJobs, followUps, getJob, getKv, listJobs, markNotified, markReminded, setKv, setStatus, stats, type JobRow, type Status,
} from './db.ts';
import type { Eligibility } from './eligibility.ts';
import { addManualJob, fetchAllShared, type SourceReport } from './pipeline.ts';
import { escapeHtml as e, sleep } from './util.ts';

const ELIG_ICON: Record<Eligibility, string> = { worldwide: '🌍', asia: '🌏', unknown: '❓', restricted: '🚫' };

// ---------- Bot API ----------

async function call<T = any>(method: string, body: Record<string, unknown> | FormData = {}, timeoutMs = 30_000): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.telegram.org/bot${env.telegramToken}/${method}`, {
      method: 'POST',
      ...(body instanceof FormData ? { body } : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = (await res.json()) as { ok: boolean; result: T; description?: string; parameters?: { retry_after?: number } };
    if (data.ok) return data.result;
    // Rate limited (e.g. a long digest): wait as told and retry once.
    if (res.status === 429 && attempt === 0) {
      await sleep(((data.parameters?.retry_after ?? 3) + 1) * 1000);
      continue;
    }
    throw new Error(`Telegram ${method}: ${data.description ?? res.status}`);
  }
}

type Button = { text: string; callback_data?: string; url?: string };

function send(chatId: number, html: string, buttons?: Button[][]) {
  return call('sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

function sendDocument(chatId: number, file: string, captionHtml: string) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('caption', captionHtml.slice(0, 1024));
  form.append('parse_mode', 'HTML');
  form.append('document', new Blob([fs.readFileSync(file)], { type: 'application/pdf' }), path.basename(file));
  return call('sendDocument', form, 60_000);
}

// ---------- Owner ----------

/** The one chat this bot works for: TELEGRAM_CHAT_ID, or whoever sends /start first. */
function ownerChat(): number | undefined {
  const id = env.telegramChatId || getKv('telegram_chat_id');
  return id ? Number(id) : undefined;
}

// ---------- Rendering ----------

function jobCard(j: JobRow): string {
  const link = j.apply_url ?? j.url;
  const lines = [
    `<b>${j.score}</b> ${ELIG_ICON[j.eligibility]} <b>${e(j.title)}</b>`,
    [e(j.company), `${j.variant} CV`, j.salary && e(j.salary)].filter(Boolean).join(' · '),
    `${e(j.seniority)} · ${e(j.eligibility_reason.slice(0, 80))}`,
    j.matched.length ? `✅ ${e(j.matched.slice(0, 10).join(', '))}${j.matched.length > 10 ? '…' : ''}` : '',
    j.missing.length ? `❌ ${e(j.missing.slice(0, 8).join(', '))}` : '',
    `${link ? `<a href="${e(link)}">Open job</a> · ` : ''}#${j.id}${j.status !== 'new' ? ` · <i>${j.status}</i>` : ''}`,
  ];
  return lines.filter(Boolean).join('\n');
}

function jobButtons(j: JobRow): Button[][] {
  const row: Button[] = [{ text: '📄 CV', callback_data: `cv:${j.id}` }];
  if (j.status === 'new' || j.status === 'saved') {
    row.push({ text: '✅ Applied', callback_data: `st:${j.id}:applied` }, { text: '🙈 Skip', callback_data: `st:${j.id}:skipped` });
  }
  return [row];
}

function fetchSummary(reports: SourceReport[]): string {
  const added = reports.reduce((n, r) => n + r.counts.new, 0);
  const failed = reports.filter((r) => r.error);
  return `Fetched ${reports.reduce((n, r) => n + r.fetched, 0)} jobs from ${reports.length} sources: <b>${added} new</b>.` +
    (failed.length ? `\n⚠️ Failed: ${failed.map((r) => `${r.source} (${e(r.error!.slice(0, 60))})`).join(', ')}` : '');
}

// ---------- CV ----------

async function sendCv(chatId: number, j: JobRow) {
  void call('sendChatAction', { chat_id: chatId, action: 'upload_document' }).catch(() => {});
  const cv = tailor(j);
  const res = await renderCvQueued(cv, cvFolder(j));
  await sendDocument(
    chatId,
    res.pdf,
    `<b>${e(cv.headline)}</b> CV for ${e(j.title)} @ ${e(j.company)}\nATS: ${e(formatCoverage(res.coverage))}` +
      (res.dropped.length ? `\nTrimmed ${res.dropped.length} bullet(s) to fit one page.` : ''),
  );
}

// ---------- Digest and reminders ----------

/** Sends the unsent good matches and the follow-up reminders. Returns how many jobs were sent (undefined: no chat yet). */
export async function sendDigest(): Promise<number | undefined> {
  const chatId = ownerChat();
  if (!env.telegramToken || !chatId) return undefined;
  const d = config.digest;
  const elig: Eligibility[] = ['worldwide', 'asia', ...(d.include_unknown_location ? (['unknown'] as const) : [])];
  const jobs = digestJobs(d.min_score, elig, d.max_jobs);
  await send(chatId, jobs.length ? `☀️ <b>${jobs.length} new match${jobs.length > 1 ? 'es' : ''}</b> (score ≥ ${d.min_score})` : `☀️ No new matches today (score ≥ ${d.min_score}).`);
  for (const j of jobs) {
    await send(chatId, jobCard(j), jobButtons(j));
    markNotified([j.id]);
    await sleep(400);
  }
  for (const j of followUps(d.follow_up_after_days)) {
    const days = Math.round((Date.now() - new Date(j.status_at!).getTime()) / 864e5);
    await send(chatId, `⏰ Applied to <b>${e(j.title)}</b> @ ${e(j.company)} ${days} days ago with no update. #${j.id}`, [
      [
        { text: '💬 Interview', callback_data: `st:${j.id}:interview` },
        { text: '❌ Rejected', callback_data: `st:${j.id}:rejected` },
      ],
    ]);
    markReminded(j.id);
  }
  return jobs.length;
}

// ---------- Commands ----------

const HELP = `<b>Job Hunt Autopilot</b>
Paste a job description, a LinkedIn "we're hiring" post or a job link, and I'll score it. Tap 📄 CV on any job for a tailored CV.

/top - best open matches
/job &lt;id&gt; - one job with buttons
/cv &lt;id&gt; - tailored CV for a job
/fetch - check all job sources now
/digest - send the digest now
/stats - counts by status`;

async function onCommand(chatId: number, cmd: string, arg: string) {
  switch (cmd) {
    case '/start':
    case '/help':
      return send(chatId, HELP);
    case '/top': {
      const rows = listJobs({ eligibility: ['worldwide', 'asia', 'unknown'], status: ['new', 'saved'], limit: Number(arg) || 10 });
      if (!rows.length) return send(chatId, 'No open matches yet. Try /fetch.');
      const list = rows.map((j) => `<b>${j.score}</b> ${ELIG_ICON[j.eligibility]} ${e(j.title.slice(0, 60))} @ ${e(j.company.slice(0, 30))}  /job_${j.id}`);
      return send(chatId, list.join('\n'));
    }
    case '/job':
    case '/cv': {
      const j = getJob(Number(arg));
      if (!j) return send(chatId, `No job with id ${e(arg || '?')}. Try /top.`);
      return cmd === '/job' ? send(chatId, jobCard(j), jobButtons(j)) : sendCv(chatId, j);
    }
    case '/fetch': {
      await send(chatId, 'Checking all sources, this takes about a minute…');
      const reports = await fetchAllShared();
      return send(chatId, `${fetchSummary(reports)}\nSend /digest to see the new matches.`);
    }
    case '/digest':
      return sendDigest();
    case '/stats': {
      const s = stats();
      const order: Status[] = ['new', 'saved', 'applied', 'interview', 'offer', 'rejected', 'skipped'];
      return send(
        chatId,
        `<b>${s.total}</b> jobs stored, ${s.week} added this week (${s.good} good matches).\n` +
          order.filter((k) => s.byStatus[k]).map((k) => `${k}: ${s.byStatus[k]}`).join(' · ') +
          `\nLast fetch: ${getKv('last_fetch')?.slice(0, 16).replace('T', ' ') ?? 'never'} UTC`,
      );
    }
    default:
      return send(chatId, `Unknown command. ${HELP}`);
  }
}

/** Paste a job: score it and store it. The card's 📄 CV button makes the CV when you want it. */
async function onJobText(chatId: number, text: string) {
  if (text.length < 40 && !/https?:\/\//.test(text)) return send(chatId, 'Send a full job description or a job link (or /help).');
  await send(chatId, 'Reading the job…');
  const j = await addManualJob({ text });
  await send(chatId, jobCard(j), jobButtons(j));
}

async function onCallback(q: any) {
  const chatId: number = q.message?.chat?.id;
  const [kind, id, status] = String(q.data ?? '').split(':');
  const j = getJob(Number(id));
  if (!j) return call('answerCallbackQuery', { callback_query_id: q.id, text: 'Job not found' });
  if (kind === 'cv') {
    await call('answerCallbackQuery', { callback_query_id: q.id, text: 'Making your CV…' });
    return sendCv(chatId, j);
  }
  if (kind === 'st') {
    setStatus(j.id, status as Status);
    await call('answerCallbackQuery', { callback_query_id: q.id, text: `Marked ${status}` });
    const updated = getJob(j.id)!;
    // Reminder messages aren't job cards: just drop their buttons.
    const isCard = (q.message?.text ?? '').includes(`#${j.id}`) && !(q.message?.text ?? '').startsWith('⏰');
    return isCard
      ? call('editMessageText', { chat_id: chatId, message_id: q.message.message_id, text: jobCard(updated), parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: jobButtons(updated) } })
      : call('editMessageReplyMarkup', { chat_id: chatId, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } });
  }
}

async function onUpdate(u: any) {
  const msg = u.message ?? u.callback_query?.message;
  const chatId: number | undefined = msg?.chat?.id;
  if (!chatId) return;
  let owner = ownerChat();
  if (!owner && u.message?.text?.startsWith('/start')) {
    setKv('telegram_chat_id', String(chatId));
    owner = chatId;
    console.log(`[telegram] chat ${chatId} registered as the owner`);
  }
  if (chatId !== owner) {
    if (u.message) await send(chatId, 'This is a private bot.');
    return;
  }
  try {
    if (u.callback_query) return await onCallback(u.callback_query);
    const text: string = (u.message?.text ?? u.message?.caption ?? '').trim();
    if (!text) return;
    // "/job_86" (tappable in /top lists) and "/cv@botname 86" both work.
    const m = text.match(/^(\/[a-z]+)(?:@\w+)?(?:[_\s]+([\s\S]*))?$/i);
    if (m) return await onCommand(chatId, m[1].toLowerCase(), (m[2] ?? '').trim());
    return await onJobText(chatId, text);
  } catch (err) {
    console.error('[telegram]', err);
    await send(chatId, `⚠️ ${e((err as Error).message.slice(0, 300))}`).catch(() => {});
  }
}

/** Long-polls Telegram forever. */
export async function startBot(): Promise<void> {
  if (!env.telegramToken) {
    console.log('[telegram] TELEGRAM_BOT_TOKEN not set: bot disabled');
    return;
  }
  const me = await call('getMe');
  console.log(`[telegram] running as @${me.username}${ownerChat() ? '' : ' (send it /start to register your chat)'}`);
  await call('setMyCommands', {
    commands: [
      { command: 'top', description: 'Best open matches' },
      { command: 'job', description: 'One job with buttons: /job 86' },
      { command: 'cv', description: 'Tailored CV: /cv 86' },
      { command: 'fetch', description: 'Check all job sources now' },
      { command: 'digest', description: 'Send the digest now' },
      { command: 'stats', description: 'Counts by status' },
      { command: 'help', description: 'How to use this bot' },
    ],
  });

  let offset = Number(getKv('telegram_offset') ?? 0);
  for (;;) {
    try {
      const updates = await call<any[]>('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }, 65_000);
      for (const u of updates) {
        offset = u.update_id + 1;
        setKv('telegram_offset', String(offset));
        // Handled concurrently so a slow CV render doesn't block button taps.
        void onUpdate(u);
      }
    } catch (err) {
      const cause = (err as Error & { cause?: Error }).cause;
      console.error(`[telegram] polling: ${(err as Error).message}${cause ? ` (${cause.message})` : ''}, retrying in 5s`);
      await sleep(5000);
    }
  }
}
