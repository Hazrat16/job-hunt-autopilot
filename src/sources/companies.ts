// Company career pages hosted on Greenhouse, Ashby and Lever (all expose public JSON APIs).
import type { RawJob, Source } from './types.ts';
import { getJson, htmlToText, toIso } from '../util.ts';

function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/** Company boards list every job, including on-site ones; keep remote ones only. */
function isRemote(...fields: (string | undefined | null)[]): boolean {
  return fields.some((f) => f && /remote|anywhere|worldwide|distributed/i.test(f));
}

export function greenhouse(slugs: string[]): Source {
  return {
    name: 'greenhouse',
    async fetch(isRelevant) {
      const out: RawJob[] = [];
      for (const slug of slugs) {
        try {
          const data = await getJson<{ jobs: any[] }>(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`, 60_000);
          for (const j of data.jobs) {
            const loc = j.location?.name ?? '';
            if (!isRelevant(j.title) || !isRemote(loc, j.title)) continue;
            out.push({
              source: 'greenhouse',
              sourceId: `${slug}:${j.id}`,
              url: j.absolute_url,
              title: j.title,
              company: j.company_name ?? slug,
              location: loc,
              locationHints: [loc],
              description: htmlToText(decodeEntities(j.content ?? '')),
              postedAt: toIso(j.first_published ?? j.updated_at),
            });
          }
        } catch (e) {
          console.warn(`  greenhouse/${slug}: ${(e as Error).message}`);
        }
      }
      return out;
    },
  };
}

export function ashby(slugs: string[]): Source {
  return {
    name: 'ashby',
    async fetch(isRelevant) {
      const out: RawJob[] = [];
      for (const slug of slugs) {
        try {
          const data = await getJson<{ jobs: any[] }>(`https://api.ashbyhq.com/posting-api/job-board/${slug}`, 60_000);
          for (const j of data.jobs) {
            if (j.isListed === false || !isRelevant(j.title)) continue;
            if (!j.isRemote && !isRemote(j.location, j.workplaceType)) continue;
            const locs = [j.location, ...(j.secondaryLocations ?? []).map((l: any) => l.location ?? l)].filter(Boolean);
            out.push({
              source: 'ashby',
              sourceId: `${slug}:${j.id}`,
              url: j.jobUrl,
              applyUrl: j.applyUrl,
              title: j.title,
              company: slug.charAt(0).toUpperCase() + slug.slice(1),
              location: locs.join(', '),
              locationHints: locs,
              description: j.descriptionPlain ?? htmlToText(j.descriptionHtml),
              postedAt: toIso(j.publishedAt),
            });
          }
        } catch (e) {
          console.warn(`  ashby/${slug}: ${(e as Error).message}`);
        }
      }
      return out;
    },
  };
}

export function lever(slugs: string[]): Source {
  return {
    name: 'lever',
    async fetch(isRelevant) {
      const out: RawJob[] = [];
      for (const slug of slugs) {
        try {
          const data = await getJson<any[]>(`https://api.lever.co/v0/postings/${slug}?mode=json`, 60_000);
          for (const j of data) {
            const loc = [j.categories?.location, ...(j.categories?.allLocations ?? [])].filter(Boolean).join(', ');
            if (!isRelevant(j.text) || !isRemote(loc, j.workplaceType)) continue;
            const lists = (j.lists ?? []).map((l: any) => `${l.text}\n${htmlToText(l.content)}`).join('\n\n');
            out.push({
              source: 'lever',
              sourceId: `${slug}:${j.id}`,
              url: j.hostedUrl,
              applyUrl: j.applyUrl,
              title: j.text,
              company: slug.charAt(0).toUpperCase() + slug.slice(1),
              location: loc,
              locationHints: loc ? [loc] : [],
              description: [j.descriptionPlain, lists, j.additionalPlain].filter(Boolean).join('\n\n'),
              postedAt: toIso(j.createdAt),
            });
          }
        } catch (e) {
          console.warn(`  lever/${slug}: ${(e as Error).message}`);
        }
      }
      return out;
    },
  };
}
