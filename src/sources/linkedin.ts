// LinkedIn's public, logged-out job search (the same pages Google indexes).
// No account or cookies are used, so your personal profile can never be flagged.
import * as cheerio from 'cheerio';
import type { RawJob, Source } from './types.ts';
import { eligibility } from '../eligibility.ts';
import { getText, htmlToText, sleep, toIso } from '../util.ts';

const SEARCH = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const DETAIL = 'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/';
const WORLDWIDE_GEO_ID = '92000000';

export interface LinkedInOptions {
  queries: string[];
  hours_back: number;
  pages_per_query: number;
  max_detail_fetches: number;
}

export function linkedinJobId(url: string): string | undefined {
  return url.match(/(?:jobs\/view\/(?:[^/?]*-)?|currentJobId=|jobPosting:)(\d{6,})/)?.[1];
}

export async function fetchLinkedInDetail(id: string): Promise<{ description: string; title?: string; company?: string; location?: string }> {
  const html = await getText(DETAIL + id);
  const $ = cheerio.load(html);
  const description = htmlToText($('.show-more-less-html__markup').html() ?? $('.description__text').html() ?? '');
  const criteria = $('.description__job-criteria-item')
    .map((_, el) => `${$(el).find('h3').text().trim()}: ${$(el).find('span').text().trim()}`)
    .get()
    .join('\n');
  return {
    description: [description, criteria].filter(Boolean).join('\n\n'),
    title: $('.top-card-layout__title, h2').first().text().trim() || undefined,
    company: $('.topcard__org-name-link, .topcard__flavor a').first().text().trim() || undefined,
    location: $('.topcard__flavor--bullet').first().text().trim() || undefined,
  };
}

export function linkedin(opts: LinkedInOptions): Source {
  return {
    name: 'linkedin',
    async fetch(isRelevant) {
      const found = new Map<string, RawJob>();
      for (const q of opts.queries) {
        for (let page = 0; page < opts.pages_per_query; page++) {
          const params = new URLSearchParams({
            keywords: q,
            location: 'Worldwide',
            geoId: WORLDWIDE_GEO_ID,
            f_WT: '2', // remote
            f_TPR: `r${opts.hours_back * 3600}`,
            start: String(page * 10),
          });
          let html: string;
          try {
            html = await getText(`${SEARCH}?${params}`);
          } catch (e) {
            console.warn(`  linkedin "${q}": ${(e as Error).message}`);
            break;
          }
          const $ = cheerio.load(html);
          const cards = $('[data-entity-urn]');
          cards.each((_, el) => {
            const card = $(el);
            const id = card.attr('data-entity-urn')?.split(':').pop();
            const title = card.find('.base-search-card__title').text().trim();
            if (!id || !title || found.has(id) || !isRelevant(title)) return;
            const location = card.find('.job-search-card__location').text().trim();
            found.set(id, {
              source: 'linkedin',
              sourceId: id,
              url: `https://www.linkedin.com/jobs/view/${id}/`,
              title,
              company: card.find('.base-search-card__subtitle').text().trim(),
              location,
              // The card names one place; outside Bangladesh that means remote within that country.
              locationHints: location ? [location] : [],
              description: '',
              postedAt: toIso(card.find('time').attr('datetime')),
            });
          });
          await sleep(1500 + Math.random() * 1500);
          if (cards.length < 10) break;
        }
      }

      // Search cards have no description; fetch details for a capped number, slowly,
      // and only for jobs you could be hired for.
      const jobs = [...found.values()];
      let fetched = 0;
      for (const job of jobs) {
        if (eligibility(job).eligibility === 'restricted') continue;
        if (fetched >= opts.max_detail_fetches) break;
        try {
          job.description = (await fetchLinkedInDetail(job.sourceId)).description;
          fetched++;
        } catch (e) {
          console.warn(`  linkedin detail ${job.sourceId}: ${(e as Error).message}`);
          if (/429/.test((e as Error).message)) break;
        }
        await sleep(1200 + Math.random() * 1200);
      }
      return jobs;
    },
  };
}
