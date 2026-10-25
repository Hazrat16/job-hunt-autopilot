// Dashboard UI: plain JS, no build step. Talks to the JSON API in src/server.ts.
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ELIG = { worldwide: '🌍', asia: '🌏', unknown: '❓', restricted: '🚫' };
const ELIG_LABEL = { worldwide: 'Worldwide', asia: 'Asia-friendly', unknown: 'Location not stated', restricted: 'Restricted' };
const BOARD = ['saved', 'applied', 'interview', 'offer', 'rejected', 'skipped'];

const state = {
  meta: null,
  jobs: [],
  selected: null, // full job
  eligibility: new Set(['worldwide', 'asia', 'unknown']),
  view: 'jobs',
};

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
const ago = (iso) => {
  if (!iso) return '?';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '?');

// ---------- Meta / filters ----------

async function loadMeta() {
  state.meta = await api('/api/meta');
  const m = state.meta;
  const s = m.stats;
  const open = (s.byStatus.new ?? 0) + (s.byStatus.saved ?? 0);
  $('#stats').textContent =
    `${s.total} jobs · ${s.week} this week (${s.good} good) · ${open} open · ${s.byStatus.applied ?? 0} applied · ` +
    `last fetch ${m.lastFetch ? ago(m.lastFetch) : 'never'}`;

  const src = $('#source');
  const cur = src.value;
  src.innerHTML = '<option value="">All sources</option>' + m.sources.map((x) => `<option value="${esc(x.source)}">${esc(x.source)} (${x.n})</option>`).join('');
  src.value = cur;

  const st = $('#status');
  if (st.options.length <= 2) for (const v of m.statuses) st.add(new Option(v[0].toUpperCase() + v.slice(1), v));

  $('#eligChips').innerHTML = m.eligibility
    .map((e) => `<button class="chip" data-elig="${e}" aria-pressed="${state.eligibility.has(e)}" title="${ELIG_LABEL[e]}">${ELIG[e]}</button>`)
    .join('');
}

function filterQuery() {
  const p = new URLSearchParams();
  const q = $('#q').value.trim();
  if (q) p.set('q', q);
  if (+$('#min').value) p.set('min', $('#min').value);
  if (state.eligibility.size < 4) p.set('eligibility', [...state.eligibility].join(','));
  if ($('#status').value) p.set('status', $('#status').value);
  if ($('#source').value) p.set('source', $('#source').value);
  if ($('#days').value) p.set('days', $('#days').value);
  p.set('limit', '300');
  return p.toString();
}

// ---------- Job list ----------

async function loadJobs() {
  state.jobs = await api(`/api/jobs?${filterQuery()}`);
  renderList();
}

function renderList() {
  const ul = $('#jobList');
  $('#listCount').textContent = `${state.jobs.length}${state.jobs.length === 300 ? '+' : ''} job${state.jobs.length === 1 ? '' : 's'}`;
  if (!state.jobs.length) {
    ul.innerHTML = '<li class="empty">No jobs match these filters.</li>';
    return;
  }
  ul.innerHTML = state.jobs
    .map(
      (j) => `<li class="job-item${state.selected?.id === j.id ? ' selected' : ''}" data-id="${j.id}">
        <span class="score ${scoreClass(j.score)}">${j.score}</span>
        <div style="min-width:0">
          <div class="title">${esc(j.title)}</div>
          <div class="sub">${ELIG[j.eligibility]} ${esc(j.company)} · ${esc(j.variant)}${j.salary ? ` · ${esc(j.salary)}` : ''}
            ${j.status !== 'new' ? ` <span class="pill ${j.status}">${j.status}</span>` : ''}</div>
        </div>
      </li>`,
    )
    .join('');
}

// ---------- Detail ----------

