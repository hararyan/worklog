// Main page logic. Helpers and data access live in common.js.
const MAX_IMAGES = 8;
const filters = { q: '', category: '', from: '', to: '' };
let currentEntries = [];

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('on'), 2200);
}

// ---------- Sign in / out ----------
let signedIn = false;

function authMsg(text, ok = false) {
  const m = $('#authMsg');
  m.textContent = text;
  m.className = 'msg' + (ok ? ' ok' : '');
}

function showAuth() {
  signedIn = false;
  $('#app').hidden = true;
  $('#auth').hidden = false;
  if (!CONFIGURED) authMsg('Open config.js and paste your Supabase URL and anon key first (see README).');
}

async function showApp() {
  if (signedIn) return;
  signedIn = true;
  $('#auth').hidden = true;
  $('#app').hidden = false;
  await load();
}

$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  authMsg('');
  const { error } = await sb.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#password').value });
  if (error) authMsg(error.message);
});

$('#signupBtn').addEventListener('click', async () => {
  if (!$('#authForm').reportValidity()) return;
  authMsg('');
  const { data, error } = await sb.auth.signUp({ email: $('#email').value.trim(), password: $('#password').value });
  if (error) authMsg(error.message);
  else if (!data.session) authMsg('Account created. Check your email to confirm it, then sign in.', true);
});

$('#signoutBtn').addEventListener('click', () => sb.auth.signOut());

// ---------- Timeline ----------
async function load() {
  try {
    currentEntries = await fetchEntries(filters);
  } catch (err) {
    toast('Could not load: ' + err.message);
    return;
  }
  const mins = currentEntries.reduce((s, e) => s + e.duration_min, 0);
  const days = new Set(currentEntries.map((e) => e.entry_date)).size;
  $('#summary').replaceChildren(
    el('b', { text: String(currentEntries.length) }), currentEntries.length === 1 ? ' entry · ' : ' entries · ',
    el('b', { text: (mins / 60).toFixed(1) + ' h' }), ' logged · ',
    el('b', { text: String(days) }), days === 1 ? ' day' : ' days'
  );
  renderTimeline();
  const rp = new URLSearchParams();
  if (filters.from) rp.set('from', filters.from);
  if (filters.to) rp.set('to', filters.to);
  $('#reportBtn').href = 'report.html' + (rp.toString() ? '?' + rp : '');
}

function renderCard(e) {
  const time = e.start_time ? e.start_time + (e.end_time ? '–' + e.end_time : '') : '';
  return el('article', { class: 'card' },
    el('div', { class: 'card-top' },
      el('h3', { text: e.title }),
      el('button', { class: 'btn small', text: 'Edit', onclick: () => openForm(e) }),
      el('button', { class: 'btn small danger', text: 'Delete', onclick: () => remove(e) })
    ),
    el('div', { class: 'meta' },
      el('span', { class: 'badge', text: e.category }),
      time ? el('span', { text: time }) : null,
      e.duration_min ? el('span', { text: fmtDur(e.duration_min) }) : null
    ),
    e.description ? el('p', { class: 'desc', text: e.description }) : null,
    e.links.length
      ? el('div', { class: 'links' }, e.links.map((u) => el('a', { href: u, target: '_blank', rel: 'noopener noreferrer', text: u })))
      : null,
    e.images.length
      ? el('div', { class: 'gallery' }, e.images.map((im) => el('img', { src: im.url, alt: e.title, loading: 'lazy', onclick: () => openLightbox(im.url) })))
      : null
  );
}

function renderTimeline() {
  const box = $('#timeline');
  if (!currentEntries.length) {
    box.replaceChildren(el('div', { class: 'empty', text: 'Nothing here yet. Click “+ New entry” to log your work.' }));
    return;
  }
  const groups = new Map();
  for (const e of currentEntries) {
    if (!groups.has(e.entry_date)) groups.set(e.entry_date, []);
    groups.get(e.entry_date).push(e);
  }
  box.replaceChildren(
    ...[...groups].map(([date, list]) => {
      const mins = list.reduce((s, x) => s + x.duration_min, 0);
      return el('div', { class: 'day' },
        el('h2', { text: (date === todayStr() ? 'Today · ' : '') + fmtDate(date) + (mins ? ' · ' + fmtDur(mins) : '') }),
        list.map(renderCard)
      );
    })
  );
}

