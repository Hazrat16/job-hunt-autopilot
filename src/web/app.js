// Dashboard UI: plain JS, no build step. Talks to the JSON API in src/server.ts.
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ELIG = {
  worldwide: { icon: '🌍', label: 'Worldwide', tone: 'good' },
  asia: { icon: '🌏', label: 'Open to Asia', tone: 'good' },
  unknown: { icon: '❓', label: 'Location not stated', tone: 'mid' },
  restricted: { icon: '🚫', label: 'Not open to you', tone: 'bad' },
};
const VARIANT_NAME = { fullstack: 'Full-stack', frontend: 'Frontend', backend: 'Backend', devops: 'DevOps', cloud: 'Cloud', ai: 'Full-stack + AI' };
const BOARD = ['saved', 'applied', 'interview', 'offer', 'rejected', 'skipped'];
const OPEN = ['worldwide', 'asia', 'unknown'];

// Quick views: each sets the status filter and default score/location filters.
const PRESETS = {
  best: { status: 'new,saved', min: 50, elig: OPEN, empty: 'No strong matches right now. Try "All open", or find new jobs.' },
  open: { status: 'new,saved', min: 0, elig: OPEN, empty: 'Nothing open. Try "Find new jobs".' },
  saved: { status: 'saved', min: 0, elig: Object.keys(ELIG), empty: 'Nothing saved yet. Use ⭐ Save on a job to keep it here.' },
  all: { status: '', min: 0, elig: Object.keys(ELIG), empty: 'No jobs stored yet. Try "Find new jobs".' },
};

