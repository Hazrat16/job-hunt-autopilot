// HTML template that mirrors the layout of the original CVs (Calibri-style, ruled section headings).
import type { TailoredCv } from './tailor.ts';
import type { Section } from '../profile.ts';
import { escapeHtml as e } from '../util.ts';

export const PAPER = {
  A4: { css: 'A4', widthMm: 210, heightMm: 297 },
  Letter: { css: 'letter', widthMm: 215.9, heightMm: 279.4 },
  Legal: { css: 'legal', widthMm: 215.9, heightMm: 355.6 },
} as const;
export type Paper = keyof typeof PAPER;

const SECTION_TITLES: Record<Section, (cv: TailoredCv) => string> = {
  ai_practice: () => 'AI-Assisted Development',
  experience: () => 'Work Experience',
  skills: () => 'Technical Skills',
  projects: (cv) => (cv.variant === 'devops' ? 'DevOps and Infrastructure Projects' : cv.variant === 'cloud' ? 'Cloud and Infrastructure Projects' : 'Notable Projects'),
  education: () => 'Education',
};

function linkLabel(url: string): string {
  if (/github\.com/i.test(url)) return 'GitHub ↗';
  if (/npmjs\.com/i.test(url)) return 'npm ↗';
  return 'Link ↗';
}

function section(cv: TailoredCv, s: Section): string {
  const head = `<h2>${e(SECTION_TITLES[s](cv))}</h2>`;
  switch (s) {
    case 'ai_practice':
      return cv.aiPractice.length ? `<section>${head}<ul>${cv.aiPractice.map((t) => `<li>${e(t)}</li>`).join('')}</ul></section>` : '';
    case 'experience':
      return `<section>${head}${cv.experience
        .filter((x) => x.bullets.length)
        .map(
          (x) => `<div class="job">
        <div class="company">${e(x.company)}</div>
        ${
          x.subRoles
            ? `<div class="meta">${e(x.location)}, ${e(x.dates)}</div><div class="meta">${e(x.subRoles)}</div>`
            : `<div class="meta">${e(x.role)}, ${e(x.dates)}, ${e(x.location)}</div>`
        }
        <ul data-min="2">${x.bullets.map((b) => `<li data-score="${b.score}">${e(b.text)}</li>`).join('')}</ul>
      </div>`,
        )
        .join('')}</section>`;
    case 'skills':
      return `<section>${head}<ul>${cv.skills.map((l) => `<li><b>${e(l.label)}:</b> ${e(l.items.join(', '))}</li>`).join('')}</ul></section>`;
    case 'projects':
      return cv.projects.length
        ? `<section>${head}<ul data-min="2">${cv.projects
            .map(
              (p) =>
                `<li data-score="${p.score}"><b>${e(p.title)}</b>${p.url ? ` · <a href="${e(p.url)}">${linkLabel(p.url)}</a>` : ''}<b>:</b> ${e(p.text)}</li>`,
            )
            .join('')}</ul></section>`
        : '';
    case 'education':
      return `<section>${head}${cv.education
        .map((ed) => `<div class="company">${e(ed.school)}</div><div class="degree">${e(ed.degree)}${ed.dates ? ` | ${e(ed.dates)}` : ''}</div>`)
        .join('')}</section>`;
  }
}

/**
 * @param fontBase URL prefix where the Carlito font files are served (file:// for PDF rendering).
 * @param fitLimitPx include the script that shrinks/drops content until the last line ends above this
 *                   y position (CSS px from the top of the page).
 */
