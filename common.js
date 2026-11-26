// Shared helpers + Supabase data access, used by index.html and report.html.
const CFG = window.WORKLOG_CONFIG;
const CONFIGURED = !/YOUR-PROJECT|YOUR-ANON/.test(CFG.SUPABASE_URL + CFG.SUPABASE_ANON_KEY);
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
const BUCKET = 'screenshots';
const CATEGORIES = ['Learning', 'Development', 'Bug Fix', 'Meeting', 'Documentation', 'Code Review', 'Deployment', 'Support', 'Other'];

// ---------- theme (dark / light) ----------
const THEMES = ['dark', 'light', 'wheat'];
const THEME_ICON = { dark: '🌙', light: '☀️', wheat: '🌾' };
function applyTheme(theme, save) {
  if (!THEMES.includes(theme)) theme = 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  if (save) { try { localStorage.setItem('worklog.theme', theme); } catch (e) {} }
  const b = document.getElementById('themeBtn');
  if (b) { b.textContent = THEME_ICON[theme]; b.title = `Theme: ${theme} (click to change)`; }
}
(function initTheme() {
  applyTheme(document.documentElement.getAttribute('data-theme') || 'dark', false);
  const b = document.getElementById('themeBtn');
  if (b) b.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    applyTheme(THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length], true); // dark → light → wheat → dark
  });
})();

// Random unique id for file names. crypto.randomUUID() only exists on https:// or localhost pages
// (and newer browsers), so this falls back to getRandomValues, which works everywhere.
function uuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------- tiny DOM helpers ----------
const $ = (s, r = document) => r.querySelector(s);

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  kids.flat(Infinity).forEach((c) => c != null && e.append(c));
  return e;
}

// ---------- dates & time ----------
const pad = (n) => String(n).padStart(2, '0');
const toStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => toStr(new Date());
const fmtDate = (s) => new Date(s + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtDur = (m) => (!m ? '' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}`);

// Minutes between two "HH:MM" times. Returns null if either is missing or end is not after start.
function calcMinutes(start, end) {
  if (!start || !end) return null;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const diff = eh * 60 + em - (sh * 60 + sm);
  return diff > 0 ? diff : null;
}

// ---------- data ----------
async function fetchEntries({ q, category, from, to } = {}, signUrls = true) {
  let query = sb.from('entries').select('*')
    .order('entry_date', { ascending: false })
    .order('start_time', { ascending: false })
    .order('id', { ascending: false });
  if (category) query = query.eq('category', category);
  if (from) query = query.gte('entry_date', from);
  if (to) query = query.lte('entry_date', to);
  if (q) {
    const s = q.replace(/[%,()*]/g, ' ').trim();
    if (s) query = query.or(`title.ilike.%${s}%,description.ilike.%${s}%`);
  }
  const { data, error } = await query;
  if (error) throw error;

  return normalizeEntries(data, signUrls);
}

// Turns raw rows into what the screens use: HH:MM times, and screenshots with temporary signed URLs.
async function normalizeEntries(data, signUrls = true) {
  const urls = {};
  const paths = data.flatMap((e) => e.images || []);
  if (signUrls && paths.length) {
    const res = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
    if (res.error) throw res.error;
    for (const s of res.data) if (s.signedUrl) urls[s.path] = s.signedUrl;
  }
  return data.map((e) => ({
    ...e,
    links: e.links || [],
    start_time: e.start_time ? e.start_time.slice(0, 5) : null,
    end_time: e.end_time ? e.end_time.slice(0, 5) : null,
    images: (e.images || []).map((p) => ({ path: p, url: urls[p] })).filter((i) => i.url || !signUrls),
  }));
}

// fields: columns of the entries table. keepPaths/removePaths: existing screenshot paths. newFiles: File objects.
async function saveEntry({ id, fields, newFiles, keepPaths, removePaths }) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('Please sign in again');
  const uploaded = [];
  try {
    for (const f of newFiles) {
      const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      const path = `${session.user.id}/${uuid()}.${ext}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type });
      if (error) throw error;
      uploaded.push(path);
    }
    const row = { ...fields, images: [...keepPaths, ...uploaded] };
    const { error } = await (id ? sb.from('entries').update(row).eq('id', id) : sb.from('entries').insert(row));
    if (error) throw error;
  } catch (err) {
    if (uploaded.length) await sb.storage.from(BUCKET).remove(uploaded);
    throw err;
  }
  if (removePaths.length) await sb.storage.from(BUCKET).remove(removePaths);
}

