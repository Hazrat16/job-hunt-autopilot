// Dashboard UI: plain JS, no build step. Talks to the JSON API in src/server.ts.
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = (name, cls = '') => `<svg class="i ${cls}"><use href="#i-${name}"/></svg>`;

const ELIG = {
  worldwide: { icon: 'globe', label: 'Worldwide', tone: 'good' },
  asia: { icon: 'pin', label: 'Open to Asia', tone: 'good' },
  unknown: { icon: 'help', label: 'Location not stated', tone: 'mid' },
  restricted: { icon: 'ban', label: 'Not open to you', tone: 'bad' },
};
const VARIANT_NAME = { fullstack: 'Full-stack', frontend: 'Frontend', backend: 'Backend', devops: 'DevOps', cloud: 'Cloud', ai: 'Full-stack + AI' };
const BOARD = [
  { status: 'saved', label: 'Saved', color: 'var(--mid)' },
  { status: 'applied', label: 'Applied', color: 'var(--accent)' },
  { status: 'interview', label: 'Interview', color: '#8b5cf6' },
  { status: 'offer', label: 'Offer', color: 'var(--good)' },
  { status: 'rejected', label: 'Rejected', color: 'var(--bad)' },
  { status: 'skipped', label: 'Not for me', color: 'var(--text-3)' },
];
const OPEN = ['worldwide', 'asia', 'unknown'];

// Quick views: each sets the status filter and default score/location filters.
const PRESETS = {
  best: { status: 'new,saved', fresh: true, min: 50, elig: OPEN, empty: ['No strong matches right now', 'Try "Open", or find new jobs.'] },
  open: { status: 'new,saved', fresh: true, min: 0, elig: OPEN, empty: ['Nothing open', 'Try "Find new jobs" to check the boards.'] },
  saved: { status: 'saved', min: 0, elig: Object.keys(ELIG), empty: ['Nothing saved yet', 'Use Save on a job to keep it here.'] },
  email: { status: '', min: 0, elig: Object.keys(ELIG), apply: 'email', empty: ['No email applications', 'None of your jobs ask you to apply by email right now.'] },
  all: { status: '', min: 0, elig: Object.keys(ELIG), empty: ['No jobs yet', 'Try "Find new jobs" to check the boards.'] },
};

const state = {
  meta: null,
  jobs: [],
  selected: null, // full job incl. description and events
  preset: 'best',
  eligibility: new Set(PRESETS.best.elig),
  view: 'jobs',
  cvOpen: false,
  emailDraft: null, // the open email draft for the selected job, including your edits
  lastVisit: null,
};

// Jobs first seen after your previous visit get a "NEW" badge.
try {
  state.lastVisit = localStorage.getItem('lastVisit');
  localStorage.setItem('lastVisit', new Date().toISOString());
} catch {}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body ? { 'content-type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `${res.status} ${res.statusText}`);
  return res.json();
}

let toastTimer;
function toast(msg, { error = false, ms = 3500 } = {}) {
  const t = $('#toast');
  t.className = `toast${error ? ' err' : ''}`;
  t.innerHTML = `${icon(error ? 'x' : 'check')}<span>${esc(msg)}</span>`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

// ---------- Small visual helpers ----------

const tone = (s) => (s >= 70 ? 'good' : s >= 50 ? 'mid' : 'bad');
const scoreLabel = (s) => (s >= 70 ? 'Strong match' : s >= 50 ? 'Good match' : 'Weak match');

/** Circular score gauge. */
function ring(score, size = 36, stroke = 3.5, cls = '') {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return `<span class="ring ${tone(score)} ${cls}" title="${scoreLabel(score)}: ${score}/100">
    <svg width="${size}" height="${size}"><circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
    <circle class="val" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - score / 100)}"/></svg>
    <b>${score}</b></span>`;
}

/** Company initial(s) on a colour picked from the name, so each company keeps its colour. */
function mono(name, cls = '') {
  const clean = String(name ?? '?').replace(/\(.*?\)|https?:\S+/g, '').trim() || '?';
  const words = clean.split(/[\s\-–.,&]+/).filter((w) => /[a-z0-9]/i.test(w));
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : clean[0]).toUpperCase();
  let h = 0;
  for (const ch of clean) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `<span class="mono ${cls}" style="--h:${h}" aria-hidden="true">${esc(initials)}</span>`;
}

