// Small DOM helpers, icons, sheets, toasts and charts.

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const fmtDate = (iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  iso ? new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('en-GB', opts) : '';
export const today = () => new Date().toISOString().slice(0, 10);
export const fmt1 = (x) => (x == null || isNaN(x) ? '—' : (Math.round(x * 10) / 10).toFixed(1));
export const fmt0 = (x) => (x == null || isNaN(x) ? '—' : String(Math.round(x)));
export const pct = (x) => (x == null || isNaN(x) ? '—' : Math.round(x) + '%');
export const hiText = (x) => (x == null || x === '' || isNaN(x) ? '—' : x < 0 ? '+' + Math.abs(x).toFixed(1) : (+x).toFixed(1));
export const toParText = (n) => (n === 0 ? 'E' : n > 0 ? '+' + n : String(n));

export function scoreMark(g, par) {
  if (!g) return '<span class="mk muted">·</span>';
  const d = g - par;
  const cls = d <= -2 ? 'b2' : d === -1 ? 'b1' : d === 1 ? 'o1' : d >= 2 ? 'o2' : '';
  return `<span class="mk ${cls}">${g}</span>`;
}

export function avatar(p, sm = false) {
  if (!p) return `<span class="avatar${sm ? ' sm' : ''}" style="background:#888">?</span>`;
  const ini = (p.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return `<span class="avatar${sm ? ' sm' : ''}" style="background:${esc(p.colour || '#1d4f9c')}">${esc(ini)}</span>`;
}

let toastTimer;
export function toast(msg, ms = 2400) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), ms);
}

// Bottom sheet. `build(sheetEl, close)` fills it. Returns close().
export function sheet(html, mount, onClose) {
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  let closed = false;
  const close = () => { if (closed) return; closed = true; scrim.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  scrim.addEventListener('click', (e) => { if (e.target === scrim || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(scrim);
  const el = scrim.firstElementChild;
  mount?.(el, close);
  el.querySelector('input:not([type=checkbox]), select')?.focus({ preventScroll: true });
  return close;
}

export function ask(title, body, okLabel = 'OK', danger = false) {
  return new Promise((res) => {
    let ok = false;
    sheet(`<h2>${esc(title)}</h2>${body ? `<p class="muted">${esc(body)}</p>` : ''}
      <div class="btns"><button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="ask-ok">${esc(okLabel)}</button></div>`,
    (el, cl) => { el.querySelector('#ask-ok').onclick = () => { ok = true; cl(); }; },
    () => res(ok));
  });
}

export async function shareText(text, title = 'Fairway Book') {
  try {
    if (navigator.share) { await navigator.share({ title, text }); return 'shared'; }
  } catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  try { await navigator.clipboard.writeText(text); toast('Copied — paste it into WhatsApp'); return 'copied'; }
  catch { return 'failed'; }
}

export function download(name, data, type = 'application/json') {
  const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 1)], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function pickFile(accept = '.json,application/json') {
  return new Promise((res) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept;
    i.onchange = () => res(i.files[0] || null);
    i.click();
  });
}

/* ---------- icons (inline SVG, stroke = currentColor) ---------- */
const P = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/>',
  flag: '<path d="M6 21V3"/><path d="M6 4h11l-2.5 4L17 12H6"/>',
  hcp: '<path d="M4 19h16"/><path d="M6 15l4-5 3 3 5-7"/>',
  stats: '<rect x="4" y="11" width="3.5" height="8" rx="1"/><rect x="10.25" y="6" width="3.5" height="13" rx="1"/><rect x="16.5" y="13" width="3.5" height="6" rx="1"/>',
  more: '<circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  gps: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7.5"/>',
  share: '<path d="M12 15V3"/><path d="M7.5 7.5 12 3l4.5 4.5"/><path d="M5 12v7.5h14V12"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.6-3.4 3-5 6-5s5.4 1.6 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14c2.6 0 4.4 1.3 5 4"/>',
  course: '<path d="M4 18c3-6 6-9 16-11"/><circle cx="18" cy="7" r="2"/><path d="M5 18h14"/>',
  trip: '<path d="M3 18h18"/><path d="M5 18V9l7-5 7 5v9"/><path d="M10 18v-5h4v5"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 18z"/>',
  watch: '<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 6l1-3h4l1 3M9 18l1 3h4l1-3"/><path d="M12 9.5V12l1.5 1.5"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.8z"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  download: '<path d="M12 3v12"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19.5h14"/>',
  upload: '<path d="M12 15V3"/><path d="M7.5 7.5 12 3l4.5 4.5"/><path d="M5 19.5h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  layers: '<path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/>',
};
export function icon(name, extra = '') {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${P[name] || ''}</svg>`;
}

/* ---------- charts ---------- */

// Line chart: points [{x:label, y:number|null}], lower=better flag inverts nothing but marks the best
export function lineChart(points, { height = 220, fmtY = (v) => v, invert = false } = {}) {
  const pts = points.filter((p) => p.y != null && !isNaN(p.y));
  if (pts.length < 2) return '<p class="muted small">Play a couple more rounds to see a trend.</p>';
  const W = 600, H = height, padL = 52, padR = 14, padT = 14, padB = 34;
  const ys = pts.map((p) => p.y);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < 2) { hi += 1; lo -= 1; }
  const span = hi - lo; lo -= span * 0.1; hi += span * 0.1;
  const step = niceStep((hi - lo) / 4);
  const t0 = Math.ceil(lo / step) * step;
  const X = (i) => padL + (i * (W - padL - padR)) / (pts.length - 1);
  const Y = (v) => (invert ? padT + ((v - lo) / (hi - lo)) * (H - padT - padB) : H - padB - ((v - lo) / (hi - lo)) * (H - padT - padB));
  let grid = '';
  for (let v = t0; v <= hi; v += step) grid += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${padL - 6}" y="${Y(v) + 4}" text-anchor="end">${esc(fmtY(+v.toFixed(2)))}</text>`;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const base = invert ? padT : H - padB;
  const area = `${d}L${X(pts.length - 1)},${base}L${X(0)},${base}Z`;
  const labels = [0, Math.floor((pts.length - 1) / 2), pts.length - 1].filter((v, i, a) => a.indexOf(v) === i)
    .map((i) => `<text x="${X(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}">${esc(pts[i].x)}</text>`).join('');
  const dots = pts.map((p, i) => `<circle class="pt${i === pts.length - 1 ? ' end' : ''}" cx="${X(i)}" cy="${Y(p.y)}" r="${i === pts.length - 1 ? 4.5 : 3}"><title>${esc(p.x)}: ${esc(fmtY(p.y))}</title></circle>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${grid}<path class="ar" d="${area}"/><path class="ln" d="${d}"/>${dots}${labels}</svg>`;
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

export function bars(rows, { max } = {}) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.v));
  return `<div class="bars">${rows.map((r) => `<div class="bar"><span>${esc(r.k)}</span><div class="track"><div class="fill ${r.cls || ''}" style="width:${(100 * r.v) / m}%"></div></div><b>${esc(r.label ?? r.v)}</b></div>`).join('')}</div>`;
}

// Colour-blind-safe player colours (no reds or greens), all readable with white initials
export const COLOURS = ['#1d4f9c', '#c77700', '#5b3fa6', '#2b2f3a', '#0b7fbf', '#8a5300', '#a3699e', '#6b7a90'];
export const OLD_COLOURS = ['#17663f', '#c8352b', '#2b5ba8', '#b56a00', '#7a3fa8', '#0f7c84', '#a83f6b', '#4b5a1e'];
