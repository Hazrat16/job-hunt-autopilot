// Jobs you add yourself: a pasted LinkedIn post / job description, or a job URL.
import * as cheerio from 'cheerio';
import crypto from 'node:crypto';
import type { RawJob } from './types.ts';
import { fetchLinkedInDetail, linkedinJobId } from './linkedin.ts';
import { getText, htmlToText } from '../util.ts';

const ROLE_LINE = /(engineer|developer|devops|sre|architect|programmer|full[- ]?stack|front[- ]?end|back[- ]?end)/i;

/** Best-effort title/company guess from free text such as a LinkedIn "we're hiring" post. */
function guessTitleCompany(text: string): { title: string; company: string } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const roleLine = lines.find((l) => ROLE_LINE.test(l) && l.length < 140) ?? lines[0] ?? 'Untitled job';
  const title = (roleLine.match(/(?:hiring|looking for|seeking)[:\s]+(?:an?\s+)?(.{3,80}?)(?:[.!,(]|$)/i)?.[1] ?? roleLine)
    .replace(/^[#\W]+/, '')
    .slice(0, 120);
  const company =
    text.match(/(?:\bat|@)\s+([A-Z][\w&.\- ]{1,40}?)(?:[\s,.!(]|$)/)?.[1]?.trim() ??
    text.match(/(?:company|organization)[:\s]+([^\n,]{2,40})/i)?.[1]?.trim() ??
    'Unknown company';
  return { title, company };
}

export async function jobFromInput(input: { text?: string; url?: string; title?: string; company?: string }): Promise<RawJob> {
  let { text = '', url, title, company } = input;
  url ||= text.match(/https?:\/\/\S+/)?.[0];
  let location: string | undefined;

  // A bare link: try to fetch the job page.
  if (url && text.replace(url, '').trim().length < 80) {
    const liId = linkedinJobId(url);
    if (liId && !/\/posts\/|\/feed\//.test(url)) {
      const d = await fetchLinkedInDetail(liId);
      text = d.description;
      title ||= d.title;
      company ||= d.company;
      location = d.location;
      url = `https://www.linkedin.com/jobs/view/${liId}/`;
    } else {
      const html = await getText(url);
      const $ = cheerio.load(html);
      title ||= $('h1').first().text().trim() || $('title').text().trim();
      $('nav, header, footer, script, style').remove();
      text = htmlToText($('main').html() ?? $('body').html() ?? html);
    }
  }

  const guess = guessTitleCompany(text);
  const sourceId = crypto.createHash('sha1').update(url ?? text).digest('hex').slice(0, 16);
  return {
    source: 'manual',
    sourceId,
    url: url ?? '',
    title: title || guess.title,
    company: company || guess.company,
    location,
    locationHints: [],
    description: text,
    postedAt: new Date().toISOString(),
  };
}