const ago = (iso) => {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`;
};
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const isNew = (j) => state.lastVisit && j.first_seen > state.lastVisit && j.status === 'new';

// ---------- Meta / filters ----------

async function loadMeta() {
  state.meta = await api('/api/meta');
  const m = state.meta;
  const s = m.stats;
  const active = (s.byStatus.applied ?? 0) + (s.byStatus.interview ?? 0) + (s.byStatus.offer ?? 0);
  $('#stats').innerHTML = [
    `<span class="stat"><b>${s.good}</b> good matches this week</span>`,
    `<span class="stat"><b>${s.total}</b> tracked</span>`,
    `<span class="stat">Updated <b>${m.lastFetch ? ago(m.lastFetch) : 'never'}</b></span>`,
  ].join('');
  $('#pipeCount').textContent = active || '';

  const src = $('#source');
  const cur = src.value;
  src.innerHTML = '<option value="">All sources</option>' + m.sources.map((x) => `<option value="${esc(x.source)}">${esc(x.source)} (${x.n})</option>`).join('');
  src.value = cur;
  renderEligChips();
}

function renderEligChips() {
  $('#eligChips').innerHTML = Object.entries(ELIG)
    .map(([k, e]) => `<button class="chip" data-elig="${k}" aria-pressed="${state.eligibility.has(k)}">${icon(e.icon)}${e.label}</button>`)
    .join('');
}

function applyPreset(name) {
  state.preset = name;
  const p = PRESETS[name];
  state.eligibility = new Set(p.elig);
  $('#min').value = p.min;
  $('#minOut').textContent = p.min;
  $('#source').value = '';
  $('#days').value = '';
  document.querySelectorAll('#presets button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.preset === name));
  renderEligChips();
  loadJobs();
}

// How many filters differ from the current quick view's defaults.
function changedFilters() {
  const p = PRESETS[state.preset];
  let n = 0;
  if (+$('#min').value !== p.min) n++;
  if (state.eligibility.size !== p.elig.length || p.elig.some((e) => !state.eligibility.has(e))) n++;
  if ($('#source').value) n++;
  if ($('#days').value) n++;
  return n;
}

function filterQuery() {
  const p = new URLSearchParams();
  const q = $('#q').value.trim();
  if (q) p.set('q', q);
  if (+$('#min').value) p.set('min', $('#min').value);
  if (state.eligibility.size < 4) p.set('eligibility', [...state.eligibility].join(',') || 'none');
  if (PRESETS[state.preset].status) p.set('status', PRESETS[state.preset].status);
  if ($('#source').value) p.set('source', $('#source').value);
  if ($('#days').value) p.set('days', $('#days').value);
  if (PRESETS[state.preset].apply) p.set('apply', PRESETS[state.preset].apply);
  if (PRESETS[state.preset].fresh) p.set('fresh', '1');
  p.set('limit', '300');
  return p.toString();
}

// ---------- Job list ----------

function listSkeleton() {
  $('#jobList').innerHTML = Array.from({ length: 7 }, () =>
    `<li class="job-item skeleton"><span class="mono" style="--h:220"></span><div class="body"><div class="bar" style="width:70%"></div><div class="bar" style="width:45%"></div></div></li>`,
  ).join('');
}

let listReq = 0;
async function loadJobs() {
  const n = changedFilters();
  $('#filterBadge').textContent = n;
  $('#filterBadge').hidden = !n;
  const req = ++listReq;
  if (!state.jobs.length) listSkeleton();
  const jobs = await api(`/api/jobs?${filterQuery()}`);
  if (req !== listReq) return; // a newer search finished first
  state.jobs = jobs;
  renderList();
}

function renderList() {
  const ul = $('#jobList');
  const fresh = state.jobs.filter(isNew).length;
  $('#listCount').innerHTML = `<span>${state.jobs.length}${state.jobs.length === 300 ? '+' : ''} job${state.jobs.length === 1 ? '' : 's'}</span>${fresh ? `<span class="fresh">${fresh} new since your last visit</span>` : ''}`;
  if (!state.jobs.length) {
    const [title, hint] = PRESETS[state.preset].empty;
    ul.innerHTML = `<li class="list-empty"><div class="empty-art">${icon('inbox')}</div><b>${esc(title)}</b><br>${esc(hint)}</li>`;
    return;
  }
  ul.innerHTML = state.jobs
    .map((j) => {
      const e = ELIG[j.eligibility];
      return `<li class="job-item${state.selected?.id === j.id ? ' selected' : ''}" data-id="${j.id}">
        ${mono(j.company)}
        <div class="body">
          <div class="title">${esc(j.title)}</div>
          <div class="sub">${esc(j.company)}${j.salary ? ` · ${esc(j.salary)}` : ''}</div>
          <div class="meta">
            <span>${icon(e.icon)}${e.label}</span>
            <span>${icon('clock')}${ago(j.posted_at || j.first_seen)}</span>
            ${j.apply_email ? `<span title="Apply by email: ${esc(j.apply_email)}">${icon('mail')}Email</span>` : ''}
            ${isNew(j) ? '<span class="new-dot">NEW</span>' : ''}
            ${j.status !== 'new' ? `<span class="pill ${j.status}">${j.status}</span>` : ''}
          </div>
        </div>
        ${ring(j.score)}
      </li>`;
    })
    .join('');
}

// ---------- Detail ----------

async function selectJob(id, { scroll = false } = {}) {
  if (!id) return;
  if (state.selected?.id !== id) {
    state.cvOpen = false;
    state.emailDraft = null;
  }
  state.selected = await api(`/api/jobs/${id}`);
  // Posts that ask for an email application open with the draft ready.
  if (!state.emailDraft && state.selected.emailDraft) state.emailDraft = state.selected.emailDraft;
  history.replaceState(null, '', `#job=${id}`);
  renderList();
  renderDetail();
  if (scroll) $(`.job-item[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  $('#detail').scrollTop = 0;
}

function seniorityTone(note) {
  if (/too senior/.test(note)) return 'bad';
  if (/stretch/.test(note)) return 'mid';
  if (/you have/.test(note)) return 'good';
  return '';
}

// The main buttons depend on where you are with this job.
function actionButtons(j) {
  const when = j.status_at ? ` ${ago(j.status_at)}` : '';
  const btn = (status, ico, label, cls = '') => `<button class="btn ${cls}" data-status="${status}">${icon(ico)}${label}</button>`;
  switch (j.status) {
    case 'new':
      return btn('saved', 'star', 'Save') + btn('applied', 'check', 'I applied') + btn('skipped', 'eye-off', 'Not for me', 'ghost');
    case 'saved':
      return btn('new', 'star', 'Saved', 'on') + btn('applied', 'check', 'I applied', 'good') + btn('skipped', 'eye-off', 'Not for me', 'ghost');
    case 'applied':
      return `<span class="status-now"><span class="pill applied">Applied${when}</span></span>` + btn('interview', 'message', 'Got an interview') + btn('rejected', 'x', 'Rejected', 'ghost');
    case 'interview':
      return `<span class="status-now"><span class="pill interview">Interviewing${when}</span></span>` + btn('offer', 'award', 'Got an offer', 'good') + btn('rejected', 'x', 'Rejected', 'ghost');
    default:
      return `<span class="status-now"><span class="pill ${j.status}">${j.status}${when}</span></span>` + btn('new', 'undo', 'Move back to open', 'ghost');
  }
}

const cardHead = (ico, title, sub = '') => `<div class="card-head"><span class="ico">${icon(ico)}</span><div><h3>${title}</h3>${sub ? `<p>${sub}</p>` : ''}</div></div>`;

function renderDetail() {
  const j = state.selected;
  const e = ELIG[j.eligibility];
  const link = j.apply_url || j.url;
  const m = state.meta;
  const desc = j.description || '';
  $('#detail').innerHTML = `<div class="detail-inner">
    <div class="hero">
      ${mono(j.company, 'lg')}
      <div class="who">
        <h1>${esc(j.title)}</h1>
        <div class="company">
          <span>${icon('briefcase')}${esc(j.company)}</span>
          ${j.location ? `<span>${icon('pin')}${esc(j.location)}</span>` : ''}
        </div>
      </div>
      <div class="score-box">${ring(j.score, 64, 5, 'lg')}<small>${scoreLabel(j.score)}</small></div>
    </div>
    <div class="facts">
      <span class="fact ${e.tone}">${icon(e.icon)}${e.label}</span>
      ${j.salary ? `<span class="fact">${icon('money')}${esc(j.salary)}</span>` : ''}
      <span class="fact">${icon('clock')}Posted ${ago(j.posted_at || j.first_seen)}</span>
      <span class="fact">${icon('inbox')}via ${esc(j.seen_on.join(', '))}</span>
    </div>

    <div class="action-bar" id="actionBar">
      ${link ? `<a class="btn primary" href="${esc(link)}" target="_blank" rel="noopener">Open job${icon('external')}</a>` : ''}
      ${actionButtons(j)}
      <span class="spacer"></span>
      <select id="statusSelect" title="Set any status" aria-label="Set status">
        <option value="">More…</option>
        ${m.statuses.filter((s) => s !== j.status).map((s) => `<option value="${s}">Mark as ${s}</option>`).join('')}
      </select>
    </div>

    ${state.emailDraft?.detected ? `<div class="card email-card" id="emailCard">${emailCard(state.emailDraft)}</div>` : ''}

    <div class="card">
      ${cardHead('gauge', 'Why this score', `${j.matched.length} skills matched, ${j.missing.length} missing`)}
      <dl class="match-grid">
        <dt>You have</dt>
        <dd class="skills">${j.matched.map((s) => `<span class="skill have">${icon('check')}${esc(s)}</span>`).join('') || '<span class="muted">No known skills found in the post.</span>'}</dd>
        <dt>Missing</dt>
        <dd class="skills">${j.missing.map((s) => `<span class="skill miss">${icon('x')}${esc(s)}</span>`).join('') || '<span class="muted">Nothing. You cover every skill it mentions.</span>'}</dd>
        <dt>Experience</dt>
        <dd><span class="fact ${seniorityTone(j.seniority)}">${esc(j.seniority)}</span></dd>
        <dt>Location</dt>
        <dd class="muted">${esc(j.eligibility_reason.replace(/^location: /, 'Listed as: '))}</dd>
      </dl>
    </div>

    <div class="card" id="cvCard">${cvCard()}</div>

    ${state.emailDraft?.detected ? '' : `<div class="card${state.emailDraft ? ' email-card' : ''}" id="emailCard">${state.emailDraft ? emailCard(state.emailDraft) : emailStart()}</div>`}

    <div class="card">
      ${cardHead('note', 'Notes', 'Saved automatically when you click away')}
      <textarea class="notes" id="notes" placeholder="Who you talked to, salary discussed, next steps…">${esc(j.notes ?? '')}</textarea>
      ${j.events.length ? `<ul class="timeline">${j.events.map((ev) => `<li><b>${ev.status}</b>${fmtDate(ev.at)}</li>`).join('')}</ul>` : ''}
    </div>

    <div class="card">
      ${cardHead('text', 'Job description')}
      ${desc
        ? `<div class="desc${desc.length > 900 ? ' folded' : ''}" id="desc">${esc(desc)}</div>
           ${desc.length > 900 ? `<button class="btn unfold" id="unfold">${icon('chevron')}Show full description</button>` : ''}`
        : '<p class="muted">The source didn\'t include a description. Use "Open job" to read it there.</p>'}
    </div>
  </div>`;
  if (state.cvOpen) loadPreview();
}

function emailStart() {
  return `${cardHead('mail', 'Application email', 'For a recruiter or hiring manager you found yourself. Written only from facts in your profile.')}
    <div class="cv-empty">
      <p>Write a short email to send with your CV. You can edit everything before sending.</p>
      <button class="btn" id="writeEmail">${icon('mail')}Write email</button>
    </div>`;
}

function emailCard(d) {
  return `
    ${d.detected
      ? cardHead('mail', 'Apply by email', 'This post asks for applications by email. The draft only uses facts from your profile; edit it freely.')
      : cardHead('mail', 'Application email', 'Uses the CV version selected above. Add the address, then edit anything you like.')}
    ${d.evidence && d.detected ? `<blockquote class="evidence">“${esc(d.evidence)}”</blockquote>` : ''}
    ${d.asksFor ? `<p class="asks">${icon('help')}<span><b>They also ask for:</b> ${esc(d.asksFor)}</span></p>` : ''}
    <div class="mail-field"><label for="mailTo">To</label><input id="mailTo" type="email" value="${esc(d.to)}" placeholder="recruiter@company.com"${d.detected ? ' readonly' : ''}><button class="btn icon-btn ghost" data-copy="mailTo" title="Copy address">${icon('copy')}</button></div>
    <div class="mail-field"><label for="mailSubject">Subject</label><input id="mailSubject" value="${esc(d.subject)}"><button class="btn icon-btn ghost" data-copy="mailSubject" title="Copy subject">${icon('copy')}</button></div>
    <textarea id="mailBody" class="mail-body" rows="14" aria-label="Email body">${esc(d.body)}</textarea>
    <div class="mail-actions">
      <button class="btn primary" id="gmailBtn">${icon('external')}Open in Gmail</button>
      <button class="btn" id="mailtoBtn">${icon('mail')}Open in mail app</button>
      <button class="btn ghost" data-copy="mailBody">${icon('copy')}Copy body</button>
      <span class="muted">Remember to attach your tailored CV.</span>
    </div>`;
}

function mailParts() {
  return { to: $('#mailTo').value, subject: $('#mailSubject').value, body: $('#mailBody').value };
}

function variantSelect() {
  const j = state.selected;
  return `<select id="variant" title="Which version of your CV to start from" aria-label="CV version">
    <option value="">${esc(VARIANT_NAME[j.variant] ?? j.variant)} CV (suggested)</option>
    ${state.meta.variants.filter((v) => v !== j.variant).map((v) => `<option value="${v}">${esc(VARIANT_NAME[v] ?? v)} CV</option>`).join('')}
  </select>`;
}

function cvCard() {
  const head = cardHead('file', 'Tailored CV', 'Your own bullets, projects and skills, picked and ordered for this job. Nothing is invented.');
  if (!state.cvOpen) {
    return `${head}<div class="cv-empty">
      <p>Make a one-page CV for this job when you're ready to apply.</p>
      <div class="row">${variantSelect()}<button class="btn primary" id="makeCv">${icon('file')}Create tailored CV</button></div>
    </div>`;
  }
  return `${head}
    <div class="cv-bar">
      ${variantSelect()}
      <button class="btn primary" id="pdfBtn">${icon('download')}Download PDF</button>
      <span class="ats" id="ats">Preview. The PDF is made by Chrome and checked for job keywords.</span>
    </div>
    <div class="cv-frame-wrap" id="cvWrap"><iframe id="cvFrame" title="CV preview"></iframe></div>`;
}

function cvParams() {
  const v = $('#variant')?.value;
  return v ? `?variant=${v}` : '';
}

function loadPreview() {
  const frame = $('#cvFrame');
  if (!frame) return;
  frame.src = `/api/jobs/${state.selected.id}/cv/preview${cvParams()}`;
  fitFrame();
}

// Scale the A4-sized iframe to the card width.
function fitFrame() {
  const wrap = $('#cvWrap');
  const frame = $('#cvFrame');
  if (!wrap || !frame) return;
  const scale = Math.min(1, wrap.clientWidth / 794);
  frame.style.transform = `scale(${scale})`;
  wrap.style.height = `${1123 * scale}px`;
}
new ResizeObserver(fitFrame).observe(document.body);

async function downloadPdf(btn) {
  btn.disabled = true;
  btn.innerHTML = `${icon('refresh', 'spin')}Making PDF…`;
  try {
    const res = await fetch(`/api/jobs/${state.selected.id}/cv.pdf${cvParams()}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    const name = res.headers.get('content-disposition')?.match(/filename="?([^";]+)/)?.[1] ?? 'CV.pdf';
    const ats = decodeURIComponent(res.headers.get('x-ats') ?? '');
    const dropped = Number(res.headers.get('x-dropped') ?? 0);
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    const el = $('#ats');
    el.innerHTML = `${icon('check')}Downloaded. ATS check: ${esc(ats)}${dropped ? ` (${dropped} lower-ranked bullet${dropped > 1 ? 's' : ''} trimmed to fit one page.)` : ''}`;
    el.classList.add('ok');
    toast('CV downloaded');
  } catch (err) {
    toast(`Couldn't make the CV: ${err.message}`, { error: true });
  } finally {
    btn.disabled = false;
    btn.innerHTML = `${icon('download')}Download PDF`;
  }
}

