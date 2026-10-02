import { state, save, uid, course } from './store.js';
import { $, $$, esc, icon, toast, ask, fmtDate, sheet } from './ui.js';
import * as Geo from './geo.js';
import { go, render } from './app.js';
import { bookingLinks } from './plans.js';

const TEE_PRESETS = [['White', '#f4f4f4'], ['Yellow', '#f2c94c'], ['Red', '#d64541'], ['Blue', '#2b5ba8'], ['Black', '#222222'], ['Green', '#2e8b57'], ['Purple', '#7a3fa8'], ['Orange', '#e07b28']];

let england = null;
async function englandList() {
  if (england) return england;
  try {
    const r = await fetch('data/england-courses.json');
    england = r.ok ? await r.json() : [];
  } catch { england = []; }
  return england;
}

let searchState = { q: '', near: null, results: null, busy: false };

export function listView() {
  return {
    title: 'Courses', back: '#/more', tab: 'more',
    html: `<section class="card">
        <h2>Find a course</h2>
        <div class="row"><input type="search" id="c-q" placeholder="Course or town, e.g. Woburn" value="${esc(searchState.q)}" autocomplete="off"><button class="btn" id="c-near" aria-label="Courses near me">${icon('gps')}</button></div>
        <p class="tiny muted" id="c-count">England's courses are built in. Tap the target button for courses near you.</p>
        <div class="list" id="c-results"></div>
      </section>
      <section class="card" id="packs" hidden></section>
      <section class="stack"><div class="section-h"><h2>Saved courses</h2><button class="btn sm" id="c-manual">${icon('plus')} Add by hand</button></div>
      <div class="card">${state.courses.length ? `<div class="list">${state.courses.map((c) => `<a class="item" href="#/course/${c.id}">${icon('course', 'width="26"')}<div class="grow"><b>${esc(c.name)}</b>
        <p class="small muted">${c.holes.length} holes · ${c.tees.length} tee${c.tees.length === 1 ? '' : 's'} · ${mappedCount(c)} mapped${c.tees.some((t) => !t.cr) ? ' · <span style="color:var(--warn)">ratings needed</span>' : ''}</p></div></a>`).join('')}</div>`
        : '<div class="empty"><p>Search above and save the course you are playing.</p></div>'}</div></section>`,
    mount() {
      packIndex().then((idx) => {
        if (searchState.results) paintResults();
        const todo = Object.entries(idx).filter(([osm]) => !state.courses.some((c) => c.osm === osm));
        const el = $('#packs');
        if (!el || !todo.length) return;
        el.hidden = false;
        el.innerHTML = `<h2>Ready to play</h2><p class="small muted">Scorecard, ratings and GPS hole maps already set up. One tap and it works offline.</p>
          <div class="list">${todo.map(([osm, p]) => `<div class="item"><div class="grow"><b>${esc(p.name)}</b><p class="small muted">${esc(p.note || '')}</p></div><button class="btn sm primary" data-pack="${osm}">Add</button></div>`).join('')}</div>`;
        $$('[data-pack]', el).forEach((b) => (b.onclick = async () => {
          b.innerHTML = '<span class="spin"></span>';
          const pc = await installPack(b.dataset.pack);
          if (pc) { toast('Added ' + pc.name); render(); } else toast('Could not load that course. Check your connection.');
        }));
      });
      englandList().then((l) => { const el = $('#c-count'); if (el && l.length) el.textContent = `${l.length.toLocaleString()} English courses built in. Tap the target button for courses near you.`; });
      const q = $('#c-q');
      let t;
      q.oninput = () => { clearTimeout(t); t = setTimeout(() => doSearch(q.value), 200); };
      q.onkeydown = (e) => { if (e.key === 'Enter') doSearch(q.value, true); };
      $('#c-near').onclick = nearMe;
      $('#c-manual').onclick = () => addManual();
      if (searchState.results) paintResults();
    },
  };
}

function mappedCount(c) {
  return c.holes.filter((h) => h.green?.poly || h.greenSet || h.line).length;
}