// ---------- report (shared by report.html and share.html) ----------
// `entries` must be sorted oldest first.
function reportBlock(e) {
  const time = e.start_time ? ' · ' + e.start_time + (e.end_time ? '–' + e.end_time : '') : '';
  const links = e.links.filter((u) => /^https?:\/\//i.test(u));
  return el('div', { class: 'r-entry' },
    el('h3', { text: e.title }),
    el('div', { class: 'meta' },
      el('span', { text: fmtDate(e.entry_date) + time }),
      el('span', { class: 'badge', text: e.category }),
      e.duration_min ? el('span', { text: fmtDur(e.duration_min) }) : null
    ),
    e.description ? el('p', { class: 'desc', text: e.description }) : null,
    links.length ? el('div', { class: 'links' }, links.map((u) => el('a', { href: u, target: '_blank', rel: 'noopener noreferrer', text: u }))) : null,
    e.images.length ? el('div', { class: 'gallery' }, e.images.map((im) => el('img', { src: im.url, alt: e.title }))) : null
  );
}

function renderReport(container, entries, { name, from, to, note } = {}) {
  const total = entries.reduce((s, e) => s + e.duration_min, 0);
  const days = new Set(entries.map((e) => e.entry_date)).size;
  const byCat = {};
  for (const e of entries) {
    byCat[e.category] ||= { count: 0, minutes: 0 };
    byCat[e.category].count++;
    byCat[e.category].minutes += e.duration_min;
  }
  const first = entries.length ? entries[0].entry_date : null;
  const last = entries.length ? entries[entries.length - 1].entry_date : null;
  const period = `${from ? fmtDate(from) : first ? fmtDate(first) : 'Beginning'} – ${to ? fmtDate(to) : last ? fmtDate(last) : 'Today'}`;
  const stat = (v, l) => el('div', {}, el('b', { text: v }), el('span', { text: l }));

  container.replaceChildren(...[
    el('h1', { text: 'Work Activity Report' }),
    el('div', { class: 'sub', text: [name && 'Prepared by ' + name, period].filter(Boolean).join('  ·  ') }),
    note ? el('div', { class: 'hint no-print', text: note }) : null,
    el('div', { class: 'totals' },
      stat(String(entries.length), 'entries'),
      stat((total / 60).toFixed(1) + ' h', 'time logged'),
      stat(String(days), 'days')
    ),
    entries.length
      ? [
          el('h2', { text: 'By category' }),
          el('table', {},
            el('thead', {}, el('tr', {}, el('th', { text: 'Category' }), el('th', { text: 'Entries' }), el('th', { text: 'Time' }))),
            el('tbody', {}, Object.entries(byCat).map(([c, v]) =>
              el('tr', {}, el('td', { text: c }), el('td', { text: String(v.count) }), el('td', { text: fmtDur(v.minutes) || '—' }))))
          ),
          el('h2', { text: 'Details' }),
          entries.map(reportBlock),
        ]
      : el('p', { class: 'hint', text: 'No entries in this period.' }),
    el('div', { class: 'sign' }, el('div', { text: 'Employee' }), el('div', { text: 'Manager' }), el('div', { text: 'Date' })),
  ].flat(Infinity).filter(Boolean));
}

async function deleteEntry(entry) {
  const { error } = await sb.from('entries').delete().eq('id', entry.id);
  if (error) throw error;
  const paths = entry.images.map((i) => i.path);
  if (paths.length) await sb.storage.from(BUCKET).remove(paths);
}
