import * as cheerio from 'cheerio';

export const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getText(url: string, timeoutMs = 25_000): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

export async function getJson<T = any>(url: string, timeoutMs = 25_000): Promise<T> {
  return JSON.parse(await getText(url, timeoutMs)) as T;
}

/** Converts job-description HTML to readable plain text, keeping line breaks. */
export function htmlToText(html: string | undefined | null): string {
  if (!html) return '';
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  $('br').replaceWith('\n');
  $('p, div, li, h1, h2, h3, h4, h5, h6, tr').each((_, el) => {
    $(el).prepend('\n');
    $(el).append('\n');
  });
  $('li').prepend('• ');
  return $.root()
    .text()
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Builds a case-insensitive regex that matches any of the phrases as whole words. */
export function phraseRegex(phrases: string[]): RegExp {
  const parts = phrases.map((p) => escapeRegex(p.toLowerCase()));
  return new RegExp(`(?<![a-z0-9])(?:${parts.join('|')})(?![a-z0-9])`, 'i');
}

export function toIso(d: string | number | undefined | null): string | undefined {
  if (d === undefined || d === null || d === '') return undefined;
  const date = typeof d === 'number' ? new Date(d < 1e12 ? d * 1000 : d) : new Date(d);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function formatSalary(min?: number | null, max?: number | null, currency = 'USD'): string | undefined {
  if (!min && !max) return undefined;
  const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  return [min, max].filter(Boolean).map((n) => k(n!)).join('–') + ` ${currency}`;
}
