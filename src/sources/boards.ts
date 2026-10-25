// Remote job boards with free public APIs / RSS feeds.
import * as cheerio from 'cheerio';
import type { RawJob, Source } from './types.ts';
import { formatSalary, getJson, getText, htmlToText, toIso } from '../util.ts';

export const remoteok: Source = {
  name: 'remoteok',
  async fetch(isRelevant) {
    const data = await getJson<any[]>('https://remoteok.com/api');
    return data
      .filter((j) => j.id && j.position && isRelevant(j.position))
      .map((j) => ({
        source: 'remoteok',
        sourceId: String(j.id),
        url: j.url,
        applyUrl: j.apply_url,
        title: j.position,
        company: j.company,
        location: j.location || undefined,
        locationHints: j.location ? [j.location] : [],
        description: htmlToText(j.description),
        tags: j.tags,
        salary: formatSalary(j.salary_min, j.salary_max),
        postedAt: toIso(j.date),
      }));
  },
};

export const remotive: Source = {
  name: 'remotive',
  async fetch(isRelevant) {
    const cats = ['software-dev', 'devops'];
    const out: RawJob[] = [];
    for (const c of cats) {
      const data = await getJson<{ jobs: any[] }>(`https://remotive.com/api/remote-jobs?category=${c}`);
      for (const j of data.jobs) {
        if (!isRelevant(j.title)) continue;
        out.push({
          source: 'remotive',
          sourceId: String(j.id),
          url: j.url,
          title: j.title,
          company: j.company_name,
          location: j.candidate_required_location,
          locationHints: j.candidate_required_location ? [j.candidate_required_location] : [],
          description: htmlToText(j.description),
          tags: j.tags,
          salary: j.salary || undefined,
          postedAt: toIso(j.publication_date),
        });
      }
    }
    return out;
  },
};

export const himalayas: Source = {
  name: 'himalayas',
  async fetch(isRelevant) {
    const out: RawJob[] = [];
    // Newest first; 5 pages × 20 covers roughly the last day or two.
    for (let offset = 0; offset < 100; offset += 20) {
      const data = await getJson<{ jobs: any[] }>(`https://himalayas.app/jobs/api?limit=20&offset=${offset}`);
      for (const j of data.jobs) {
        if (!isRelevant(j.title)) continue;
        const restr: string[] = j.locationRestrictions ?? [];
        out.push({
          source: 'himalayas',
          sourceId: j.guid,
          url: j.applicationLink ?? j.guid,
          title: j.title,
          company: j.companyName,
          location: restr.length ? restr.join(', ') : 'Worldwide',
          // Himalayas leaves the list empty when a job is open worldwide.
          locationHints: restr.length ? restr : ['Worldwide'],
          description: htmlToText(j.description),
          tags: j.categories,
          salary: formatSalary(j.minSalary, j.maxSalary, j.currency ?? 'USD'),
          postedAt: toIso(j.pubDate),
        });
      }
      if (data.jobs.length < 20) break;
    }
    return out;
  },
};

export const jobicy: Source = {
  name: 'jobicy',
  async fetch(isRelevant) {
    const out: RawJob[] = [];
    for (const industry of ['dev', 'admin']) {
      const data = await getJson<{ jobs?: any[] }>(`https://jobicy.com/api/v2/remote-jobs?count=100&industry=${industry}`);
      for (const j of data.jobs ?? []) {
        if (!isRelevant(j.jobTitle)) continue;
        out.push({
          source: 'jobicy',
          sourceId: String(j.id),
          url: j.url,
          title: j.jobTitle,
          company: j.companyName,
          location: j.jobGeo,
          locationHints: j.jobGeo ? String(j.jobGeo).split(',').map((s: string) => s.trim()) : [],
          description: htmlToText(j.jobDescription),
          tags: [].concat(j.jobIndustry ?? []),
          salary: formatSalary(j.salaryMin, j.salaryMax, j.salaryCurrency ?? 'USD'),
          postedAt: toIso(j.pubDate),
        });
      }
    }
    return out;
  },
};

export const weworkremotely: Source = {
  name: 'weworkremotely',
  async fetch(isRelevant) {
    const feeds = [
      'remote-full-stack-programming-jobs',
      'remote-back-end-programming-jobs',
      'remote-front-end-programming-jobs',
      'remote-devops-sysadmin-jobs',
    ];
    const out: RawJob[] = [];
    for (const f of feeds) {
      const xml = await getText(`https://weworkremotely.com/categories/${f}.rss`);
      const $ = cheerio.load(xml, { xml: true });
      $('item').each((_, el) => {
        const item = $(el);
        // Titles look like "Company: Role".
        const full = item.find('title').text().trim();
        const idx = full.indexOf(':');
        const company = idx > 0 ? full.slice(0, idx).trim() : '';
        const title = idx > 0 ? full.slice(idx + 1).trim() : full;
        if (!isRelevant(title)) return;
        const region = item.find('region').text().trim();
        const link = item.find('link').text().trim() || item.find('guid').text().trim();
        out.push({
          source: 'weworkremotely',
          sourceId: link,
          url: link,
          title,
          company,
          location: region,
          locationHints: region ? [region] : [],
          description: htmlToText(item.find('description').text()),
          postedAt: toIso(item.find('pubDate').text()),
        });
      });
    }
    return out;
  },
};

export const arbeitnow: Source = {
  name: 'arbeitnow',
  async fetch(isRelevant) {
    const data = await getJson<{ data: any[] }>('https://www.arbeitnow.com/api/job-board-api');
    return data.data
      .filter((j) => j.remote && isRelevant(j.title))
      .map((j) => ({
        source: 'arbeitnow',
        sourceId: j.slug,
        url: j.url,
        title: j.title,
        company: j.company_name,
        location: j.location,
        locationHints: j.location ? [j.location] : [],
        description: htmlToText(j.description),
        tags: j.tags,
        postedAt: toIso(j.created_at),
      }));
  },
};

/** Hacker News "Ask HN: Who is hiring?" — the latest monthly thread, remote posts only. */
export const hnWhosHiring: Source = {
  name: 'hn',
  async fetch(isRelevant) {
    const search = await getJson<{ hits: any[] }>(
      'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=5',
    );
    const story = search.hits.find((h) => /who is hiring/i.test(h.title));
    if (!story) return [];
    const thread = await getJson<{ children: any[] }>(`https://hn.algolia.com/api/v1/items/${story.objectID}`, 60_000);
    const out: RawJob[] = [];
    for (const c of thread.children ?? []) {
      if (!c.text) continue;
      const text = htmlToText(c.text);
      if (!/remote/i.test(text)) continue;
      // Convention: "Company | Role | Location | REMOTE | ..." on the first line.
      const firstLine = text.split('\n')[0];
      const parts = firstLine.split('|').map((s) => s.trim());
      const company = parts[0]?.slice(0, 80) || 'Unknown';
      const roleGuess = parts.slice(1).find((p) => isRelevant(p)) ?? (isRelevant(text.slice(0, 400)) ? parts[1] : undefined);
      if (!roleGuess) continue;
      out.push({
        source: 'hn',
        sourceId: String(c.id),
        url: `https://news.ycombinator.com/item?id=${c.id}`,
        title: roleGuess.slice(0, 120),
        company,
        location: parts.slice(2).join(' | ').slice(0, 120),
        locationHints: [],
        description: text,
        postedAt: toIso(c.created_at),
      });
    }
    return out;
  },
};
