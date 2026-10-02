import { state, save, uid, player, course, round, roundBundle, toShareCode } from './store.js';
import { $, $$, esc, icon, avatar, toast, sheet, ask, fmtDate, today, hiText, fmt1, scoreMark, toParText, shareText } from './ui.js';
import * as G from './golf.js';
import * as W from './whs.js';
import * as Geo from './geo.js';
import { go, render, editPlayer, editTrip } from './app.js';

const units = () => state.settings.units || 'yd';
const D = (m) => Geo.fmtDist(m, units());

/* ======================= Setup ======================= */

let draft = null;

function newDraft() {
  const last = [...state.rounds].sort((a, b) => (a.created < b.created ? 1 : -1))[0];
  const courseId = last?.courseId && course(last.courseId) ? last.courseId : state.courses[0]?.id || null;
  const c = course(courseId);
  const trip = state.trips.find((t) => t.start <= today() && (!t.end || t.end >= today()));
  const pids = last ? last.players.map((p) => p.playerId).filter((id) => player(id)) : state.players.slice(0, 4).map((p) => p.id);
  return {
    courseId, holesMode: '18', format: state.settings.defaultFormat || 'stableford', allowance: null,
    date: today(), tripId: trip?.id || '', counts: true, pcc: 0,
    players: pids.map((pid, i) => ({ playerId: pid, teeId: c?.tees?.[0]?.id || null, hi: G.playingIndex(pid), team: i % 2 ? 'B' : 'A' })),
  };
}

export function setupView() {
  if (!draft) draft = newDraft();
  return {
    title: 'New round', back: '#/', tab: 'play',
    html: '<div id="setup" class="stack" style="gap:16px"></div>',
    mount() { paintSetup(); },
  };
}