const state = {
  meta: null,
  jobs: [],
  selected: null, // full job incl. description and events
  preset: 'best',
  eligibility: new Set(PRESETS.best.elig),
  view: 'jobs',
  cvOpen: false,
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
function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

const scoreClass = (s) => (s >= 70 ? 'good' : s >= 50 ? 'mid' : '');
const scoreLabel = (s) => (s >= 70 ? 'Strong match' : s >= 50 ? 'Good match' : 'Weak match');
const ago = (iso) => {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : `${Math.floor(d / 30)} mo ago`;
};
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');
const isNew = (j) => state.lastVisit && j.first_seen > state.lastVisit && j.status === 'new';

// ---------- Meta / filters ----------

async function loadMeta() {
  state.meta = await api('/api/meta');
  const m = state.meta;
  const s = m.stats;
  const active = (s.byStatus.applied ?? 0) + (s.byStatus.interview ?? 0) + (s.byStatus.offer ?? 0);
  $('#stats').textContent = `${s.good} good matches this week · ${s.total} jobs tracked · updated ${m.lastFetch ? ago(m.lastFetch) : 'never'}`;
  $('#pipeCount').textContent = active || '';

  const src = $('#source');
  const cur = src.value;
  src.innerHTML = '<option value="">All sources</option>' + m.sources.map((x) => `<option value="${esc(x.source)}">${esc(x.source)} (${x.n})</option>`).join('');
  src.value = cur;
  renderEligChips();
}

function renderEligChips() {
  $('#eligChips').innerHTML = Object.entries(ELIG)
    .map(([k, e]) => `<button class="chip" data-elig="${k}" aria-pressed="${state.eligibility.has(k)}">${e.icon} ${e.label}</button>`)
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
  p.set('limit', '300');
  return p.toString();
}

// ---------- Job list ----------

async function loadJobs() {
  const n = changedFilters();
  $('#filterBadge').textContent = n;
  $('#filterBadge').hidden = !n;
  state.jobs = await api(`/api/jobs?${filterQuery()}`);
  renderList();
}

function renderList() {
  const ul = $('#jobList');
  const fresh = state.jobs.filter(isNew).length;
  $('#listCount').textContent = `${state.jobs.length}${state.jobs.length === 300 ? '+' : ''} job${state.jobs.length === 1 ? '' : 's'}${fresh ? ` · ${fresh} new since your last visit` : ''}`;
  if (!state.jobs.length) {
    ul.innerHTML = `<li class="empty">${esc(PRESETS[state.preset].empty)}</li>`;
    return;
  }
  ul.innerHTML = state.jobs
    .map((j) => {
      const e = ELIG[j.eligibility];
      return `<li class="job-item${state.selected?.id === j.id ? ' selected' : ''}" data-id="${j.id}">
        <span class="score ${scoreClass(j.score)}" title="${scoreLabel(j.score)}">${j.score}</span>
        <div style="min-width:0">
          <div class="title">${esc(j.title)}</div>
          <div class="sub">${esc(j.company)}${j.salary ? ` · ${esc(j.salary)}` : ''}</div>
          <div class="meta">
            <span title="${e.label}">${e.icon} ${e.label}</span>
            <span>${ago(j.posted_at || j.first_seen)}</span>
            ${isNew(j) ? '<span class="new-dot">NEW</span>' : ''}
            ${j.status !== 'new' ? `<span class="pill ${j.status}">${j.status}</span>` : ''}
          </div>
        </div>
      </li>`;
    })
    .join('');
}

// ---------- Detail ----------

async function selectJob(id, { scroll = false } = {}) {
  if (!id) return;
  if (state.selected?.id !== id) state.cvOpen = false;
  state.selected = await api(`/api/jobs/${id}`);
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
  const s = j.status;
  const when = j.status_at ? ` ${ago(j.status_at)}` : '';
  const btn = (status, label, cls = '') => `<button class="btn ${cls}" data-status="${status}">${label}</button>`;
  switch (s) {
    case 'new':
      return btn('saved', '⭐ Save') + btn('applied', '✓ I applied') + btn('skipped', '🙈 Not for me', 'subtle');
    case 'saved':
      return btn('new', '⭐ Saved', 'on') + btn('applied', '✓ I applied', 'good') + btn('skipped', '🙈 Not for me', 'subtle');
    case 'applied':
      return `<span class="status-now">Applied${when}.</span>` + btn('interview', '💬 Got an interview') + btn('rejected', '✗ Rejected', 'subtle');
    case 'interview':
      return `<span class="status-now">Interviewing${when}.</span>` + btn('offer', '🎉 Got an offer', 'good') + btn('rejected', '✗ Rejected', 'subtle');
    default:
      return `<span class="status-now">${s[0].toUpperCase() + s.slice(1)}${when}.</span>` + btn('new', '↺ Move back to open', 'subtle');
  }
}

function renderDetail() {
  const j = state.selected;
  const e = ELIG[j.eligibility];
  const link = j.apply_url || j.url;
  const m = state.meta;
  const desc = j.description || '';
  $('#detail').innerHTML = `<div class="detail-inner">
    <div class="d-head">
      <h1>${esc(j.title)}</h1>
      <div class="company">${esc(j.company)}${j.location ? ` · ${esc(j.location)}` : ''}</div>
    </div>
    <div class="facts">
      <span class="fact ${scoreClass(j.score) || 'bad'}">${scoreLabel(j.score)} · ${j.score}/100</span>
      <span class="fact ${e.tone}">${e.icon} ${e.label}</span>
      ${j.salary ? `<span class="fact">💰 ${esc(j.salary)}</span>` : ''}
      <span class="fact">Posted ${ago(j.posted_at || j.first_seen)}</span>
      <span class="fact">via ${esc(j.seen_on.join(', '))}</span>
    </div>

    <div class="action-bar">
      ${link ? `<a class="btn primary" href="${esc(link)}" target="_blank" rel="noopener">Open job ↗</a>` : ''}
      ${actionButtons(j)}
      <span class="spacer"></span>
      <select id="statusSelect" title="Set any status" aria-label="Set status">
        <option value="">More…</option>
        ${m.statuses.filter((s) => s !== j.status).map((s) => `<option value="${s}">Mark as ${s}</option>`).join('')}
      </select>
    </div>

    <div class="card">
      <h3>Why this score</h3>
      <dl class="match-grid">
        <dt>You have</dt>
        <dd class="skills">${j.matched.map((s) => `<span class="skill have">✓ ${esc(s)}</span>`).join('') || '<span class="muted">No known skills found in the post.</span>'}</dd>
        <dt>Missing</dt>
        <dd class="skills">${j.missing.map((s) => `<span class="skill miss">✗ ${esc(s)}</span>`).join('') || '<span class="muted">Nothing — you cover every skill it mentions.</span>'}</dd>
        <dt>Experience</dt>
        <dd><span class="fact ${seniorityTone(j.seniority)}">${esc(j.seniority)}</span></dd>
        <dt>Location</dt>
        <dd class="muted">${esc(j.eligibility_reason.replace(/^location: /, 'Listed as: '))}</dd>
      </dl>
    </div>

    <div class="card" id="cvCard">${cvCard()}</div>

    <div class="card">
      <h3>Notes</h3>
      <textarea class="notes" id="notes" placeholder="Who you talked to, salary discussed, next steps… (saved automatically)">${esc(j.notes ?? '')}</textarea>
      ${j.events.length ? `<ul class="timeline">${j.events.map((ev) => `<li><b>${ev.status}</b> ${fmtDate(ev.at)}</li>`).join('')}</ul>` : ''}
    </div>

    <div class="card">
      <h3>Job description</h3>
      ${desc
        ? `<div class="desc${desc.length > 900 ? ' folded' : ''}" id="desc">${esc(desc)}</div>
           ${desc.length > 900 ? '<button class="link-btn" id="unfold">Show full description</button>' : ''}`
        : '<p class="muted">The source didn\'t include a description. Use "Open job" to read it there.</p>'}
    </div>
  </div>`;
  if (state.cvOpen) loadPreview();
}

function variantSelect() {
  const j = state.selected;
  return `<select id="variant" title="Which version of your CV to start from">
    <option value="">${esc(VARIANT_NAME[j.variant] ?? j.variant)} (suggested)</option>
    ${state.meta.variants.filter((v) => v !== j.variant).map((v) => `<option value="${v}">${esc(VARIANT_NAME[v] ?? v)}</option>`).join('')}
  </select>`;
}

function cvCard() {
  if (!state.cvOpen) {
    return `<h3>Tailored CV</h3>
      <p class="lead">Picks and orders your own bullets, projects and skills for this job. Nothing is invented.</p>
      <div class="cv-start">${variantSelect()}<button class="btn primary" id="makeCv">📄 Create tailored CV</button></div>`;
  }
  return `<h3>Tailored CV</h3>
    <div class="cv-bar">
      ${variantSelect()}
      <button class="btn primary" id="pdfBtn">⬇ Download PDF</button>
      <span class="ats" id="ats">This is a preview. The PDF is made by Chrome and checked for job keywords.</span>
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
  btn.textContent = 'Making PDF…';
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
    el.textContent = `✓ Downloaded. ATS check: ${ats}${dropped ? ` (${dropped} lower-ranked bullet${dropped > 1 ? 's' : ''} trimmed to fit one page.)` : ''}`;
    el.classList.add('ok');
  } catch (err) {
    toast(`Couldn't make the CV: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '⬇ Download PDF';
  }
}