async function remove(e) {
  if (!confirm(`Delete “${e.title}”? Its screenshots will be removed too.`)) return;
  try { await deleteEntry(e); toast('Deleted'); load(); } catch (err) { toast(err.message); }
}

// ---------- Lightbox ----------
function openLightbox(src) { $('#lightbox img').src = src; $('#lightbox').classList.add('on'); }
$('#lightbox').addEventListener('click', () => $('#lightbox').classList.remove('on'));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#lightbox').classList.remove('on'); });

// ---------- Entry form ----------
const dlg = $('#dlg');
let editing = null;
let newFiles = [];
let existing = [];
let removePaths = new Set();

$('#category').replaceChildren(...CATEGORIES.map((c) => el('option', { value: c, text: c })));
$('#fCat').append(...CATEGORIES.map((c) => el('option', { value: c, text: c })));

function openForm(entry = null) {
  editing = entry;
  newFiles = [];
  existing = entry ? entry.images : [];
  removePaths = new Set();
  $('#dlgTitle').textContent = entry ? 'Edit entry' : 'New entry';
  $('#err').textContent = '';

  const cat = entry ? entry.category : 'Learning';
  if (![...$('#category').options].some((o) => o.value === cat)) $('#category').append(el('option', { value: cat, text: cat }));

  $('#title').value = entry ? entry.title : '';
  $('#category').value = cat;
  $('#entry_date').value = entry ? entry.entry_date : todayStr();
  $('#start_time').value = entry ? entry.start_time || '' : '';
  $('#end_time').value = entry ? entry.end_time || '' : '';
  $('#duration').value = entry && entry.duration_min ? entry.duration_min : '';
  $('#description').value = entry ? entry.description : '';
  $('#links').value = entry ? entry.links.join('\n') : '';
  updateHint();
  renderPreviews();
  dlg.showModal();
  $('#title').focus();
}

// Minutes are filled in automatically from start & end time.
function autoDuration() {
  const m = calcMinutes($('#start_time').value, $('#end_time').value);
  if (m != null) $('#duration').value = m;
  updateHint();
}

function updateHint() {
  const s = $('#start_time').value, e = $('#end_time').value;
  const m = calcMinutes(s, e);
  const hint = $('#durHint');
  if (s && e && m == null) hint.textContent = 'End time must be after start time.';
  else if (m != null) hint.textContent = `${fmtDur(m)} (calculated from start and end time)`;
  else hint.textContent = 'Minutes are calculated from start and end time. You can also type them yourself.';
}
$('#start_time').addEventListener('input', autoDuration);
$('#end_time').addEventListener('input', autoDuration);

function renderPreviews() {
  $('#previews').replaceChildren(
    ...existing.map((im) => {
      const gone = removePaths.has(im.path);
      return el('div', { class: 'thumb' + (gone ? ' removed' : '') },
        el('img', { src: im.url, alt: '' }),
        el('button', { type: 'button', text: gone ? '↺' : '×', title: gone ? 'Undo' : 'Remove',
          onclick: () => { gone ? removePaths.delete(im.path) : removePaths.add(im.path); renderPreviews(); } })
      );
    }),
    ...newFiles.map((f, i) =>
      el('div', { class: 'thumb' },
        el('img', { src: URL.createObjectURL(f), alt: '' }),
        el('button', { type: 'button', text: '×', title: 'Remove', onclick: () => { newFiles.splice(i, 1); renderPreviews(); } })
      )
    )
  );
}