async function setJobStatus(id, status) {
  const j = await api(`/api/jobs/${id}`, { method: 'PATCH', body: { status } });
  if (state.selected?.id === id) state.selected = j;
  const msg = { saved: 'Saved', applied: 'Marked as applied. Good luck!', skipped: 'Hidden from your matches', new: 'Moved back to open' }[status];
  toast(msg ?? `Marked as ${status}`);
  loadMeta();
  return j;
}

// ---------- Pipeline ----------

async function loadBoard() {
  const jobs = await api(`/api/jobs?status=${BOARD.map((b) => b.status).join(',')}&limit=1000`);
  $('#board').innerHTML = BOARD.map(({ status, label, color }) => {
    const col = jobs.filter((j) => j.status === status).sort((a, b) => (b.status_at ?? '').localeCompare(a.status_at ?? ''));
    return `<div class="column" data-status="${status}">
      <h3><span class="dot" style="--c:${color}"></span>${label}<span class="n">${col.length}</span></h3>
      ${col.length
        ? col.map((j) => `<div class="bcard" draggable="true" data-id="${j.id}">
            ${mono(j.company, 'sm')}
            <div class="body">
              <div class="title">${esc(j.title)}</div>
              <div class="sub">${esc(j.company)} · ${ago(j.status_at)}</div>
            </div>
          </div>`).join('')
        : '<div class="col-empty">Drag jobs here</div>'}
    </div>`;
  }).join('');
}