export function renderHtml(cv: TailoredCv, opts: { paper: Paper; fontBase: string; fitLimitPx?: number }): string {
  const paper = PAPER[opts.paper];
  const b = cv.basics;
  const contact = [
    `<a href="mailto:${e(b.email)}">${e(b.email)}</a>`,
    e(b.phone),
    e(b.location),
    ...b.links.map((l) => `<a href="${e(l.url)}">${e(l.label)}</a>`),
  ].join(' | ');

  const font = (w: string, style: string, file: string) =>
    `@font-face{font-family:CV;font-weight:${w};font-style:${style};src:url('${opts.fontBase}/${file}') format('truetype');}`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${e(b.name)} — ${e(cv.headline)}</title>
<style>
${font('400', 'normal', 'Carlito-Regular.ttf')}${font('700', 'normal', 'Carlito-Bold.ttf')}${font('400', 'italic', 'Carlito-Italic.ttf')}${font('700', 'italic', 'Carlito-BoldItalic.ttf')}
:root{--fs:10.5pt;--lh:1.28;--sp:1}
@page{size:${paper.css};margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#000}
body{font-family:CV,Calibri,Carlito,'Liberation Sans',Arial,sans-serif;font-size:var(--fs);line-height:var(--lh);-webkit-print-color-adjust:exact}
.page{width:${paper.widthMm}mm;padding:calc(11mm * var(--sp)) 15mm calc(9mm * var(--sp))}
header{text-align:center}
h1{font-size:calc(var(--fs) * 1.95);margin:0;line-height:1.15}
.headline{color:#555;font-weight:700;font-size:calc(var(--fs) * 1.1);margin:2px 0 3px}
.contact{font-size:calc(var(--fs) * 0.95)}
a{color:inherit;text-decoration:none}
li a,.contact a[href^="http"]{color:inherit}
section li a{color:#1155cc;text-decoration:underline}
h2{font-size:calc(var(--fs) * 1.08);text-transform:uppercase;margin:calc(9px * var(--sp)) 0 calc(4px * var(--sp));padding-bottom:1px;border-bottom:1.3px solid #000;letter-spacing:.1px}
p{margin:0}
ul{margin:0;padding-left:19px}
li{margin:0 0 calc(1.5px * var(--sp))}
.job{margin-bottom:calc(6px * var(--sp))}
.company{font-weight:700;margin-top:calc(2px * var(--sp))}
.meta,.degree{font-style:italic}
</style></head>
<body><div class="page">
<header>
  <h1>${e(b.name)}</h1>
  <div class="headline">${e(cv.headline)}</div>
  <div class="contact">${contact}</div>
</header>
<section><h2>Summary</h2><p>${e(cv.summary)}</p></section>
${cv.sections.map((s) => section(cv, s)).join('\n')}
</div>
${opts.fitLimitPx ? fitScript(opts.fitLimitPx) : ''}
</body></html>`;
}

/**
 * Finds the largest type/spacing that fits one page (binary search). If even the smallest
 * setting overflows, drops the lowest-scored bullet/project and searches again.
 */
function fitScript(limitPx: number): string {
  return `<script>
(function(){
  var limit = ${limitPx.toFixed(1)};
  var root = document.documentElement, page = document.querySelector('.page');
  var bottom = function(){ return page.lastElementChild.getBoundingClientRect().bottom; };
  var fits = function(){ return bottom() <= limit; };
  // t = 1 is the roomiest layout (10.5pt), t = 0 the tightest (9.5pt).
  var apply = function(t){
    root.style.setProperty('--fs', (9.5 + t).toFixed(2) + 'pt');
    root.style.setProperty('--lh', (1.18 + t * 0.1).toFixed(3));
    root.style.setProperty('--sp', (0.6 + t * 0.4).toFixed(3));
  };
  var best = function(){
    apply(1); if (fits()) return 1;
    apply(0); if (!fits()) return -1;
    var lo = 0, hi = 1;
    for (var k = 0; k < 10; k++) { var mid = (lo + hi) / 2; apply(mid); if (fits()) lo = mid; else hi = mid; }
    apply(lo); return lo;
  };
  var dropped = [];
  while (best() < 0) {
    var c = Array.prototype.slice.call(document.querySelectorAll('[data-score]'))
      .filter(function(el){ return el.parentElement.children.length > Number(el.parentElement.getAttribute('data-min') || 1); })
      .sort(function(a,b){ return a.getAttribute('data-score') - b.getAttribute('data-score'); })[0];
    if (!c) break;
    dropped.push(c.textContent.slice(0, 90));
    c.remove();
  }
  var meta = document.createElement('script');
  meta.type = 'application/json'; meta.id = 'fit-result';
  meta.textContent = JSON.stringify({ fontSize: root.style.getPropertyValue('--fs'), dropped: dropped, fits: fits(), bottom: bottom() });
  document.body.appendChild(meta);
  document.currentScript && document.currentScript.remove();
})();
</script>`;
}