function addFiles(list) {
  for (const f of [...list].filter((f) => /^image\/(png|jpe?g|gif|webp)$/.test(f.type))) {
    const kept = existing.filter((x) => !removePaths.has(x.path)).length;
    if (kept + newFiles.length >= MAX_IMAGES) { $('#err').textContent = `Max ${MAX_IMAGES} images`; break; }
    if (f.size > 8 * 1024 * 1024) { $('#err').textContent = 'Image is larger than 8 MB'; continue; }
    newFiles.push(f);
  }
  renderPreviews();
}

const drop = $('#drop');
drop.addEventListener('click', () => $('#files').click());
$('#files').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
dlg.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.some((f) => f.type.startsWith('image/'))) { e.preventDefault(); addFiles(files); }
});

$('#form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const start = $('#start_time').value, end = $('#end_time').value;
  if (start && end && calcMinutes(start, end) == null) { $('#err').textContent = 'End time must be after start time'; return; }

  const fields = {
    title: $('#title').value.trim(),
    category: $('#category').value,
    entry_date: $('#entry_date').value,
    start_time: start || null,
    end_time: end || null,
    duration_min: Math.max(0, Math.min(1440, parseInt($('#duration').value, 10) || 0)),
    description: $('#description').value.trim(),
    links: $('#links').value.split(/\r?\n/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s)),
  };
  const btn = $('#saveBtn');
  btn.disabled = true;
  $('#err').textContent = '';
  try {
    await saveEntry({
      id: editing ? editing.id : null,
      fields,
      newFiles,
      keepPaths: existing.map((i) => i.path).filter((p) => !removePaths.has(p)),
      removePaths: [...removePaths],
    });
    dlg.close();
    toast('Saved ✓');
    load();
  } catch (err) {
    $('#err').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

$('#newBtn').addEventListener('click', () => openForm());
$('#closeBtn').addEventListener('click', () => dlg.close());
$('#cancelBtn').addEventListener('click', () => dlg.close());

// ---------- Filters ----------
let timer;
$('#fQ').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => { filters.q = e.target.value.trim(); load(); }, 250); });
$('#fCat').addEventListener('change', (e) => { filters.category = e.target.value; load(); });
$('#fFrom').addEventListener('change', (e) => { filters.from = e.target.value; load(); });
$('#fTo').addEventListener('change', (e) => { filters.to = e.target.value; load(); });

// ---------- Excel export ----------
// .xlsx (not CSV) so every column gets a proper width and dates are always readable.
function buildExportRows(entries) {
  const nice = (s) => new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const day = (s) => new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' });
  const rows = [['Date', 'Day', 'Start', 'End', 'Minutes', 'Time spent', 'Category', 'Title', 'Details', 'Links', 'Screenshots']];
  let total = 0;
  for (const e of [...entries].reverse()) { // oldest first
    total += e.duration_min;
    rows.push([nice(e.entry_date), day(e.entry_date), e.start_time || '', e.end_time || '', e.duration_min, fmtDur(e.duration_min), e.category, e.title, e.description, e.links.join('\n'), e.images.length]);
  }
  rows.push([], ['Total', '', '', '', total, fmtDur(total) || '0m']);
  return rows;
}

$('#exportBtn').addEventListener('click', async () => {
  try {
    const entries = await fetchEntries(filters, false);
    if (!entries.length) { toast('Nothing to export'); return; }
    const ws = XLSX.utils.aoa_to_sheet(buildExportRows(entries));
    ws['!cols'] = [{ wch: 14 }, { wch: 6 }, { wch: 8 }, { wch: 8 }, { wch: 9 }, { wch: 11 }, { wch: 16 }, { wch: 36 }, { wch: 60 }, { wch: 40 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Work log');
    XLSX.writeFile(wb, `worklog-${todayStr()}.xlsx`);
  } catch (err) {
    toast('Export failed: ' + err.message);
  }
});

// ---------- Start ----------
(async function boot() {
  if (!CONFIGURED) { showAuth(); return; }
  sb.auth.onAuthStateChange((_event, session) => { session ? showApp() : showAuth(); });
  const { data: { session } } = await sb.auth.getSession();
  session ? showApp() : showAuth();
})();