function showView(view) {
  state.view = view;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  $('#jobsView').hidden = view !== 'jobs';
  $('#pipelineView').hidden = view !== 'pipeline';
  if (view === 'pipeline') loadBoard();
}

// ---------- Events ----------

$('#presets').addEventListener('click', (e) => {
  const b = e.target.closest('[data-preset]');
  if (b) applyPreset(b.dataset.preset);
});

let searchTimer;
$('#q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadJobs, 250);
});
$('#moreFilters').addEventListener('click', (e) => {
  const panel = $('#filterPanel');
  panel.hidden = !panel.hidden;
  e.currentTarget.setAttribute('aria-expanded', !panel.hidden);
});
$('#min').addEventListener('input', (e) => ($('#minOut').textContent = e.target.value));
$('#min').addEventListener('change', loadJobs);
for (const id of ['#source', '#days']) $(id).addEventListener('change', loadJobs);
$('#resetFilters').addEventListener('click', () => applyPreset(state.preset));

$('#eligChips').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-elig]');
  if (!chip) return;
  const v = chip.dataset.elig;
  state.eligibility.has(v) ? state.eligibility.delete(v) : state.eligibility.add(v);
  chip.setAttribute('aria-pressed', state.eligibility.has(v));
  loadJobs();
});

$('#jobList').addEventListener('click', (e) => {
  const item = e.target.closest('.job-item:not(.skeleton)');
  if (item) selectJob(Number(item.dataset.id));
});