async function doSearch(q, online = false) {
  searchState.q = q;
  q = q.trim().toLowerCase();
  if (q.length < 2) { searchState.results = null; paintResults(); return; }
  const list = await englandList();
  const words = q.split(/\s+/);
  let res = list.filter((c) => words.every((w) => c[0].toLowerCase().includes(w) || (c[5] || '').toLowerCase().includes(w)))
    .slice(0, 40).map(rowToCourse);
  if (searchState.near) res.forEach((r) => (r.d = Geo.dist(searchState.near, [r.lat, r.lon]))), res.sort((a, b) => a.d - b.d);
  searchState.results = res;
  paintResults(online || !res.length);
}

function rowToCourse(c) {
  return { name: c[0], lat: c[1], lon: c[2], osm: c[3], holes: c[4] || null, town: c[5] || '', web: c[6] || null };
}

async function nearMe() {
  const btn = $('#c-near');
  btn.innerHTML = '<span class="spin"></span>';
  try {
    const fix = await Geo.getOnce();
    searchState.near = fix.ll;
    const list = await englandList();
    let res;
    if (list.length) {
      res = list.map(rowToCourse).map((c) => ({ ...c, d: Geo.dist(fix.ll, [c.lat, c.lon]) })).sort((a, b) => a.d - b.d).slice(0, 25);
    } else {
      res = (await Geo.findCoursesNear(fix.ll)).map((c) => ({ ...c, d: Geo.dist(fix.ll, [c.lat, c.lon]) })).sort((a, b) => a.d - b.d);
    }
    searchState.results = res; searchState.q = '';
    $('#c-q').value = '';
    paintResults();
  } catch (e) {
    toast(e.code === 1 ? 'Location is blocked. Allow it in your browser settings.' : 'Could not find you: ' + e.message);
  } finally { btn.innerHTML = icon('gps'); }
}

function paintResults(offerOnline = false) {
  const el = $('#c-results');
  if (!el) return;
  const res = searchState.results;
  if (!res) { el.innerHTML = ''; return; }
  el.innerHTML = res.map((c, i) => {
    const saved = state.courses.find((s) => s.osm && s.osm === c.osm);
    return `<div class="item"><div class="grow"><b>${esc(c.name)}</b>${packs?.[c.osm] ? ' <span class="pill good">Ready to play</span>' : ''}<p class="small muted">${[c.town, c.d != null ? `${(c.d / 1609.34).toFixed(1)} miles` : '', c.holes ? c.holes + ' holes' : ''].filter(Boolean).map(esc).join(' · ')}</p></div>
      ${saved ? `<a class="btn sm" href="#/course/${saved.id}">Open</a>` : `<button class="btn sm primary" data-add="${i}">Save</button>`}</div>`;
  }).join('') + (offerOnline || !res.length ? `<div class="item"><div class="grow small muted">${res.length ? 'Not the one?' : 'No match in the built-in list.'}</div><button class="btn sm" id="c-online">${icon('search')} Search online</button></div>` : '');
  $$('[data-add]', el).forEach((b) => (b.onclick = () => saveCourse(res[+b.dataset.add], b)));
  $('#c-online', el)?.addEventListener('click', onlineSearch);
}