function paintSetup() {
  const el = $('#setup');
  if (!el) return;
  const d = draft;
  const c = course(d.courseId);
  if (c && d.players.some((p) => !c.tees.some((t) => t.id === p.teeId))) d.players.forEach((p) => { if (!c.tees.some((t) => t.id === p.teeId)) p.teeId = c.tees[0]?.id; });
  // Formats that need opponents: fall back to Stableford when playing alone
  const MIN_PLAYERS = { match: 2, skins: 2, bbstable: 2, fourball: 4 };
  if ((MIN_PLAYERS[d.format] || 1) > d.players.length) { d.format = 'stableford'; d.allowance = null; }
  const fmt = W.FORMATS[d.format];
  const allowance = d.allowance ?? fmt.allowance;
  const fakeRound = { ...d, allowance, players: d.players };
  const nine = c && c.holes.length < 18;
  if (nine && d.holesMode === '18') d.holesMode = 'front';

  el.innerHTML = `
  <section class="card">
    <div class="row between"><h2>Course</h2><a class="small" href="#/courses">Find a course</a></div>
    ${state.courses.length ? `<select id="s-course">${state.courses.map((x) => `<option value="${x.id}"${x.id === d.courseId ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`
      : `<div class="empty"><p>No courses saved yet.</p><a class="btn primary" href="#/courses">${icon('search')} Find your course</a></div>`}
    ${c ? `<div class="chips">${[['18', '18 holes'], ['front', 'Front 9'], ['back', 'Back 9']].filter(([k]) => !(nine && k !== 'front')).map(([k, l]) => `<button class="chip${d.holesMode === k ? ' on' : ''}" data-hm="${k}">${l}</button>`).join('')}</div>
      ${c.holes.some((h) => !h.si) ? `<p class="small"><span class="pill warn">Stroke indexes missing</span> Shots can't be given on the right holes until the SI for each hole is entered on the <a href="#/course/${c.id}">course page</a>.</p>` : ''}
      ${c.tees.some((t) => !t.cr || !t.slope) ? `<p class="small"><span class="pill warn">Ratings missing</span> Add the Course Rating and Slope from the scorecard on the <a href="#/course/${c.id}">course page</a> for accurate handicaps.</p>` : ''}
      ${!c.holes.some((h) => h.green?.poly || h.greenSet) ? `<p class="small"><span class="pill warn">No GPS map</span> Load the hole maps on the <a href="#/course/${c.id}">course page</a> while you have signal.</p>` : ''}` : ''}
  </section>

  <section class="card">
    <h2>Format</h2>
    <div class="chips">${Object.entries(W.FORMATS).map(([k, f]) => `<button class="chip${d.format === k ? ' on' : ''}" data-fmt="${k}" ${(MIN_PLAYERS[k] || 1) > d.players.length ? 'disabled style="opacity:.4"' : ''}>${f.label}</button>`).join('')}</div>
    ${d.players.length === 1 ? '<p class="tiny muted">Playing on your own: score it as stroke play or Stableford. It still counts towards your handicap.</p>' : ''}
    <div class="grid2">
      <label class="field">Handicap allowance %<input type="number" id="s-allow" value="${allowance}" min="0" max="100" inputmode="numeric"></label>
      <label class="field">Date<input type="date" id="s-date" value="${d.date}"></label>
    </div>
    <p class="tiny muted">${formatHelp(d.format)}</p>
  </section>

  <section class="card">
    <div class="row between"><h2>Players</h2><button class="btn sm" id="s-addp">${icon('plus')} New player</button></div>
    ${state.players.length ? `<div class="chips">${state.players.map((p) => `<button class="chip${d.players.some((x) => x.playerId === p.id) ? ' on' : ''}" data-pp="${p.id}">${esc(p.name)}</button>`).join('')}</div>` : '<p class="muted">Add yourself and the group.</p>'}
    <div class="list">${d.players.map((rp, i) => {
      const p = player(rp.playerId);
      const hc = c ? G.playerHandicaps(fakeRound, rp, c) : {};
      const base = c ? G.strokesBase(fakeRound, c)[i] : null;
      return `<div class="item" style="flex-wrap:wrap">${avatar(p)}<div class="grow"><b>${esc(p?.name)}</b>
        <p class="small muted">Course hcp ${hc.ch ?? '—'} · plays off <b>${base ?? '—'}</b>${d.format === 'match' || d.format === 'fourball' ? ' (difference)' : ''}</p></div>
        <div class="grid3" style="width:100%;grid-template-columns:${fmt.team ? '1fr 1fr 70px' : '1fr 1fr'}">
          <label class="field">Index<input type="number" step="0.1" inputmode="decimal" data-hi="${i}" value="${rp.hi ?? ''}" placeholder="none"></label>
          <label class="field">Tees<select data-tee="${i}">${(c?.tees || []).map((t) => `<option value="${t.id}"${t.id === rp.teeId ? ' selected' : ''}>${esc(t.name)}${t.cr ? ` ${t.cr}/${t.slope}` : ''}</option>`).join('')}</select></label>
          ${fmt.team ? `<label class="field">Team<select data-team="${i}"><option${rp.team === 'A' ? ' selected' : ''}>A</option><option${rp.team === 'B' ? ' selected' : ''}>B</option></select></label>` : ''}
        </div></div>`;
    }).join('')}</div>
  </section>

  <section class="card">
    <h2>Extras</h2>
    <label class="field">Trip<select id="s-trip"><option value="">None</option>${state.trips.map((t) => `<option value="${t.id}"${t.id === d.tripId ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}<option value="__new">+ New trip…</option></select></label>
    <label class="switch">Counts towards handicaps<input type="checkbox" id="s-counts" ${d.counts ? 'checked' : ''}></label>
    <details><summary class="small">Playing Conditions Calculation (PCC)</summary>
      <p class="tiny muted" style="margin:6px 0">Usually 0. England Golf publishes a daily PCC (−1 to +3) for each course after play when conditions were unusual. You can change it later on the round page.</p>
      <input type="number" id="s-pcc" min="-1" max="3" step="1" value="${d.pcc}"></details>
  </section>

  <button class="btn primary big block" id="s-go" ${!c || !d.players.length ? 'disabled' : ''}>${icon('flag')} Tee off</button>`;

  $('#s-course', el)?.addEventListener('change', (e) => { d.courseId = e.target.value; const cc = course(d.courseId); d.players.forEach((p) => (p.teeId = cc?.tees?.[0]?.id)); paintSetup(); });
  $$('[data-hm]', el).forEach((b) => (b.onclick = () => { d.holesMode = b.dataset.hm; paintSetup(); }));
  $$('[data-fmt]', el).forEach((b) => (b.onclick = () => { d.format = b.dataset.fmt; d.allowance = null; state.settings.defaultFormat = d.format; paintSetup(); }));
  $('#s-allow', el).onchange = (e) => { d.allowance = +e.target.value; paintSetup(); };
  $('#s-date', el).onchange = (e) => { d.date = e.target.value; };
  $$('[data-pp]', el).forEach((b) => (b.onclick = () => {
    const id = b.dataset.pp;
    const i = d.players.findIndex((x) => x.playerId === id);
    if (i >= 0) d.players.splice(i, 1);
    else d.players.push({ playerId: id, teeId: c?.tees?.[0]?.id, hi: G.playingIndex(id), team: d.players.length % 2 ? 'B' : 'A' });
    paintSetup();
  }));
  $$('[data-hi]', el).forEach((inp) => (inp.onchange = () => { d.players[+inp.dataset.hi].hi = inp.value === '' ? null : +inp.value; paintSetup(); }));
  $$('[data-tee]', el).forEach((s) => (s.onchange = () => { d.players[+s.dataset.tee].teeId = s.value; paintSetup(); }));
  $$('[data-team]', el).forEach((s) => (s.onchange = () => { d.players[+s.dataset.team].team = s.value; paintSetup(); }));
  $('#s-addp', el).onclick = () => editPlayer(null, (p) => { d.players.push({ playerId: p.id, teeId: c?.tees?.[0]?.id, hi: G.playingIndex(p.id), team: 'A' }); paintSetup(); });
  $('#s-trip', el).onchange = (e) => {
    if (e.target.value === '__new') editTrip(null, (t) => { d.tripId = t.id; paintSetup(); });
    else d.tripId = e.target.value;
  };
  $('#s-counts', el).onchange = (e) => { d.counts = e.target.checked; };
  $('#s-pcc', el).onchange = (e) => { d.pcc = +e.target.value || 0; };
  $('#s-go', el).onclick = startRound;
}

function formatHelp(f) {
  return {
    stableford: 'Points per hole against your net score: 2 for net par, 3 for net birdie, 1 for net bogey. Highest total wins.',
    stroke: 'Lowest net score wins. Gross totals are shown too.',
    bbstable: 'Pairs (team A vs team B). On each hole the better Stableford score of the pair counts.',
    match: 'Hole-by-hole between the first two players. The higher handicap gets the full difference in strokes.',
    fourball: 'Team A vs team B, best net ball wins each hole. Strokes off the lowest player at 90%.',
    skins: 'Win a hole outright on net score to take the skin. Halved holes carry over.',
  }[f];
}

function startRound() {
  const d = draft;
  const c = course(d.courseId);
  const r = {
    id: uid(), created: Date.now(), updated: Date.now(), date: d.date, courseId: d.courseId, holesMode: d.holesMode,
    format: d.format, allowance: d.allowance ?? W.FORMATS[d.format].allowance, tripId: d.tripId || null,
    countsForHandicap: d.counts && c.tees.some((t) => t.cr && t.slope), pcc: d.pcc || 0, status: 'live', currentHole: 0, notes: '',
    players: d.players.map((p) => ({ ...p, scores: Array.from({ length: c.holes.length }, () => ({})) })),
    shots: [], side: {},
  };
  state.rounds.push(r);
  save();
  draft = null;
  tab = 'score';
  go('#/round/' + r.id);
}

/* ======================= Live round ======================= */

let tab = 'score';
let map = null;
let unsubGps = null;
let target = null;
let shotPid = null;
let shotClub = null;

export function liveView(id) {
  const r = round(id);
  if (!r) return { html: '<div class="empty">Round not found.</div>', back: '#/' };
  if (r.status === 'done') return { html: '', mount: () => go('#/r/' + id) };
  const c = course(r.courseId);
  shotPid ||= state.settings.meId && r.players.some((p) => p.playerId === state.settings.meId) ? state.settings.meId : r.players[0]?.playerId;
  return {
    title: c?.name || 'Round', back: '#/', tab: 'play',
    actions: `<button id="r-menu" aria-label="Round options">${icon('more')}</button>`,
    html: `<div class="holebar"><div class="holes" id="holes"></div>
      <div class="seg" role="tablist"><button data-tab="score">Score</button><button data-tab="gps">GPS</button><button data-tab="board">Leaderboard</button></div></div>
      <div id="pane" class="stack" style="gap:16px"></div>`,
    mount() {
      Geo.startGps();
      if (state.settings.keepAwake) Geo.keepAwake(true);
      unsubGps = Geo.onFix(() => { if (tab === 'gps') updateGps(r); });
      $$('.seg button').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; paint(r); }));
      $('#r-menu').onclick = () => roundMenu(r);
      paint(r);
    },
    unmount() {
      unsubGps?.(); unsubGps = null;
      destroyMap();
      Geo.keepAwake(false);
      Geo.stopGps();
    },
  };
}

function destroyMap() { if (map) { map.remove(); map = null; } target = null; }

function holesOf(r) { return G.roundHoles(r); }

function paint(r) {
  const holes = holesOf(r);
  const k = Math.min(r.currentHole ?? 0, holes.length - 1);
  $('#holes').innerHTML = holes.map((h, j) => {
    const done = r.players.every((p) => p.scores[h.i]?.g);
    return `<button class="${j === k ? 'on' : ''} ${done ? 'done' : ''}" data-h="${j}" aria-label="Hole ${h.n}">${h.n}</button>`;
  }).join('');
  $$('#holes button').forEach((b) => (b.onclick = () => { r.currentHole = +b.dataset.h; save(); paint(r); }));
  $('#holes .on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  $$('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  destroyMap();
  const pane = $('#pane');
  if (tab === 'score') paintScore(r, pane, holes, k);
  else if (tab === 'gps') paintGps(r, pane, holes, k);
  else paintBoard(r, pane);
}

function teeYards(c, r, h) {
  const t = G.teeOf(c, r.players[0]?.teeId);
  const y = t?.yards?.[h.i];
  if (y) return units() === 'yd' ? y : Math.round(y / Geo.M_TO_YD);
  return h.lengthM ? D(h.lengthM) : null;
}

function paintScore(r, pane, holes, k) {
  const c = course(r.courseId);
  const h = holes[k];
  const strokes = G.strokeMap(r, c);
  const rows = G.leaderboard(r);
  const yards = teeYards(c, r, h);
  pane.innerHTML = `
    <div class="holehead">
      <div class="no">${h.n}</div>
      <div class="meta"><div><b>${h.par}</b><span>Par</span></div><div><b>${h.si ?? '–'}</b><span>SI</span></div>${yards ? `<div><b>${yards}</b><span>${units()}</span></div>` : ''}</div>
      <div class="grow"></div><button class="chip${state.settings.trackStats === false ? '' : ' on'}" id="stats-tog" title="Log putts, fairways, bunkers and penalties">Stats</button>
    </div>
    <section class="card">${r.players.map((rp, pi) => playerBlock(r, rp, pi, h, k, strokes[pi][k], rows[pi])).join('')}</section>
    <div class="btns">
      ${k > 0 ? `<button class="btn" id="prev">${icon('back')} Hole ${holes[k - 1].n}</button>` : ''}
      ${k < holes.length - 1 ? `<button class="btn primary" id="next">Hole ${holes[k + 1].n} →</button>` : `<button class="btn flag" id="finish">${icon('check')} Finish round</button>`}
    </div>`;

  $$('[data-step]', pane).forEach((b) => (b.onclick = () => {
    const [pi, dir] = b.dataset.step.split(':').map(Number);
    const e = r.players[pi].scores[h.i] ||= {};
    if (!e.g) e.g = dir > 0 ? h.par : Math.max(1, h.par - 1);
    else e.g = Math.max(1, Math.min(15, e.g + dir));
    e.pu = false;
    if (navigator.vibrate) navigator.vibrate(8);
    touch(r); paintScore(r, pane, holes, k); refreshHoleDots(r, holes);
    maybeAdvance(r, holes, k, pane);
  }));
  $$('[data-clear]', pane).forEach((b) => (b.onclick = () => { r.players[+b.dataset.clear].scores[h.i] = {}; touch(r); paintScore(r, pane, holes, k); refreshHoleDots(r, holes); }));
  $$('[data-pu]', pane).forEach((b) => (b.onclick = () => {
    const pi = +b.dataset.pu; const e = r.players[pi].scores[h.i] ||= {};
    e.pu = !e.pu;
    e.g = e.pu ? W.netDoubleBogey(h.par, strokes[pi][k]) : null;
    touch(r); paintScore(r, pane, holes, k); refreshHoleDots(r, holes);
  }));
  $$('[data-putt]', pane).forEach((b) => (b.onclick = () => {
    const [pi, dir] = b.dataset.putt.split(':').map(Number);
    const e = r.players[pi].scores[h.i] ||= {};
    e.putts = Math.max(0, Math.min(6, (e.putts ?? (dir > 0 ? 1 : 2)) + dir));
    touch(r); paintScore(r, pane, holes, k);
  }));
  $$('[data-pen]', pane).forEach((b) => (b.onclick = () => {
    const [pi, dir] = b.dataset.pen.split(':').map(Number);
    const e = r.players[pi].scores[h.i] ||= {};
    e.pen = Math.max(0, Math.min(6, (e.pen || 0) + dir));
    touch(r); paintScore(r, pane, holes, k);
  }));
  $$('[data-fir]', pane).forEach((b) => (b.onclick = () => {
    const [pi, v] = b.dataset.fir.split(':');
    const e = r.players[+pi].scores[h.i] ||= {};
    e.fir = e.fir === v ? null : v;
    touch(r); paintScore(r, pane, holes, k);
  }));
  $$('[data-sand]', pane).forEach((b) => (b.onclick = () => {
    const e = r.players[+b.dataset.sand].scores[h.i] ||= {};
    e.sand = !e.sand; touch(r); paintScore(r, pane, holes, k);
  }));
  $('#stats-tog', pane).onclick = () => { state.settings.trackStats = state.settings.trackStats === false; save(); paintScore(r, pane, holes, k); };
  $('#prev', pane)?.addEventListener('click', () => { r.currentHole = k - 1; save(); paint(r); });
  $('#next', pane)?.addEventListener('click', () => { r.currentHole = k + 1; save(); paint(r); });
  $('#finish', pane)?.addEventListener('click', () => finishRound(r));
}

function refreshHoleDots(r, holes) {
  $$('#holes button').forEach((b, j) => b.classList.toggle('done', r.players.every((p) => p.scores[holes[j].i]?.g)));
}

let advTimer = null;
function maybeAdvance(r, holes, k) {
  clearTimeout(advTimer);
  if (!state.settings.autoAdvance || k >= holes.length - 1) return;
  if (!r.players.every((p) => p.scores[holes[k].i]?.g)) return;
  advTimer = setTimeout(() => {
    if (location.hash !== '#/round/' + r.id || tab !== 'score' || (r.currentHole ?? 0) !== k) return;
    r.currentHole = k + 1; save(); paint(r);
    toast(`Hole ${holes[k + 1].n}`, 1200);
  }, 2600);
}

function touch(r) { r.updated = Date.now(); save(); }

function scoreName(g, par) {
  if (!g) return '';
  const d = g - par;
  if (g === 1) return 'Hole in one!';
  return { '-3': 'Albatross', '-2': 'Eagle', '-1': 'Birdie', 0: 'Par', 1: 'Bogey', 2: 'Double' }[d] || (d > 2 ? `+${d}` : 'Condor');
}

function playerBlock(r, rp, pi, h, k, recv, row) {
  const p = player(rp.playerId);
  const e = rp.scores[h.i] || {};
  const pts = e.g ? W.stablefordPoints(e.g, h.par, recv) : null;
  const dots = recv > 0 ? `<span class="dots" title="${recv} shot${recv > 1 ? 's' : ''}">${'<i></i>'.repeat(Math.min(recv, 4))}</span>` : recv < 0 ? '<span class="dots" title="gives a shot back"><i class="minus"></i></span>' : '';
  const running = r.format === 'stroke' ? `${row.thru ? toParText(row.netToPar) + ' net' : ''}` : `${row.pts} pts`;
  const showFir = h.par >= 4;
  return `<div class="pscore">
    <div class="who">${avatar(p, true)}<span class="name ellip">${esc(p?.name || '?')} ${dots}</span><span class="small muted num">${running}${row.thru ? ` · thru ${row.thru}` : ''}</span>${e.g ? `<button class="btn sm ghost" data-clear="${pi}" aria-label="Clear score" style="min-height:30px;padding:2px 8px">Clear</button>` : ''}</div>
    <div class="stepper">
      <button data-step="${pi}:-1" aria-label="One fewer">−</button>
      <div class="val ${e.g ? '' : 'empty'}">${e.pu ? 'P/U' : e.g || 'Tap +'}<small>${e.g ? (e.pu ? 'picked up · 0 pts' : `${scoreName(e.g, h.par)}${pts != null && r.format !== 'stroke' ? ` · ${pts} pt${pts === 1 ? '' : 's'}` : ''}`) : `par ${h.par}${recv ? ` · net ${h.par + recv}` : ''}`}</small></div>
      <button data-step="${pi}:1" aria-label="One more">+</button>
    </div>
    <div class="extras">${state.settings.trackStats === false ? `<button class="chip tog${e.pu ? ' on' : ''}" data-pu="${pi}" title="Picked up: scores net double bogey, 0 points">Picked up</button></div></div>` : `
      <span class="mini"><span class="lbl">Putts</span><button data-putt="${pi}:-1" aria-label="Fewer putts">−</button><span>${e.putts ?? '–'}</span><button data-putt="${pi}:1" aria-label="More putts">+</button></span>
      ${showFir ? `<span class="mini fir"><span class="lbl">Fwy</span>${[['left', '←'], ['hit', '✓'], ['right', '→']].map(([v, l]) => `<button class="${e.fir === v ? 'on' : ''}" data-fir="${pi}:${v}" aria-label="Fairway ${v}">${l}</button>`).join('')}</span>` : ''}
      <button class="chip tog${e.sand ? ' on' : ''}" data-sand="${pi}">Bunker</button>
      <span class="mini"><span class="lbl">Pen</span><button data-pen="${pi}:-1" aria-label="Fewer penalties">−</button><span>${e.pen || 0}</span><button data-pen="${pi}:1" aria-label="More penalties">+</button></span>
      <button class="chip tog${e.pu ? ' on' : ''}" data-pu="${pi}" title="Picked up: scores net double bogey, 0 points">P/U</button>
    </div></div>`}`;
}

/* ---------- GPS tab ---------- */

function paintGps(r, pane, holes, k) {
  const c = course(r.courseId);
  const h = holes[k];
  const hasGreen = !!(h.green?.c && (h.green.poly || h.greenSet || h.line));
  pane.innerHTML = `
    <div class="holehead"><div class="no">${h.n}</div><div class="meta"><div><b>${h.par}</b><span>Par</span></div><div><b>${h.si ?? '–'}</b><span>SI</span></div></div>
      <div class="grow"></div><button class="btn sm" id="caddie">${icon('expand')} Caddie mode</button></div>
    <section class="card">
      <div class="yard"><div class="f"><span>Front</span><b id="y-f">—</b></div><div class="c"><span>Centre</span><b id="y-c">—</b></div><div class="b"><span>Back</span><b id="y-b">—</b></div></div>
      <div class="gpsline" id="gps-status"><span class="gpsdot"></span> Finding you…</div>
      <div id="hole-hint"></div>
      ${hasGreen ? '' : `<p class="small"><span class="pill warn">No green mapped for this hole</span> Stand in the middle of the green and tap <b>Green is here</b>, or load the course map from OpenStreetMap.</p>`}
    </section>
    <section class="card" id="wind-card" hidden></section>
    <section class="card" id="haz-card" ${h.hazards?.length ? '' : 'hidden'}><h3>Hazards</h3><div class="haz" id="haz"></div></section>
    <div class="map tall" id="map"></div>
    <p class="tiny muted">Tap the map to measure to any spot. The label shows distance from you, then from that spot to the green centre.</p>
    <section class="card">
      <div class="row between"><h3>Track your shots</h3>${r.players.length > 1 ? `<select id="shot-p" style="width:auto;min-height:36px;padding:4px 8px">${r.players.map((rp) => `<option value="${rp.playerId}"${rp.playerId === shotPid ? ' selected' : ''}>${esc(player(rp.playerId)?.name)}</option>`).join('')}</select>` : ''}</div>
      <div class="clubs" id="clubs">${G.CLUBS.filter((x) => x !== 'Pt').map((cl) => `<button class="${cl === shotClub ? 'on' : ''}" data-club="${cl}">${cl}</button>`).join('')}</div>
      <div class="btns"><button class="btn primary" id="mark">${icon('pin')} Mark ball here</button><button class="btn" id="ongreen">On the green</button></div>
      <p class="small muted" id="shot-info">Pick the club, then tap Mark ball where you hit from. The next mark measures the shot.</p>
    </section>
    <details class="card flat"><summary>Fix this hole's map</summary>
      <div class="stack" style="margin-top:10px"><p class="small muted">Standing in the right place? Save your position for this hole. It is saved to the course for next time.</p>
      <div class="btns"><button class="btn" id="set-green">${icon('flag')} Green is here</button><button class="btn" id="set-tee">${icon('pin')} Tee is here</button></div>
      <a class="btn ghost" href="#/course/${c.id}">${icon('layers')} Load maps from OpenStreetMap</a></div></details>`;

  $('#caddie').onclick = () => caddieMode(r, holes, k);
  $('#shot-p')?.addEventListener('change', (e) => { shotPid = e.target.value; });
  $$('[data-club]', pane).forEach((b) => (b.onclick = () => { shotClub = shotClub === b.dataset.club ? null : b.dataset.club; $$('[data-club]', pane).forEach((x) => x.classList.toggle('on', x.dataset.club === shotClub)); }));
  $('#mark').onclick = () => markShot(r, h, false);
  $('#ongreen').onclick = () => markShot(r, h, true);
  $('#set-green').onclick = () => setHolePoint(r, h, 'green');
  $('#set-tee').onclick = () => setHolePoint(r, h, 'tee');
  initMap(r, h);
  updateGps(r);
  windCard(r, h);
}

function holeBearing(h) {
  const a = h.tee || h.line?.[0];
  const b = h.green?.c;
  return a && b ? Geo.bearing(a, b) : null;
}

let wxCache = null;
async function windCard(r, h) {
  const card = $('#wind-card');
  if (!card || !navigator.onLine) return;
  try {
    const c = course(r.courseId);
    if (!wxCache || Date.now() - wxCache.t > 15 * 60e3) wxCache = { t: Date.now(), w: await Geo.fetchWeather([c.lat, c.lon]) };
    const cur = wxCache.w.current;
    r.weather ||= { temp: cur.temperature_2m, wind: cur.wind_speed_10m, dir: cur.wind_direction_10m, code: cur.weather_code };
    const hb = holeBearing(h);
    // wind_direction is where it blows FROM; arrow shows where it blows TO, relative to the hole (up = towards green)
    const to = (cur.wind_direction_10m + 180) % 360;
    const rel = hb == null ? to : (to - hb + 360) % 360;
    const along = Math.cos((rel * Math.PI) / 180);
    const across = Math.sin((rel * Math.PI) / 180);
    const feel = cur.wind_speed_10m < 5 ? 'Barely any wind' : along > 0.5 ? 'Helping wind' : along < -0.5 ? 'Into the wind' : across > 0 ? 'Left-to-right wind' : 'Right-to-left wind';
    card.hidden = false;
    card.innerHTML = `<div class="wind"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="none" stroke="var(--line)" stroke-width="2"/><g transform="rotate(${rel} 20 20)"><path d="M20 7 L26 18 H22 V32 H18 V18 H14 Z" fill="var(--accent)"/></g></svg>
      <div class="grow"><b>${feel}${hb == null ? '' : ' on this hole'}</b><p class="small muted">${Math.round(cur.wind_speed_10m)} mph from the ${Geo.compass(cur.wind_direction_10m)}, gusts ${Math.round(cur.wind_gusts_10m)} · ${Geo.WMO(cur.weather_code)}, ${Math.round(cur.temperature_2m)}°C</p></div></div>
      ${hb == null ? '' : '<p class="tiny muted">Arrow points the way the wind blows; up is towards the green.</p>'}`;
  } catch { /* offline */ }
}

function initMap(r, h) {
  if (!window.L) { $('#map').innerHTML = '<div class="empty">Map unavailable offline</div>'; return; }
  const el = $('#map');
  map = L.map(el, { zoomControl: false, attributionControl: true, tap: true });
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxNativeZoom: 19, maxZoom: 21, attribution: 'Imagery © Esri · Map data © OpenStreetMap',
  }).addTo(map);
  const pts = [];
  if (h.line) { L.polyline(h.line, { color: '#ffffff', weight: 2, dashArray: '6 6', opacity: 0.8 }).addTo(map); pts.push(...h.line); }
  if (h.green?.poly) { L.polygon(h.green.poly, { color: '#7dffb0', weight: 2, fillOpacity: 0.15 }).addTo(map); pts.push(...h.green.poly); }
  if (h.green?.c) { L.circleMarker(h.green.c, { radius: 5, color: '#fff', fillColor: '#f2b705', fillOpacity: 1, weight: 2 }).addTo(map); pts.push(h.green.c); }
  if (h.tee) { L.circleMarker(h.tee, { radius: 5, color: '#fff', fillColor: '#2b5ba8', fillOpacity: 1, weight: 2 }).addTo(map); pts.push(h.tee); }
  for (const z of h.hazards || []) L.polygon(z.poly, { color: z.type === 'water' ? '#4aa3ff' : '#f5e6b0', weight: 1.5, fillOpacity: 0.1 }).addTo(map);
  if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [24, 24], maxZoom: 18 });
  else { const c = course(r.courseId); map.setView(pts[0] || [c.lat, c.lon], 17); }
  map._pts = pts;
  map._me = null; map._tgt = null; map._lines = null;
  map.on('click', (e) => { target = [e.latlng.lat, e.latlng.lng]; drawTarget(h); });
}

function drawTarget(h) {
  if (!map) return;
  const here = Geo.lastFix?.ll;
  map._tgt?.remove(); map._lines?.remove();
  if (!target) return;
  const toGreen = h.green?.c ? Geo.dist(target, h.green.c) : null;
  const fromMe = here ? Geo.dist(here, target) : null;
  const label = `${fromMe != null ? D(fromMe) : '?'} · ${toGreen != null ? D(toGreen) : '?'}`;
  map._tgt = L.marker(target, { icon: L.divIcon({ className: '', html: `<div class="tgt-label lift">${label}</div>`, iconSize: null }) }).addTo(map);
  const line = [here, target, h.green?.c].filter(Boolean);
  map._lines = L.polyline(line, { color: '#f2b705', weight: 2.5 }).addTo(map);
}

function updateGps(r) {
  const fix = Geo.lastFix;
  const st = $('#gps-status');
  if (!st) return;
  const holes = holesOf(r);
  const h = holes[Math.min(r.currentHole ?? 0, holes.length - 1)];
  if (!fix || (!fix.ll && fix.error)) {
    st.innerHTML = `<span class="gpsdot"></span> ${fix?.error ? 'GPS: ' + esc(fix.error) + '. Allow location for this site.' : 'Finding you…'}`;
    return;
  }
  const acc = Math.round(units() === 'yd' ? fix.acc * Geo.M_TO_YD : fix.acc);
  st.innerHTML = `<span class="gpsdot ${fix.acc < 12 ? 'ok' : 'weak'}"></span> GPS ±${acc} ${units()}${fix.error ? ' · ' + esc(fix.error) : ''}`;
  const here = fix.ll;
  const c = h.green?.c ? Geo.dist(here, h.green.c) : null;
  let fb = Geo.frontBack(here, h.green);
  // Green outline unknown: estimate from a typical 28 m deep green
  const est = fb.front == null && c != null;
  if (est) fb = { front: Math.max(0, c - 14), back: c + 14 };
  const fmtFB = (v) => (v == null ? '—' : (est ? '≈' : '') + D(v));
  $('#y-c').textContent = D(c);
  $('#y-f').textContent = fmtFB(fb.front);
  $('#y-b').textContent = fmtFB(fb.back);
  const cad = $('#cad-c');
  if (cad) { cad.textContent = D(c); $('#cad-f').textContent = fmtFB(fb.front); $('#cad-b').textContent = fmtFB(fb.back); }
  // hazards
  const hz = $('#haz');
  if (hz && h.hazards?.length) {
    const list = h.hazards.map((z) => ({ ...z, ...Geo.reachCarry(here, z.poly) })).filter((z) => z.carry > 15).sort((a, b) => a.reach - b.reach);
    hz.innerHTML = list.length ? '<span></span><span class="tiny muted"></span><span class="tiny muted" style="text-align:right">Reach</span><span class="tiny muted" style="text-align:right">Carry</span>' + list.map((z) => `<span class="sw ${z.type}"></span><span class="t">${z.type === 'water' ? 'Water' : 'Bunker'}</span><span class="n">${D(z.reach)}</span><span class="n">${D(z.carry)}</span>`).join('')
      : '<span></span><span class="small muted">All hazards behind you.</span>';
  }
  // map
  if (map && window.L) {
    // first fix: frame the view from the player to the green
    if (!map._fitted && h.green?.c && Geo.dist(here, h.green.c) < 700) {
      map.fitBounds(L.latLngBounds([here, h.green.c, ...(map._pts || [])]), { padding: [30, 30], maxZoom: 18 });
      map._fitted = true;
    }
    if (!map._me) map._me = L.marker(here, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(map);
    else map._me.setLatLng(here);
    if (target) drawTarget(h);
  }
  // hole hint
  const near = Geo.nearestHole(holes.filter((x) => x.line), here);
  const hint = $('#hole-hint');
  if (hint) {
    if (near && near.n !== h.n && Geo.dist(here, near.tee || near.line[0]) < 50) {
      hint.innerHTML = `<button class="chip" id="jump">You look to be on the ${near.n} tee. Switch?</button>`;
      $('#jump').onclick = () => { r.currentHole = holes.findIndex((x) => x.n === near.n); save(); paint(r); };
    } else hint.innerHTML = '';
  }
  // last shot readout
  const info = $('#shot-info');
  const last = [...(r.shots || [])].reverse().find((s) => s.pid === shotPid && s.hole === h.i);
  if (info && last) info.innerHTML = `Last mark ${last.club ? `(${esc(last.club)})` : ''}: <b>${D(Geo.dist(last.ll, here))} ${units()}</b> from here.`;
}

async function markShot(r, h, onGreen) {
  try {
    const fix = await Geo.getOnce();
    r.shots ||= [];
    const prev = [...r.shots].reverse().find((s) => s.pid === shotPid && s.hole === h.i);
    if (onGreen) {
      if (prev) { prev.toGreen = true; touch(r); toast(`${prev.club || 'Shot'}: ${D(Geo.dist(prev.ll, fix.ll))} ${units()} onto the green`); }
      else toast('Nothing marked on this hole yet');
      return;
    }
    r.shots.push({ pid: shotPid, hole: h.i, ll: fix.ll, club: shotClub, t: Date.now(), acc: Math.round(fix.acc) });
    touch(r);
    toast(prev ? `${prev.club || 'Last shot'} went ${D(Geo.dist(prev.ll, fix.ll))} ${units()}` : 'Marked. Hit it, then mark where it finished.');
    shotClub = null;
    $$('[data-club]').forEach((x) => x.classList.remove('on'));
    updateGps(r);
  } catch (e) { toast('No GPS fix: ' + e.message); }
}

async function setHolePoint(r, h, which) {
  try {
    const fix = await Geo.getOnce();
    if (fix.acc > 25 && !(await ask('GPS is only accurate to ' + Math.round(fix.acc) + ' m', 'Save this position anyway?', 'Save'))) return;
    const c = course(r.courseId);
    const ch = c.holes[h.i];
    if (which === 'green') { ch.green = { ...(ch.green || {}), c: fix.ll, greenSet: true }; ch.greenSet = true; }
    else { ch.tee = fix.ll; }
    if (ch.tee && ch.green?.c && !ch.line) ch.lengthM = Math.round(Geo.dist(ch.tee, ch.green.c));
    c.updated = Date.now();
    save();
    toast(which === 'green' ? `Green saved for hole ${h.n}` : `Tee saved for hole ${h.n}`);
    paint(r);
  } catch (e) { toast('No GPS fix: ' + e.message); }
}

function caddieMode(r, holes, k) {
  const h = holes[k];
  const div = document.createElement('div');
  div.className = 'caddie';
  div.innerHTML = `<button id="cad-x">Close</button><div class="h">Hole ${h.n} · Par ${h.par}</div><div class="c" id="cad-c">—</div>
    <div class="fb"><div><span>FRONT</span><b id="cad-f">—</b></div><div><span>BACK</span><b id="cad-b">—</b></div></div><div class="h" style="font-size:1rem">${units() === 'yd' ? 'yards' : 'metres'} to the green</div>`;
  document.body.appendChild(div);
  div.querySelector('#cad-x').onclick = () => div.remove();
  try { div.requestFullscreen?.(); } catch { /* optional */ }
  updateGps(r);
}

/* ---------- Board ---------- */

function paintBoard(r, pane) {
  pane.innerHTML = boardHtml(r) + `<button class="btn flag big block" id="finish">${icon('check')} Finish round</button>`;
  $('#finish').onclick = () => finishRound(r);
}

export function boardHtml(r, { summary = false } = {}) {
  const c = course(r.courseId);
  const rows = G.sortRows(G.leaderboard(r), r.format);
  const isPts = r.format !== 'stroke';
  let extra = '';
  if (r.format === 'match' && r.players.length >= 2) {
    const m = G.matchStatus(r, 0, 1);
    const lead = m.up > 0 ? player(r.players[0].playerId) : m.up < 0 ? player(r.players[1].playerId) : null;
    extra = `<section class="card"><span class="eyebrow">Match play</span><h2>${lead ? `${esc(lead.name)} ${m.done ? 'wins' : ''} ${m.text}` : m.text}</h2><p class="small muted">${esc(player(r.players[0].playerId)?.name)} v ${esc(player(r.players[1].playerId)?.name)} · ${m.played} played${m.done ? '' : `, ${m.left} to play`}</p></section>`;
  }
  if (r.format === 'bbstable' || r.format === 'fourball') {
    const t = G.teamBetterBall(r);
    const names = (k) => (t.teams[k]?.members || []).map((pi) => esc(player(r.players[pi].playerId)?.name)).join(' & ');
    extra = `<section class="card"><span class="eyebrow">${r.format === 'fourball' ? 'Four-ball match' : 'Better-ball Stableford'}</span>
      ${r.format === 'fourball' ? `<h2>${t.up === 0 ? 'All square' : `${t.up > 0 ? names('A') : names('B')} ${Math.abs(t.up)} up`}</h2>` : ''}
      <div class="lb">${Object.entries(t.teams).sort((a, b) => b[1].pts - a[1].pts).map(([k, tm], i) => `<div class="r" style="grid-template-columns:26px 1fr auto"><span class="pos">${k}</span><b>${names(k)}</b><span class="main">${tm.pts}</span></div>`).join('')}</div></section>`;
  }
  if (r.format === 'skins') {
    const s = G.skins(r);
    extra = `<section class="card"><span class="eyebrow">Skins</span><div class="lb">${r.players.map((rp, i) => ({ rp, n: s.won[i] })).sort((a, b) => b.n - a.n).map((x) => `<div class="r" style="grid-template-columns:36px 1fr auto">${avatar(player(x.rp.playerId))}<b>${esc(player(x.rp.playerId)?.name)}</b><span class="main">${x.n}</span></div>`).join('')}</div>
      ${s.carry ? `<p class="small muted">${s.carry} skin${s.carry > 1 ? 's' : ''} carrying over.</p>` : ''}</section>`;
  }
  const lb = `<section class="card"><div class="row between"><span class="eyebrow">${esc(W.FORMATS[r.format]?.label)} · ${r.allowance}%</span>${summary ? '' : '<span class="pill live">Live</span>'}</div>
    <div class="lb">${rows.map((x, i) => `<div class="r"><span class="pos">${x.thru ? i + 1 : '–'}</span>${avatar(x.player)}<div class="stack" style="gap:0;min-width:0"><b class="ellip">${esc(x.player?.name || '?')}</b><span class="tiny muted">plays off ${x.ph ?? '—'}${x.thru && x.thru < G.roundHoles(r, c).length ? ` · thru ${x.thru}` : ''}</span></div>
      <span class="sub">${x.gross ? `${x.gross} gross<br>${toParText(x.toPar)}` : ''}</span><span class="main">${isPts ? x.pts : x.thru ? toParText(x.netToPar) : '–'}</span></div>`).join('')}</div></section>`;
  return extra + lb + scorecardHtml(r);
}

export function scorecardHtml(r) {
  const c = course(r.courseId);
  const holes = G.roundHoles(r, c);
  const strokes = G.strokeMap(r, c);
  const split = holes.length === 18;
  const seg = (a, b) => holes.slice(a, b);
  const parts = split ? [[0, 9, 'Out'], [9, 18, 'In']] : [[0, holes.length, 'Tot']];
  const head = parts.map(([a, b, l]) => seg(a, b).map((h) => `<th>${h.n}</th>`).join('') + `<th>${l}</th>`).join('') + (split ? '<th>Tot</th>' : '') + '<th>Pts</th>';
  const parRow = parts.map(([a, b]) => seg(a, b).map((h) => `<td>${h.par}</td>`).join('') + `<td class="tot">${seg(a, b).reduce((s, h) => s + h.par, 0)}</td>`).join('') + (split ? `<td class="tot">${holes.reduce((s, h) => s + h.par, 0)}</td>` : '') + '<td></td>';
  const siRow = parts.map(([a, b]) => seg(a, b).map((h) => `<td>${h.si ?? ''}</td>`).join('') + '<td></td>').join('') + (split ? '<td></td>' : '') + '<td></td>';
  const body = r.players.map((rp, pi) => {
    let pts = 0;
    const cells = parts.map(([a, b]) => {
      let t = 0;
      const tds = seg(a, b).map((h, j) => {
        const g = rp.scores[h.i]?.g; if (g) { t += g; pts += W.stablefordPoints(g, h.par, strokes[pi][a + j]); }
        return `<td>${scoreMark(g, h.par)}</td>`;
      }).join('');
      return { tds, t };
    });
    const tot = cells.reduce((s, x) => s + x.t, 0);
    return `<tr><td class="nm">${esc(player(rp.playerId)?.name || '?')}</td>${cells.map((x) => x.tds + `<td class="tot">${x.t || ''}</td>`).join('')}${split ? `<td class="tot">${tot || ''}</td>` : ''}<td class="tot">${pts}</td></tr>`;
  }).join('');
  return `<section class="card"><span class="eyebrow">Scorecard</span><div class="sc-wrap"><table class="sc"><thead><tr><th class="nm">Hole</th>${head}</tr></thead>
    <tbody><tr class="par"><td class="nm">Par</td>${parRow}</tr><tr class="par"><td class="nm">SI</td>${siRow}</tr>${body}</tbody></table></div>
    <p class="tiny muted">Circled = under par, boxed = over par.</p></section>`;
}

async function finishRound(r) {
  const holes = holesOf(r);
  const missing = r.players.map((rp) => holes.filter((h) => !rp.scores[h.i]?.g).length);
  const anyMissing = missing.some((m) => m > 0);
  if (!(await ask('Finish the round?', anyMissing ? 'Some holes have no score. They will count as net par for handicaps (14+ holes needed for an 18-hole score) and 0 Stableford points.' : 'Scores will be saved to everyone\'s history and handicaps.', 'Finish'))) return;
  r.status = 'done'; r.finished = Date.now(); touch(r);
  go('#/r/' + r.id);
}

function roundMenu(r) {
  sheet(`<h2>Round options</h2>
    <div class="list">
      <button class="item btn ghost" id="rm-hcp" style="justify-content:flex-start">${icon('hcp')} Change handicaps, tees or allowance</button>
      <button class="item btn ghost" id="rm-share" style="justify-content:flex-start">${icon('share')} Share the live leaderboard</button>
      <button class="item btn ghost" id="rm-finish" style="justify-content:flex-start">${icon('check')} Finish round</button>
      <button class="item btn ghost danger" id="rm-del" style="justify-content:flex-start">${icon('trash')} Abandon and delete round</button>
    </div>`, (el, close) => {
    $('#rm-finish', el).onclick = () => { close(); finishRound(r); };
    $('#rm-share', el).onclick = () => { close(); shareText(resultText(r)); };
    $('#rm-hcp', el).onclick = () => { close(); editHandicaps(r); };
    $('#rm-del', el).onclick = async () => {
      close();
      if (!(await ask('Delete this round?', 'All scores in it will be lost.', 'Delete', true))) return;
      state.rounds = state.rounds.filter((x) => x.id !== r.id); save(); go('#/');
    };
  });
}

function editHandicaps(r) {
  const c = course(r.courseId);
  sheet(`<h2>Handicaps</h2>
    <label class="field">Allowance %<input type="number" id="eh-allow" value="${r.allowance}"></label>
    ${r.players.map((rp, i) => `<div class="grid2"><label class="field">${esc(player(rp.playerId)?.name)} index<input type="number" step="0.1" data-ehi="${i}" value="${rp.hi ?? ''}"></label>
      <label class="field">Tees<select data-ete="${i}">${c.tees.map((t) => `<option value="${t.id}"${t.id === rp.teeId ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label></div>`).join('')}
    <label class="field">PCC<input type="number" id="eh-pcc" min="-1" max="3" value="${r.pcc || 0}"></label>
    <button class="btn primary" id="eh-save">Save</button>`, (el, close) => {
    $('#eh-save', el).onclick = () => {
      r.allowance = +$('#eh-allow', el).value || 100;
      r.pcc = +$('#eh-pcc', el).value || 0;
      $$('[data-ehi]', el).forEach((inp) => (r.players[+inp.dataset.ehi].hi = inp.value === '' ? null : +inp.value));
      $$('[data-ete]', el).forEach((s) => (r.players[+s.dataset.ete].teeId = s.value));
      touch(r); close(); render();
    };
  });
}

export function resultText(r) {
  const c = course(r.courseId);
  const rows = G.sortRows(G.leaderboard(r), r.format);
  const isPts = r.format !== 'stroke';
  const lines = rows.map((x, i) => `${i + 1}. ${x.player?.name || '?'} — ${isPts ? x.pts + ' pts' : toParText(x.netToPar) + ' net'} (${x.gross} gross${x.thru < G.roundHoles(r, c).length ? `, thru ${x.thru}` : ''})`);
  let extra = '';
  if (r.format === 'match' && r.players.length >= 2) { const m = G.matchStatus(r); extra = `\nMatch: ${m.up > 0 ? player(r.players[0].playerId)?.name : m.up < 0 ? player(r.players[1].playerId)?.name : ''} ${m.text}`; }
  if (r.format === 'skins') { const s = G.skins(r); extra = '\nSkins: ' + r.players.map((rp, i) => `${player(rp.playerId)?.name} ${s.won[i]}`).join(', '); }
  return `⛳ ${c?.name || 'Golf'} — ${fmtDate(r.date)}\n${W.FORMATS[r.format]?.label}${G.isNine(r) ? ' (9 holes)' : ''}\n\n${lines.join('\n')}${extra}${r.notes ? '\n\n' + r.notes : ''}`;
}

/* ======================= Summary ======================= */

export function summaryView(id) {
  const r = round(id);
  if (!r) return { html: '<div class="empty">Round not found.</div>', back: '#/' };
  const c = course(r.courseId);
  const rows = G.sortRows(G.leaderboard(r), r.format);
  const w = rows[0];
  const hcpRows = r.players.map((rp) => {
    const p = player(rp.playerId);
    const d = G.roundDifferential(r, rp);
    const h = G.handicapFor(rp.playerId);
    const rec = h.history.find((x) => x.id === r.id);
    return `<tr class="${rec?.counting ? 'count' : ''}"><td>${esc(p?.name || '?')}</td><td class="r">${d.ags ?? '—'}</td><td class="r">${d.diff != null ? fmt1(d.diff) : '—'}</td><td class="r">${rec ? `${hiText(rec.indexBefore)} → <b>${hiText(rec.indexAfter)}</b>` : `<span class="tiny muted">${esc(d.why || (r.countsForHandicap === false ? 'Not counting' : ''))}</span>`}</td></tr>`;
  }).join('');
  const est = r.players.some((rp) => G.playerHandicaps(r, rp, c).estimated);
  return {
    title: c?.name || 'Round', back: '#/', tab: 'home',
    actions: `<button id="sm-share" aria-label="Share">${icon('share')}</button>`,
    html: `<section class="hero"><div class="stripes"></div><span class="eyebrow">${fmtDate(r.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
        <h1>${r.players.length === 1 && w ? (r.format === 'stroke' ? `${w.gross} gross, ${toParText(w.netToPar)} net` : `${w.pts} points`) : w?.player ? `${esc(w.player.name)} wins` : 'Round complete'}</h1>
        <p>${esc(c?.name || '')} · ${esc(W.FORMATS[r.format]?.label)}${G.isNine(r) ? ' · 9 holes' : ''}${r.weather ? ` · ${Math.round(r.weather.temp)}°C, wind ${Math.round(r.weather.wind)} mph` : ''}</p></section>
      ${boardHtml(r, { summary: true })}
      <section class="card"><span class="eyebrow">Handicap</span>
        <div class="tbl-wrap"><table class="data"><thead><tr><th>Player</th><th class="r">Adj. gross</th><th class="r">Differential</th><th class="r">App index</th></tr></thead><tbody>${hcpRows}</tbody></table></div>
        <p class="tiny muted">Adjusted gross caps each hole at net double bogey. Highlighted rows are currently among the best 8 of the last 20.${est ? ' <b>Course Rating/Slope missing, so differentials are estimates.</b>' : ''}</p>
        <label class="switch small">Counts towards handicaps<input type="checkbox" id="sm-counts" ${r.countsForHandicap !== false ? 'checked' : ''}></label>
      </section>
      <section class="card"><span class="eyebrow">Side bets</span>
        <div class="grid2"><label class="field">Nearest the pin<input type="text" id="sm-ntp" value="${esc(r.side?.ntp || '')}" placeholder="who / which hole"></label>
        <label class="field">Longest drive<input type="text" id="sm-ld" value="${esc(r.side?.ld || '')}" placeholder="who / which hole"></label></div>
        <label class="field">Notes<textarea id="sm-notes" placeholder="Highlights, excuses, who's buying…">${esc(r.notes || '')}</textarea></label>
        <label class="field">Trip<select id="sm-trip"><option value="">None</option>${state.trips.map((t) => `<option value="${t.id}"${t.id === r.tripId ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
      </section>
      <div class="btns"><button class="btn primary" id="sm-send">${icon('share')} Send round to the lads</button><button class="btn" id="sm-text">Share result text</button></div>
      <div class="btns"><button class="btn" id="sm-edit">${icon('edit')} Edit scores</button><button class="btn danger" id="sm-del">${icon('trash')} Delete</button></div>`,
    mount() {
      const upd = () => { r.updated = Date.now(); save(); };
      $('#sm-counts').onchange = (e) => { r.countsForHandicap = e.target.checked; upd(); render(); };
      $('#sm-ntp').onchange = (e) => { (r.side ||= {}).ntp = e.target.value; upd(); };
      $('#sm-ld').onchange = (e) => { (r.side ||= {}).ld = e.target.value; upd(); };
      $('#sm-notes').onchange = (e) => { r.notes = e.target.value; upd(); };
      $('#sm-trip').onchange = (e) => { r.tripId = e.target.value || null; upd(); };
      $('#sm-text').onclick = () => shareText(resultText(r));
      $('#sm-share').onclick = () => shareText(resultText(r));
      $('#sm-send').onclick = async () => {
        const code = await toShareCode(roundBundle(r));
        shareText(`${resultText(r)}\n\nAdd this round to your Fairway Book: More → Paste a share code\n${code}`);
      };
      $('#sm-edit').onclick = () => { r.status = 'live'; r.currentHole = 0; upd(); tab = 'score'; go('#/round/' + r.id); };
      $('#sm-del').onclick = async () => {
        if (!(await ask('Delete this round?', 'It will be removed from everyone\'s history and handicap on this phone.', 'Delete', true))) return;
        state.rounds = state.rounds.filter((x) => x.id !== r.id); save(); go('#/');
      };
    },
  };
}

export { hiText };