// ↑/↓ (or j/k) move through the list.
document.addEventListener('keydown', (e) => {
  if (state.view !== 'jobs' || e.target.closest('input, textarea, select, dialog')) return;
  const dir = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 }[e.key];
  if (!dir || !state.jobs.length) return;
  e.preventDefault();
  const i = state.jobs.findIndex((j) => j.id === state.selected?.id);
  const next = state.jobs[Math.max(0, Math.min(state.jobs.length - 1, i + dir))];
  selectJob(next.id, { scroll: true });
});

// Hairline under the action bar once it sticks to the top.
$('#detail').addEventListener('scroll', (e) => {
  const bar = $('#actionBar');
  if (bar) bar.classList.toggle('stuck', bar.getBoundingClientRect().top <= e.currentTarget.getBoundingClientRect().top + 1);
});

$('#detail').addEventListener('click', async (e) => {
  const st = e.target.closest('[data-status]');
  if (st) {
    await setJobStatus(state.selected.id, st.dataset.status);
    renderDetail();
    loadJobs();
    return;
  }
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    try {
      await navigator.clipboard.writeText($(`#${copy.dataset.copy}`).value);
      toast('Copied');
    } catch {
      $(`#${copy.dataset.copy}`).select();
      toast('Press Ctrl+C to copy', { error: true });
    }
    return;
  }
  const id = e.target.closest('button')?.id;
  if (id === 'writeEmail') {
    const btn = e.target.closest('button');
    btn.disabled = true;
    try {
      state.emailDraft = await api(`/api/jobs/${state.selected.id}/email${cvParams()}`);
      $('#emailCard').innerHTML = emailCard(state.emailDraft);
      $('#emailCard').classList.add('email-card');
      $('#mailTo').focus();
    } catch (err) {
      toast(`Couldn't write the email: ${err.message}`, { error: true });
      btn.disabled = false;
    }
    return;
  }
  if (id === 'gmailBtn' || id === 'mailtoBtn') {
    const m = mailParts();
    const url =
      id === 'gmailBtn'
        ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(m.to)}&su=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`
        : `mailto:${m.to}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
    window.open(url, id === 'gmailBtn' ? '_blank' : '_self');
    return;
  }
  if (id === 'makeCv') {
    state.cvOpen = true;
    const v = $('#variant').value;
    $('#cvCard').innerHTML = cvCard();
    $('#variant').value = v;
    loadPreview();
  }
  if (id === 'pdfBtn') downloadPdf(e.target.closest('button'));
  if (id === 'unfold') {
    $('#desc').classList.remove('folded');
    e.target.closest('button').remove();
  }
});
$('#detail').addEventListener('change', async (e) => {
  if (e.target.id === 'variant' && state.cvOpen) loadPreview();
  if (e.target.id === 'statusSelect' && e.target.value) {
    await setJobStatus(state.selected.id, e.target.value);
    renderDetail();
    loadJobs();
  }
});
// Keep email edits when the page redraws (e.g. after a status change).
$('#detail').addEventListener('input', (e) => {
  const field = { mailTo: 'to', mailSubject: 'subject', mailBody: 'body' }[e.target.id];
  if (field && state.emailDraft) state.emailDraft[field] = e.target.value;
});
// Notes save when you leave the box.
$('#detail').addEventListener('focusout', async (e) => {
  if (e.target.id !== 'notes' || e.target.value === (state.selected.notes ?? '')) return;
  state.selected = await api(`/api/jobs/${state.selected.id}`, { method: 'PATCH', body: { notes: e.target.value } });
  toast('Notes saved');
});

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));