async function setJobStatus(id, status) {
  const j = await api(`/api/jobs/${id}`, { method: 'PATCH', body: { status } });
  if (state.selected?.id === id) state.selected = j;
  const msg = { saved: 'Saved ⭐', applied: 'Marked as applied. Good luck!', skipped: 'Hidden from your matches', new: 'Moved back to open' }[status];
  toast(msg ?? `Marked as ${status}`);
  loadMeta();
  return j;
}

// ---------- Pipeline ----------

async function loadBoard() {
  const jobs = await api(`/api/jobs?status=${BOARD.join(',')}&limit=1000`);
  $('#board').innerHTML = BOARD.map((s) => {
    const col = jobs.filter((j) => j.status === s).sort((a, b) => (b.status_at ?? '').localeCompare(a.status_at ?? ''));
    return `<div class="column" data-status="${s}">
      <h3>${{ saved: '⭐ Saved', applied: '✓ Applied', interview: '💬 Interview', offer: '🎉 Offer', rejected: '✗ Rejected', skipped: '🙈 Not for me' }[s]} <span>${col.length}</span></h3>
      ${col.length
        ? col.map((j) => `<div class="bcard" draggable="true" data-id="${j.id}">
            <div class="title">${esc(j.title)}</div>
            <div class="sub">${esc(j.company)} · ${ago(j.status_at)}</div>
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
  const item = e.target.closest('.job-item');
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

$('#detail').addEventListener('click', async (e) => {
  const st = e.target.closest('[data-status]');
  if (st) {
    await setJobStatus(state.selected.id, st.dataset.status);
    renderDetail();
    loadJobs();
    return;
  }
  if (e.target.id === 'makeCv') {
    state.cvOpen = true;
    const v = $('#variant').value;
    $('#cvCard').innerHTML = cvCard();
    $('#variant').value = v;
    loadPreview();
  }
  if (e.target.id === 'pdfBtn') downloadPdf(e.target);
  if (e.target.id === 'unfold') {
    $('#desc').classList.remove('folded');
    e.target.remove();
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
  if (card) e.dataTransfer.setData('text/plain', card.dataset.id);
});
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
  btn.textContent = 'Reading the job…';
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
  btn.textContent = '⟳ Searching…';
  toast('Checking all job sources. LinkedIn is slow on purpose, so this takes 1–3 minutes.', 8000);
  try {
    const r = await api('/api/fetch', { method: 'POST' });
    toast(`${r.added ? `${r.added} new job${r.added > 1 ? 's' : ''} found` : 'No new jobs this time'}${r.failed.length ? ` (couldn't reach: ${r.failed.map((f) => f.source).join(', ')})` : ''}`, 6000);
    await Promise.all([loadMeta(), loadJobs()]);
  } catch (err) {
    toast(`Search failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '⟳ Find new jobs';
  }
});

// ---------- Start ----------

(async function init() {
  await loadMeta();
  await loadJobs();
  const id = Number(location.hash.match(/job=(\d+)/)?.[1]) || state.jobs[0]?.id;
  if (id) selectJob(id, { scroll: true });
})().catch((err) => toast(`Couldn't load: ${err.message}`, 10_000));