async function selectJob(id, { scroll = false } = {}) {
  if (!id) return;
  state.selected = await api(`/api/jobs/${id}`);
  history.replaceState(null, '', `#job=${id}`);
  renderList();
  renderDetail();
  if (scroll) $(`.job-item[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
}

function renderDetail() {
  const j = state.selected;
  const link = j.apply_url || j.url;
  const m = state.meta;
  $('#detail').innerHTML = `
    <div class="d-head">
      <span class="score big ${scoreClass(j.score)}" title="Match score">${j.score}</span>
      <div style="min-width:0">
        <h1>${esc(j.title)}</h1>
        <div class="company">${esc(j.company)}${j.location ? ` · ${esc(j.location)}` : ''}</div>
      </div>
    </div>
    <div class="d-meta">
      <span>${ELIG[j.eligibility]} <b>${ELIG_LABEL[j.eligibility]}</b> (${esc(j.eligibility_reason)})</span>
      <span>Seniority: <b>${esc(j.seniority)}</b></span>
      ${j.salary ? `<span>Salary: <b>${esc(j.salary)}</b></span>` : ''}
      <span>Posted <b>${fmtDate(j.posted_at || j.first_seen)}</b></span>
      <span>Seen on <b>${esc(j.seen_on.join(', '))}</b></span>
      <span>#${j.id}</span>
    </div>
    <div class="d-links">
      ${link ? `<a class="btn primary" href="${esc(link)}" target="_blank" rel="noopener">Open job ↗</a>` : ''}
      ${j.apply_url && j.url && j.apply_url !== j.url ? `<a class="btn" href="${esc(j.url)}" target="_blank" rel="noopener">Posting ↗</a>` : ''}
    </div>

    <div class="card">
      <h3>Application</h3>
      <div class="status-row">
        ${m.statuses.map((s) => `<button class="status-btn${j.status === s ? ' active' : ''}" data-status="${s}">${s}</button>`).join('')}
      </div>
      ${j.events.length ? `<ul class="timeline">${j.events.map((e) => `<li><b>${e.status}</b> ${fmtDate(e.at)}</li>`).join('')}</ul>` : ''}
      <textarea class="notes" id="notes" placeholder="Notes: who you talked to, salary discussed, next steps…">${esc(j.notes ?? '')}</textarea>
    </div>

    <div class="card">
      <h3>Skills (${j.matched.length} matched, ${j.missing.length} missing)</h3>
      <div class="skills">
        ${j.matched.map((s) => `<span class="skill have">✓ ${esc(s)}</span>`).join('')}
        ${j.missing.map((s) => `<span class="skill miss">✗ ${esc(s)}</span>`).join('')}
        ${!j.matched.length && !j.missing.length ? '<span class="ats">No known skills detected in the description.</span>' : ''}
      </div>
    </div>

    <div class="card">
      <h3>Tailored CV</h3>
      <div class="cv-bar">
        <select id="variant" title="CV variant">
          <option value="">Auto (${esc(j.variant)})</option>
          ${m.variants.map((v) => `<option value="${v}">${v}</option>`).join('')}
        </select>
        <button class="btn primary" id="pdfBtn">⬇ Download PDF</button>
        <span class="ats" id="ats">Preview below; the PDF is rendered by Chrome and checked for ATS keywords.</span>
      </div>
      <div class="cv-frame-wrap" id="cvWrap"><iframe id="cvFrame" title="CV preview"></iframe></div>
    </div>

    <div class="card">
      <h3>Job description</h3>
      <div class="desc">${esc(j.description) || '<span class="ats">No description was available from the source.</span>'}</div>
    </div>`;
  loadPreview();
}

function cvParams() {
  const v = $('#variant')?.value;
  return v ? `?variant=${v}` : '';
}

function loadPreview() {
  const frame = $('#cvFrame');
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
  btn.textContent = 'Rendering…';
  try {
    const res = await fetch(`/api/jobs/${state.selected.id}/cv.pdf${cvParams()}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    const name = res.headers.get('content-disposition')?.match(/filename="?([^";]+)/)?.[1] ?? 'CV.pdf';
    const ats = decodeURIComponent(res.headers.get('x-ats') ?? '');
    const dropped = Number(res.headers.get('x-dropped') ?? 0);
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    $('#ats').textContent = `ATS: ${ats}${dropped ? ` Trimmed ${dropped} bullet(s) to fit one page.` : ''}`;
  } catch (err) {
    toast(`CV failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '⬇ Download PDF';
  }
}

async function updateJob(id, body) {
  const j = await api(`/api/jobs/${id}`, { method: 'PATCH', body });
  if (state.selected?.id === id) state.selected = j;
  return j;
}

// ---------- Pipeline ----------

async function loadBoard() {
  const jobs = await api(`/api/jobs?status=${BOARD.join(',')}&limit=1000`);
  $('#board').innerHTML = BOARD.map((s) => {
    const col = jobs.filter((j) => j.status === s).sort((a, b) => (b.status_at ?? '').localeCompare(a.status_at ?? ''));
    return `<div class="column" data-status="${s}">
      <h3>${s} <span>${col.length}</span></h3>
      ${col
        .map(
          (j) => `<div class="bcard" draggable="true" data-id="${j.id}">
            <div class="title">${esc(j.title)}</div>
            <div class="sub">${esc(j.company)} · ${j.score} · ${ago(j.status_at)}</div>
          </div>`,
        )
        .join('')}
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

let searchTimer;
$('#q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadJobs, 250);
});
$('#min').addEventListener('input', (e) => ($('#minOut').textContent = e.target.value));
$('#min').addEventListener('change', loadJobs);
for (const id of ['#status', '#source', '#days']) $(id).addEventListener('change', loadJobs);

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
    await updateJob(state.selected.id, { status: st.dataset.status });
    renderDetail();
    toast(`Marked ${st.dataset.status}`);
    loadJobs();
    loadMeta();
  }
  if (e.target.id === 'pdfBtn') downloadPdf(e.target);
});
$('#detail').addEventListener('change', (e) => {
  if (e.target.id === 'variant') loadPreview();
});
// Notes save when you leave the box.
$('#detail').addEventListener('focusout', async (e) => {
  if (e.target.id !== 'notes' || e.target.value === (state.selected.notes ?? '')) return;
  await updateJob(state.selected.id, { notes: e.target.value });
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
  await updateJob(id, { status: col.dataset.status });
  toast(`Moved to ${col.dataset.status}`);
  loadBoard();
  loadMeta();
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
  btn.textContent = 'Reading…';
  try {
    const j = await api('/api/jobs', { method: 'POST', body: data });
    dialog.close();
    toast(`Added: ${j.title} (score ${j.score})`);
    // Show it even if the current filters would hide it.
    $('#status').value = '';
    await Promise.all([loadMeta(), loadJobs()]);
    selectJob(j.id, { scroll: true });
  } catch (err) {
    $('#addError').textContent = err.message;
    $('#addError').hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add and score';
  }
});

$('#fetchBtn').addEventListener('click', async (e) => {
  const btn = e.target;
  btn.disabled = true;
  btn.textContent = '⟳ Fetching…';
  toast('Checking all sources. LinkedIn is slow on purpose, so this takes 1–3 minutes.', 8000);
  try {
    const r = await api('/api/fetch', { method: 'POST' });
    toast(`${r.added} new job(s) from ${r.fetched} fetched${r.failed.length ? `. Failed: ${r.failed.map((f) => f.source).join(', ')}` : ''}`, 6000);
    await Promise.all([loadMeta(), loadJobs()]);
  } catch (err) {
    toast(`Fetch failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '⟳ Fetch now';
  }
});

// ---------- Start ----------

(async function init() {
  await loadMeta();
  await loadJobs();
  const id = Number(location.hash.match(/job=(\d+)/)?.[1]) || state.jobs[0]?.id;
  if (id) selectJob(id, { scroll: true });
})().catch((err) => toast(`Couldn't load: ${err.message}`, 10_000));