// Pipeline: drag cards between columns, click to open.
const board = $('#board');
board.addEventListener('dragstart', (e) => {
  const card = e.target.closest('.bcard');
  if (!card) return;
  e.dataTransfer.setData('text/plain', card.dataset.id);
  card.classList.add('dragging');
});
board.addEventListener('dragend', (e) => e.target.closest('.bcard')?.classList.remove('dragging'));
board.addEventListener('dragover', (e) => {
  const col = e.target.closest('.column');
  if (!col) return;
  e.preventDefault();
  board.querySelectorAll('.drop').forEach((c) => c !== col && c.classList.remove('drop'));
  col.classList.add('drop');
});
board.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget?.closest?.('.column')) board.querySelectorAll('.drop').forEach((c) => c.classList.remove('drop'));
});
board.addEventListener('drop', async (e) => {
  const col = e.target.closest('.column');
  board.querySelectorAll('.drop').forEach((c) => c.classList.remove('drop'));
  const id = Number(e.dataTransfer.getData('text/plain'));
  if (!col || !id) return;
  e.preventDefault();
  await setJobStatus(id, col.dataset.status);
  loadBoard();
});
board.addEventListener('click', (e) => {
  const card = e.target.closest('.bcard');
  if (!card) return;
  showView('jobs');
  selectJob(Number(card.dataset.id));
});