async function onlineSearch() {
  const q = searchState.q.trim();
  if (!q) return;
  const btn = $('#c-online');
  btn.innerHTML = '<span class="spin"></span>';
  try {
    const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=15&q=${encodeURIComponent(q + ' golf')}`;
    const r = await fetch(u, { headers: { Accept: 'application/json' } });
    const j = await r.json();
    const res = j.filter((x) => x.type === 'golf_course' || /golf/i.test(x.display_name))
      .map((x) => ({ name: x.name || x.display_name.split(',')[0], lat: +x.lat, lon: +x.lon, osm: x.osm_type ? x.osm_type[0] + x.osm_id : null, town: x.display_name.split(',').slice(1, 3).join(',').trim() }));
    searchState.results = res;
    paintResults();
    if (!res.length) toast('Nothing found online either. Add it by hand.');
  } catch { toast('Online search needs a connection'); btn.innerHTML = 'Search online'; }
}

function blankHoles(n) {
  return Array.from({ length: n }, (_, i) => ({ n: i + 1, par: 4, si: n === 18 ? null : null }));
}

function defaultTees() {
  return [
    { id: uid(), name: 'White', colour: '#f4f4f4', cr: null, slope: null, yards: [] },
    { id: uid(), name: 'Yellow', colour: '#f2c94c', cr: null, slope: null, yards: [] },
    { id: uid(), name: 'Red', colour: '#d64541', cr: null, slope: null, yards: [] },
  ];
}

// Courses we have fully set up (scorecard, ratings and GPS maps) ship with the app
let packs = null;
export async function packIndex() {
  if (packs) return packs;
  try { const r = await fetch('data/packs/index.json'); packs = r.ok ? await r.json() : {}; } catch { packs = {}; }
  return packs;
}

export async function installPack(osm) {
  const entry = (await packIndex())[osm];
  if (!entry) return null;
  const r = await fetch('data/packs/' + entry.file);
  if (!r.ok) return null;
  const pc = await r.json();
  const i = state.courses.findIndex((x) => x.id === pc.id);
  if (i >= 0) return state.courses[i];
  state.courses.push(pc);
  save();
  return pc;
}

// Put a built-in course back exactly as it ships, keeping its id so rounds stay linked
export async function restorePack(c) {
  const entry = (await packIndex())[c.osm];
  if (!entry) return false;
  try {
    const r = await fetch('data/packs/' + entry.file, { cache: 'reload' });
    if (!r.ok) return false;
    const pc = await r.json();
    for (const k of ['holes', 'tees', 'osmGreens', 'osmHazards', 'verified', 'name']) c[k] = pc[k];
    c.updated = Date.now();
    save();
    return true;
  } catch { return false; }
}

async function saveCourse(c, btn) {
  if (btn) btn.innerHTML = '<span class="spin"></span>';
  const pc = await installPack(c.osm);
  if (pc) { toast('Ready to play: scorecard, ratings and GPS maps included'); go('#/course/' + pc.id); return; }
  const nc = {
    id: uid(), created: Date.now(), name: c.name, osm: c.osm, lat: c.lat, lon: c.lon, web: c.web || null, town: c.town || '',
    holes: blankHoles(c.holes === 9 ? 9 : 18), tees: defaultTees(), verified: false,
  };
  state.courses.push(nc);
  save();
  try { await loadLayout(nc, true); } catch (e) { toast(e.message, 4000); }
  go('#/course/' + nc.id);
}

function addManual() {
  sheet(`<h2>Add a course by hand</h2>
    <label class="field">Name<input type="text" id="m-name" placeholder="e.g. Royal Lytham"></label>
    <label class="field">Holes<select id="m-holes"><option>18</option><option>9</option></select></label>
    <p class="small muted">Its location is set from where you are now (or you can load OpenStreetMap maps later from the course page).</p>
    <button class="btn primary" id="m-save">Create</button>`, (el, close) => {
    $('#m-save', el).onclick = async () => {
      const name = $('#m-name', el).value.trim();
      if (!name) return toast('Name it first');
      let ll = [52.5, -1.5];
      try { ll = (await Geo.getOnce()).ll; } catch { /* centre of England */ }
      const nc = { id: uid(), created: Date.now(), name, lat: ll[0], lon: ll[1], osm: null, holes: blankHoles(+$('#m-holes', el).value), tees: defaultTees(), verified: false };
      state.courses.push(nc); save(); close(); go('#/course/' + nc.id);
    };
  });
}

// Fetch the OSM layout and merge it into the course
function pickLayout(c, layouts) {
  return new Promise((res) => {
    let pick = null;
    sheet(`<h2>Which course?</h2>
      <p class="small muted">OpenStreetMap has ${layouts.length} different layouts at ${esc(c.name)}. Pick the one you play. Match the par and length to your scorecard.</p>
      <div class="list">${layouts.map((L, i) => {
        const par = L.reduce((s, h) => s + h.par, 0);
        const yd = Math.round(L.reduce((s, h) => s + h.lengthM, 0) * Geo.M_TO_YD);
        return `<button class="item btn ghost" data-lay="${i}" style="justify-content:flex-start;text-align:left"><b class="bignum" style="font-size:1.6rem;width:1.4em">${String.fromCharCode(65 + i)}</b>
          <div class="grow"><b>${L.length} holes · par ${par}</b><p class="small muted">${yd.toLocaleString()} yards (centre line) · hole 1 is ${Math.round(Geo.dist([c.lat, c.lon], L[0].tee))} m from the club pin</p></div></button>`;
      }).join('')}</div>`,
    (el, close) => $$('[data-lay]', el).forEach((b) => (b.onclick = () => { pick = layouts[+b.dataset.lay]; close(); })),
    () => res(pick));
  });
}

export async function loadLayout(c, quiet = false) {
  const lay = await Geo.fetchCourseLayout(c);
  if (lay.layouts.length > 1) {
    const chosen = await pickLayout(c, lay.layouts);
    if (!chosen) return 0;
    lay.holes = chosen;
  }
  // Loose greens and hazards near the course, for snapping when holes are mapped by hand
  const near = (x) => Geo.dist([c.lat, c.lon], x.c) < 2500;
  c.osmGreens = lay.greens.filter(near);
  c.osmHazards = lay.hazards.filter(near);
  if (!lay.holes.length) {
    const g = c.osmGreens.length;
    toast(g ? `OpenStreetMap has ${g} greens here but no hole routing. Use "Map it yourself": tap each green in order and it snaps to the real outline.`
      : `${quiet ? 'Saved. ' : ''}No hole maps on OpenStreetMap yet. Use "Map it yourself" on the satellite photo, or set greens as you play.`, 6000);
    c.layoutFetched = Date.now(); c.updated = Date.now(); save();
    return 0;
  }
  const maxRef = Math.max(...lay.holes.map((h) => h.n));
  if (!c.verified) {
    const n = maxRef <= 9 ? 9 : 18;
    if (c.holes.length !== n) c.holes = blankHoles(n);
  }
  for (const oh of lay.holes) {
    const h = c.holes[oh.n - 1];
    if (!h) continue;
    if (!c.verified || h.par == null) { if (oh.parFromOsm || h.par == null || !c.verified) h.par = oh.par; }
    if ((!c.verified || h.si == null) && oh.si) h.si = oh.si;
    h.tee = oh.tee; h.line = oh.line; h.green = oh.green; h.hazards = oh.hazards; h.lengthM = oh.lengthM;
  }
  c.layoutFetched = Date.now(); c.updated = Date.now();
  // centre the course on its holes
  const all = c.holes.filter((h) => h.green?.c).map((h) => h.green.c);
  if (all.length) { c.lat = all.reduce((s, p) => s + p[0], 0) / all.length; c.lon = all.reduce((s, p) => s + p[1], 0) / all.length; }
  save();
  toast(`Loaded maps for ${lay.holes.length} holes`);
  return lay.holes.length;
}

/* ---------------- detail ---------------- */

let teeSel = null;
let overview = null;
let ovLayer = null;
let mapHole = 0;
let mapWhat = 'green';
let editMap = false; // taps only change the map when editing is switched on
let undoStack = [];

const holeHas = (h, what) => !!(what === 'green' ? h.green?.c && (h.greenSet || h.green.poly || h.line) : h.tee);

export function detailView(id) {
  const c = course(id);
  if (!c) return { html: '<div class="empty">Course not found.</div>', back: '#/courses' };
  if (!teeSel || !c.tees.some((t) => t.id === teeSel)) teeSel = c.tees[1]?.id || c.tees[0]?.id;
  const tee = c.tees.find((t) => t.id === teeSel);
  const par = c.holes.reduce((s, h) => s + (h.par || 0), 0);
  const sis = c.holes.map((h) => h.si).filter(Boolean);
  const siOk = sis.length === c.holes.length && new Set(sis).size === sis.length;
  const mapped = mappedCount(c);
  return {
    title: c.name, back: '#/courses', tab: 'more',
    html: `<section class="card">
        <div class="row between"><div><span class="eyebrow">${c.holes.length} holes · par ${par}</span><h2>${esc(c.name)}</h2></div></div>
        ${bookingLinks(c)}
        <div id="ov-map" class="map tall"></div>
        ${editMap ? `<div class="stack" id="mapper">
          <div class="row between"><b>Editing the map</b><div class="seg" style="min-width:150px">${['green', 'tee'].map((w) => `<button data-what="${w}" class="${mapWhat === w ? 'on' : ''}">${w === 'green' ? 'Greens' : 'Tees'}</button>`).join('')}</div></div>
          <div class="holes" id="map-holes">${c.holes.map((h, i) => `<button data-mh="${i}" class="${i === mapHole ? 'on' : ''} ${holeHas(h, mapWhat) ? 'done' : ''}">${i + 1}</button>`).join('')}</div>
          <p class="tiny muted">Pick a hole, then tap the middle of its green on the photo (or its tee in Tees mode). Yellow dashed outlines are greens already on OpenStreetMap: tap inside one and it snaps to the real shape for accurate front and back yardages. It moves on to the next hole by itself.</p>
          <div class="btns"><button class="btn" id="map-undo" ${undoStack.length ? '' : 'disabled'}>Undo last tap</button><button class="btn primary" id="map-done">${icon('check')} Done</button></div>
        </div>` : `<div class="btns"><button class="btn" id="map-edit">${icon('edit')} ${mapped ? 'Edit map' : 'Map it yourself'}</button>${c.pack ? `<button class="btn" id="map-restore">Restore original map</button>` : ''}</div>`}
        <p class="small muted">${mapped} of ${c.holes.length} holes have GPS maps${c.layoutFetched ? ` · checked ${fmtDate(new Date(c.layoutFetched).toISOString().slice(0, 10))}` : ''}.</p>
        <div class="btns"><button class="btn primary" id="cd-osm">${icon('layers')} ${mapped ? 'Reload' : 'Load'} hole maps</button><button class="btn" id="cd-tiles">${icon('download')} Save map offline</button></div>
        <p class="tiny muted" id="tile-status">Do both at home on Wi-Fi. Course signal is often poor.</p>
      </section>

      <section class="card">
        <div class="row between"><h2>Tees and ratings</h2><button class="btn sm" id="cd-addtee">${icon('plus')} Tee</button></div>
        <p class="small muted">Copy the Course Rating and Slope from the scorecard or the club website. Handicaps depend on them.</p>
        ${c.tees.map((t, i) => `<div class="stack" style="gap:6px;padding-top:8px;border-top:1px solid var(--line)">
          <div class="row"><span class="sw" style="background:${esc(t.colour)};border:1px solid var(--line);width:16px;height:16px;border-radius:50%"></span><input type="text" data-tn="${i}" value="${esc(t.name)}" style="flex:1"><button class="btn sm ghost" data-tdel="${i}" aria-label="Remove tee">${icon('trash')}</button></div>
          <div class="grid3">
            <label class="field">Course Rating<input type="number" step="0.1" inputmode="decimal" data-cr="${i}" value="${t.cr ?? ''}" placeholder="e.g. 70.4"></label>
            <label class="field">Slope<input type="number" step="1" inputmode="numeric" data-sl="${i}" value="${t.slope ?? ''}" placeholder="55–155"></label>
            <label class="field">Par<input type="number" disabled value="${par}"></label>
          </div>
          <details><summary class="small">9-hole ratings (optional)</summary><div class="grid2" style="margin-top:6px">
            <label class="field">Front 9 CR<input type="number" step="0.1" data-cr9f="${i}" value="${t.cr9f ?? ''}" placeholder="${t.cr ? (t.cr / 2).toFixed(1) : ''}"></label>
            <label class="field">Front 9 slope<input type="number" data-sl9f="${i}" value="${t.slope9f ?? ''}" placeholder="${t.slope ?? ''}"></label>
            <label class="field">Back 9 CR<input type="number" step="0.1" data-cr9b="${i}" value="${t.cr9b ?? ''}" placeholder="${t.cr ? (t.cr / 2).toFixed(1) : ''}"></label>
            <label class="field">Back 9 slope<input type="number" data-sl9b="${i}" value="${t.slope9b ?? ''}" placeholder="${t.slope ?? ''}"></label>
          </div></details></div>`).join('')}
      </section>

      <section class="card">
        <div class="row between"><h2>Scorecard</h2><select id="cd-holes" style="width:auto"><option value="18"${c.holes.length === 18 ? ' selected' : ''}>18 holes</option><option value="9"${c.holes.length === 9 ? ' selected' : ''}>9 holes</option></select></div>
        ${siOk ? '' : `<p class="small"><span class="pill warn">Check stroke indexes</span> Each hole needs a different SI (1 = hardest). Copy them from the scorecard.</p>`}
        <div class="chips">${c.tees.map((t) => `<button class="chip${t.id === teeSel ? ' on' : ''}" data-ts="${t.id}">${esc(t.name)} yardages</button>`).join('')}</div>
        <div class="tbl-wrap"><table class="data"><thead><tr><th>Hole</th><th>Par</th><th>SI</th><th>${esc(tee?.name || '')} yds</th><th class="r">Map</th></tr></thead><tbody>
        ${c.holes.map((h, i) => `<tr><td><b>${i + 1}</b></td>
          <td><input type="number" min="3" max="6" data-par="${i}" value="${h.par ?? ''}" style="width:4.2em;min-height:38px;padding:6px"></td>
          <td><input type="number" min="1" max="18" data-si="${i}" value="${h.si ?? ''}" style="width:4.2em;min-height:38px;padding:6px"></td>
          <td><input type="number" data-yd="${i}" value="${tee?.yards?.[i] ?? ''}" placeholder="${h.lengthM ? Math.round(h.lengthM * Geo.M_TO_YD) : ''}" style="width:5.2em;min-height:38px;padding:6px"></td>
          <td class="r">${h.green?.poly || h.greenSet ? '<span class="pill good">Green</span>' : h.line ? '<span class="pill">Line</span>' : '<span class="pill warn">None</span>'}</td></tr>`).join('')}
        </tbody></table></div>
        <label class="switch small">Scorecard checked (stops map reloads overwriting par and SI)<input type="checkbox" id="cd-ver" ${c.verified ? 'checked' : ''}></label>
      </section>
      <button class="btn danger" id="cd-del">${icon('trash')} Delete course</button>`,
    mount() {
      if (mapHole >= c.holes.length) mapHole = 0;
      drawOverview(c);
      const upd = () => { c.updated = Date.now(); save(); };
      const paintMapper = () => {
        $$('[data-mh]').forEach((b, i) => { b.classList.toggle('on', i === mapHole); b.classList.toggle('done', holeHas(c.holes[i], mapWhat)); });
        $$('[data-what]').forEach((b) => b.classList.toggle('on', b.dataset.what === mapWhat));
      };
      $$('[data-mh]').forEach((b) => (b.onclick = () => { mapHole = +b.dataset.mh; paintMapper(); focusHole(c, mapHole); }));
      $$('[data-what]').forEach((b) => (b.onclick = () => { mapWhat = b.dataset.what; paintMapper(); }));
      $('#map-edit')?.addEventListener('click', () => { editMap = true; undoStack = []; render(); });
      $('#map-done')?.addEventListener('click', () => { editMap = false; undoStack = []; render(); });
      $('#map-undo')?.addEventListener('click', () => {
        const last = undoStack.pop();
        if (!last) return;
        c.holes[last.i] = last.hole; mapHole = last.i; upd();
        toast(`Hole ${last.i + 1} put back`, 1200);
        paintMapper(); drawMarkers(c);
        $('#map-undo').disabled = !undoStack.length;
      });
      $('#map-restore')?.addEventListener('click', async () => {
        if (!(await ask('Restore the original map?', 'Greens, tees, hazards, par, stroke index and ratings go back to how they came in the app. Rounds already played are not affected.', 'Restore'))) return;
        if (await restorePack(c)) { toast('Original map restored'); render(); } else toast('Could not load the original. Check your connection.');
      });
      overview?.on('click', (e) => {
        if (!editMap) return;
        const h = c.holes[mapHole];
        undoStack.push({ i: mapHole, hole: JSON.parse(JSON.stringify(h)) });
        $('#map-undo').disabled = false;
        const ll = [+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)];
        if (mapWhat === 'green') {
          // Snap to a mapped green outline when the tap lands on one
          const og = (c.osmGreens || []).find((gr) => Geo.pointInPoly(ll, gr.poly));
          h.green = og ? { poly: og.poly, c: og.c } : { poly: h.green?.poly && Geo.dist(ll, h.green.c) < 40 ? h.green.poly : null, c: ll };
          h.greenSet = true;
        } else h.tee = ll;
        if (h.tee && h.green?.c && !h.line) {
          h.lengthM = Math.round(Geo.dist(h.tee, h.green.c));
          h.hazards = Geo.hazardsForLine(c.osmHazards, [h.tee, h.green.c]);
        }
        upd();
        toast(`Hole ${mapHole + 1} ${mapWhat} saved`, 1200);
        if (mapHole < c.holes.length - 1) mapHole++;
        paintMapper(); drawMarkers(c);
      });
      $('#cd-osm').onclick = async (e) => {
        e.target.innerHTML = '<span class="spin"></span> Loading…'; e.target.disabled = true;
        try { await loadLayout(c); } catch (err) { toast(err.message, 4500); }
        render();
      };
      $('#cd-tiles').onclick = () => saveTiles(c);
      $('#cd-addtee').onclick = () => {
        const used = c.tees.map((t) => t.name);
        const p = TEE_PRESETS.find(([n]) => !used.includes(n)) || ['New', '#888888'];
        c.tees.push({ id: uid(), name: p[0], colour: p[1], cr: null, slope: null, yards: [] }); upd(); render();
      };
      const num = (v) => (v === '' ? null : +v);
      $$('[data-tn]').forEach((x) => (x.onchange = () => { const t = c.tees[+x.dataset.tn]; t.name = x.value; const p = TEE_PRESETS.find(([n]) => n.toLowerCase() === x.value.toLowerCase()); if (p) t.colour = p[1]; upd(); }));
      $$('[data-cr]').forEach((x) => (x.onchange = () => { c.tees[+x.dataset.cr].cr = num(x.value); upd(); }));
      $$('[data-sl]').forEach((x) => (x.onchange = () => { c.tees[+x.dataset.sl].slope = num(x.value); upd(); }));
      for (const k of ['cr9f', 'sl9f', 'cr9b', 'sl9b']) {
        const field = { cr9f: 'cr9f', sl9f: 'slope9f', cr9b: 'cr9b', sl9b: 'slope9b' }[k];
        $$(`[data-${k}]`).forEach((x) => (x.onchange = () => { c.tees[+x.dataset[k]][field] = num(x.value); upd(); }));
      }
      $$('[data-tdel]').forEach((x) => (x.onclick = async () => {
        if (c.tees.length === 1) return toast('A course needs at least one tee');
        if (!(await ask('Remove ' + c.tees[+x.dataset.tdel].name + ' tees?', '', 'Remove', true))) return;
        c.tees.splice(+x.dataset.tdel, 1); upd(); render();
      }));
      $$('[data-ts]').forEach((x) => (x.onclick = () => { teeSel = x.dataset.ts; render(); }));
      $$('[data-par]').forEach((x) => (x.onchange = () => { c.holes[+x.dataset.par].par = num(x.value); upd(); }));
      $$('[data-si]').forEach((x) => (x.onchange = () => { c.holes[+x.dataset.si].si = num(x.value); upd(); }));
      $$('[data-yd]').forEach((x) => (x.onchange = () => { (tee.yards ||= [])[+x.dataset.yd] = num(x.value); upd(); }));
      $('#cd-ver').onchange = (e) => { c.verified = e.target.checked; upd(); };
      $('#cd-holes').onchange = async (e) => {
        const n = +e.target.value;
        if (n < c.holes.length && !(await ask('Switch to 9 holes?', 'Holes 10–18 will be removed from this course.', 'Switch', true))) { e.target.value = c.holes.length; return; }
        if (n > c.holes.length) c.holes.push(...blankHoles(n).slice(c.holes.length).map((h, i) => ({ ...h, n: c.holes.length + i + 1 })));
        else c.holes = c.holes.slice(0, n);
        upd(); render();
      };
      $('#cd-del').onclick = async () => {
        const used = state.rounds.some((r) => r.courseId === c.id);
        if (used) return toast('Rounds were played here, so it stays. Delete those rounds first.', 3500);
        if (!(await ask('Delete ' + c.name + '?', '', 'Delete', true))) return;
        state.courses = state.courses.filter((x) => x.id !== c.id); save(); go('#/courses');
      };
    },
    unmount() {
      overview?.remove(); overview = null; ovLayer = null;
      if (location.hash !== '#/course/' + id) { editMap = false; undoStack = []; } // left the page
    },
  };
}

function drawOverview(c) {
  const el = $('#ov-map');
  if (!window.L || !el) return;
  overview = L.map(el, { zoomControl: true, attributionControl: true });
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 19, maxZoom: 20, attribution: 'Imagery © Esri · © OpenStreetMap' }).addTo(overview);
  ovLayer = L.layerGroup().addTo(overview);
  const pts = drawMarkers(c);
  if (pts.length > 1) overview.fitBounds(L.latLngBounds(pts), { padding: [16, 16] });
  else overview.setView(pts[0] || [c.lat, c.lon], 16);
}

function drawMarkers(c) {
  if (!ovLayer) return [];
  ovLayer.clearLayers();
  const pts = [];
  // unassigned green outlines from OpenStreetMap, as tap targets
  const used = new Set(c.holes.map((h) => h.green?.c && JSON.stringify(h.green.c)));
  for (const gr of c.osmGreens || []) {
    if (!used.has(JSON.stringify(gr.c))) L.polygon(gr.poly, { color: '#f2b705', weight: 1.5, dashArray: '3 4', fillOpacity: 0.08 }).addTo(ovLayer);
  }
  c.holes.forEach((h, i) => {
    if (h.line) { L.polyline(h.line, { color: '#fff', weight: 2, opacity: 0.85 }).addTo(ovLayer); pts.push(...h.line); }
    else if (h.tee && h.green?.c) L.polyline([h.tee, h.green.c], { color: '#fff', weight: 2, opacity: 0.7, dashArray: '5 6' }).addTo(ovLayer);
    if (h.green?.poly) L.polygon(h.green.poly, { color: '#ffffff', weight: 1.5, fillOpacity: 0.2 }).addTo(ovLayer);
    if (h.tee) { L.circleMarker(h.tee, { radius: 4, color: '#fff', fillColor: '#2b5ba8', fillOpacity: 1, weight: 1.5 }).addTo(ovLayer); pts.push(h.tee); }
    const g = h.green?.c;
    if (g && (h.line || h.greenSet || h.green.poly)) {
      pts.push(g);
      L.marker(g, { icon: L.divIcon({ className: '', html: `<div class="tgt-label mid" style="font-size:.8rem;padding:0 5px">${i + 1}</div>`, iconSize: null }) }).addTo(ovLayer);
    }
  });
  return pts;
}

function focusHole(c, i) {
  const h = c.holes[i];
  const pts = [h.tee, h.green?.c, ...(h.line || [])].filter(Boolean);
  if (overview && pts.length) overview.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 18 });
}

/* ---------------- offline tiles ---------------- */

function tileXY(lat, lon, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [x, y];
}

async function saveTiles(c) {
  const pts = c.holes.flatMap((h) => [...(h.line || []), ...(h.green?.poly || []), h.green?.c, h.tee].filter(Boolean));
  if (!pts.length) pts.push([c.lat, c.lon]);
  const pad = 0.0025;
  const s = Math.min(...pts.map((p) => p[0])) - pad, n = Math.max(...pts.map((p) => p[0])) + pad;
  const w = Math.min(...pts.map((p) => p[1])) - pad, e = Math.max(...pts.map((p) => p[1])) + pad;
  const urls = [];
  for (let z = 14; z <= 19; z++) {
    const [x0, y0] = tileXY(n, w, z), [x1, y1] = tileXY(s, e, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) urls.push(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`);
  }
  if (urls.length > 2500) return toast('That area is too big to save. Load the hole maps first.');
  const st = $('#tile-status');
  let done = 0, fail = 0;
  const cache = 'caches' in window ? await caches.open('fwb-tiles') : null;
  const queue = [...urls];
  const worker = async () => {
    while (queue.length) {
      const u = queue.shift();
      try {
        if (cache && (await cache.match(u))) { done++; continue; }
        const r = await fetch(u, { mode: 'cors' }).catch(() => fetch(u, { mode: 'no-cors' }));
        if (cache && r) await cache.put(u, r.clone());
        done++;
      } catch { fail++; }
      if (st && (done + fail) % 10 === 0) st.textContent = `Saving map: ${done + fail} / ${urls.length} tiles…`;
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  c.tilesSaved = Date.now(); save();
  if (st) st.textContent = `Map saved for offline (${done} tiles${fail ? `, ${fail} failed` : ''}).`;
  toast('Map saved for offline use');
}
