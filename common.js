// Shared helpers + Supabase data access, used by index.html and report.html.
const CFG = window.WORKLOG_CONFIG;
const CONFIGURED = !/YOUR-PROJECT|YOUR-ANON/.test(CFG.SUPABASE_URL + CFG.SUPABASE_ANON_KEY);
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
const BUCKET = 'screenshots';
const CATEGORIES = ['Learning', 'Development', 'Bug Fix', 'Meeting', 'Documentation', 'Code Review', 'Deployment', 'Support', 'Other'];

// ---------- theme (dark / light) ----------
function applyTheme(theme, save) {
  document.documentElement.setAttribute('data-theme', theme);
  if (save) { try { localStorage.setItem('worklog.theme', theme); } catch (e) { } }
  const b = document.getElementById('themeBtn');
  if (b) { b.textContent = theme === 'light' ? '🌙' : '☀️'; b.title = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'; }
}
(function initTheme() {
  applyTheme(document.documentElement.getAttribute('data-theme') || 'dark', false);
  const b = document.getElementById('themeBtn');
  if (b) b.addEventListener('click', () => applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light', true));
})();

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
  kids.flat().forEach((c) => c != null && e.append(c));
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

  const urls = {};
  const paths = data.flatMap((e) => e.images || []);
  if (signUrls && paths.length) {
    const res = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
    if (res.error) throw res.error;
    for (const s of res.data) if (s.signedUrl) urls[s.path] = s.signedUrl;
  }
  return data.map((e) => ({
    ...e,
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
      const path = `${session.user.id}/${crypto.randomUUID()}.${ext}`;
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

async function deleteEntry(entry) {
  const { error } = await sb.from('entries').delete().eq('id', entry.id);
  if (error) throw error;
  const paths = entry.images.map((i) => i.path);
  if (paths.length) await sb.storage.from(BUCKET).remove(paths);
}