// Add job
const dialog = $('#addDialog');
$('#addBtn').addEventListener('click', () => {
  $('#addError').hidden = true;
  $('#addForm').reset();
  dialog.showModal();
});
$('#addForm').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'add') return;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  const btn = $('#addSubmit');
  btn.disabled = true;
  btn.innerHTML = `${icon('refresh', 'spin')}Reading the job…`;
  try {
    const j = await api('/api/jobs', { method: 'POST', body: data });
    dialog.close();
    toast(`Added "${j.title}": ${scoreLabel(j.score).toLowerCase()} (${j.score})`);
    // Show it even if the current quick view would hide it.
    $('#q').value = '';
    applyPreset('all');
    await loadMeta();
    selectJob(j.id, { scroll: true });
  } catch (err) {
    $('#addError').textContent = err.message;
    $('#addError').hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add job';
  }
});

$('#fetchBtn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.innerHTML = `${icon('refresh', 'spin')}<span>Searching…</span>`;
  toast('Checking all job sources. LinkedIn is slow on purpose, so this takes 1–3 minutes.', { ms: 8000 });
  try {
    const r = await api('/api/fetch', { method: 'POST' });
    toast(`${r.added ? `${r.added} new job${r.added > 1 ? 's' : ''} found` : 'No new jobs this time'}${r.failed.length ? ` (couldn't reach: ${r.failed.map((f) => f.source).join(', ')})` : ''}`, { ms: 6000 });
    await Promise.all([loadMeta(), loadJobs()]);
  } catch (err) {
    toast(`Search failed: ${err.message}`, { error: true });
  } finally {
    btn.disabled = false;
    btn.innerHTML = `${icon('refresh')}<span>Find new jobs</span>`;
  }
});

// ---------- Start ----------

(async function init() {
  listSkeleton();
  await loadMeta();
  await loadJobs();
  const id = Number(location.hash.match(/job=(\d+)/)?.[1]) || state.jobs[0]?.id;
  if (id) selectJob(id, { scroll: true });
})().catch((err) => toast(`Couldn't load: ${err.message}`, { error: true, ms: 10_000 }));
