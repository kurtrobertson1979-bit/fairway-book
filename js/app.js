import { state, load, save, saveNow, uid, player, course, mergeIn, fullBackup, fromShareCode, toShareCode } from './store.js';
import { $, $$, esc, icon, avatar, toast, sheet, ask, fmtDate, today, hiText, fmt1, download, pickFile, shareText, COLOURS } from './ui.js';
import * as G from './golf.js';
import * as Play from './play.js';
import * as Courses from './courses.js';
import * as Insights from './insights.js';
import { fetchWeather, getOnce, WMO, compass } from './geo.js';
import { demoData } from './demo.js';
import * as Live from './live.js';

/* ---------------- router ---------------- */

const TABS = {
  home: ['home', 'Home'], handicap: ['hcp', 'Handicap'], play: ['flag', 'Play'], stats: ['stats', 'Stats'], more: ['more', 'More'],
};

let current = null;

const routes = [
  [/^$/, () => homeView()],
  [/^play$/, () => {
    const live = state.rounds.find((r) => r.status === 'live');
    return live ? redirect('#/round/' + live.id) : Play.setupView();
  }],
  [/^new$/, () => Play.setupView()],
  [/^round\/(\w+)$/, (id) => Play.liveView(id)],
  [/^r\/(\w+)$/, (id) => Play.summaryView(id)],
  [/^rounds$/, () => roundsView()],
  [/^courses$/, () => Courses.listView()],
  [/^course\/(\w+)$/, (id) => Courses.detailView(id)],
  [/^players$/, () => playersView()],
  [/^handicap(?:\/(\w+))?$/, (id) => Insights.handicapView(id)],
  [/^stats(?:\/(\w+))?$/, (id) => Insights.statsView(id)],
  [/^trips$/, () => tripsView()],
  [/^trip\/(\w+)$/, (id) => tripView(id)],
  [/^more$/, () => moreView()],
  [/^watch$/, () => watchView()],
  [/^join\/([\w-]+)$/, (code) => joinView(code)],
];

function redirect(h) { setTimeout(() => (location.hash = h), 0); return { html: '' }; }

export function go(h) { location.hash = h; }

export function render() {
  const path = location.hash.replace(/^#\/?/, '');
  current?.unmount?.();
  let v = null;
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) { v = fn(...m.slice(1)); break; }
  }
  if (!v) v = homeView();
  current = v;
  const main = $('#view');
  main.innerHTML = v.html;
  $('#title').innerHTML = v.title ? esc(v.title) : 'Fairway Book';
  const back = $('#nav-back');
  back.hidden = !v.back;
  back.onclick = () => (typeof v.back === 'string' ? go(v.back) : history.back());
  $('#top-actions').innerHTML = v.actions || '';
  const tab = v.tab || path.split('/')[0] || 'home';
  $$('#tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === (tab === '' ? 'home' : tab)));
  v.mount?.(main);
  if (!v.keepScroll) window.scrollTo(0, 0);
}

function drawTabbar() {
  $$('#tabbar a').forEach((a) => {
    const [ic, label] = TABS[a.dataset.tab];
    a.innerHTML = a.dataset.tab === 'play'
      ? `<span class="disc">${icon(ic)}</span><span class="lbl">${label}</span>`
      : `${icon(ic)}<span>${label}</span>`;
  });
}

/* ---------------- home ---------------- */

function homeView() {
  const live = state.rounds.find((r) => r.status === 'live');
  const done = state.rounds.filter((r) => r.status === 'done').sort((a, b) => (a.date < b.date ? 1 : -1));
  const trip = state.trips.find((t) => t.start <= today() && (!t.end || t.end >= today())) || null;
  let hero;
  if (live) {
    const c = course(live.courseId);
    const rows = G.sortRows(G.leaderboard(live), live.format);
    const leader = rows[0];
    hero = `<section class="hero"><div class="stripes"></div>
      <span class="eyebrow">Round in progress</span>
      <h1>${esc(c?.name || 'Round')}</h1>
      <p>Hole ${(live.currentHole ?? 0) + 1} · ${leader?.thru ? `${esc(leader.player?.name)} leads` : 'No scores yet'}</p>
      <a class="btn flag big" href="#/round/${live.id}">${icon('flag')} Back to the scorecard</a></section>`;
  } else {
    hero = `<section class="hero"><div class="stripes"></div>
      <span class="eyebrow">${esc(fmtDate(today(), { weekday: 'long', day: 'numeric', month: 'long' }))}</span>
      <h1>${state.players.length ? 'Ready to tee off?' : 'Welcome to Fairway Book'}</h1>
      <p id="home-wx" class="small">${state.players.length ? 'Scores, handicaps, GPS yardages and the long-running record of who owes who a pint.' : 'Add the lads, pick a course and you are on the first tee.'}</p>
      <a class="btn flag big" href="#/new">${icon('flag')} Start a round</a></section>`;
  }

  const setup = !state.players.length || !state.courses.length ? `<section class="card">
      <h2>Get set up</h2>
      <div class="list">
        <a class="item" href="#/players">${state.players.length ? icon('check', 'width="22" style="color:var(--accent)"') : '<b class="bignum" style="font-size:1.4rem;width:22px;text-align:center">1</b>'}<div class="grow"><b>Add the lads</b><p class="small muted">Names and current Handicap Index (from the England Golf app).</p></div></a>
        <a class="item" href="#/courses">${state.courses.length ? icon('check', 'width="22" style="color:var(--accent)"') : '<b class="bignum" style="font-size:1.4rem;width:22px;text-align:center">2</b>'}<div class="grow"><b>Find your course</b><p class="small muted">Search England's courses. Hole maps load from OpenStreetMap.</p></div></a>
        <a class="item" href="#/new"><b class="bignum" style="font-size:1.4rem;width:22px;text-align:center">3</b><div class="grow"><b>Tee off</b><p class="small muted">Score the whole group on one phone.</p></div></a>
      </div></section>` : '';

  const lads = state.players.length ? `<section class="stack">
      <div class="section-h"><h2>The lads</h2><a class="small" href="#/players">Manage</a></div>
      <div class="lads">${state.players.map((p) => {
        const h = G.handicapFor(p.id);
        const idx = h.current ?? (p.officialIndex !== '' ? p.officialIndex : null);
        return `<a class="lad" href="#/handicap/${p.id}">${avatar(p)}<div class="grow"><div class="ellip small" style="font-weight:600">${esc(p.name)}</div><div class="hi">${hiText(idx)}</div></div></a>`;
      }).join('')}</div></section>` : '';

  const tripCard = trip ? `<a class="card flat" href="#/trip/${trip.id}" style="text-decoration:none;color:inherit">
      <div class="row between"><div><span class="eyebrow">Trip on now</span><h2>${esc(trip.name)}</h2></div>${icon('trip', 'width="28"')}</div>
      ${tripStandings(trip, 3)}</a>` : '';

  const journey = `<section class="stack">
      <div class="section-h"><h2>The journey</h2>${done.length ? `<a class="small" href="#/rounds">All ${done.length} rounds</a>` : ''}</div>
      <div class="card">${done.length ? `<div class="timeline">${done.slice(0, 6).map(roundItem).join('')}</div>`
        : '<div class="empty"><p>Finished rounds appear here, with the winner and the course, and build into your handicap and stats.</p></div>'}</div></section>`;

  return {
    html: hero + setup + tripCard + lads + journey,
    tab: 'home',
    mount() {
      if (!live && state.players.length && navigator.onLine) homeWeather();
    },
  };
}

async function homeWeather() {
  try {
    const fix = await getOnce();
    const w = await fetchWeather(fix.ll);
    const el = $('#home-wx');
    if (!el) return;
    const c = w.current;
    el.textContent = `${WMO(c.weather_code)}, ${Math.round(c.temperature_2m)}°C. Wind ${Math.round(c.wind_speed_10m)} mph from the ${compass(c.wind_direction_10m)}, gusting ${Math.round(c.wind_gusts_10m)}.`;
  } catch { /* no location or offline */ }
}

export function roundItem(r) {
  const c = course(r.courseId);
  const rows = G.sortRows(G.leaderboard(r), r.format);
  const w = rows[0];
  const d = new Date(r.date + 'T12:00:00');
  const fmtName = { stableford: 'pts', bbstable: 'pts', stroke: 'net', match: 'pts', fourball: 'pts', skins: 'pts' }[r.format];
  const res = w ? (fmtName === 'net' ? `${w.net} net` : `${w.pts} pts`) : '';
  return `<a class="tl-item" href="#/r/${r.id}">
    <div class="tl-date"><b>${d.getDate()}</b><span>${d.toLocaleDateString('en-GB', { month: 'short' })} ${String(d.getFullYear()).slice(2)}</span></div>
    <div class="stack" style="gap:2px">
      <div class="row between"><b class="ellip">${esc(c?.name || 'Unknown course')}</b>${G.isNine(r) ? '<span class="pill">9 holes</span>' : ''}</div>
      <div class="small muted ellip">${r.players.length === 1 ? `${esc(w?.player?.name || '')} · ${res} · solo` : `${w?.player ? `${esc(w.player.name)} won · ${res}` : ''} · ${r.players.length} players`}</div>
      <div class="row" style="gap:4px">${r.players.map((rp) => avatar(player(rp.playerId), true)).join('')}</div>
    </div></a>`;
}

function roundsView() {
  const done = state.rounds.filter((r) => r.status === 'done').sort((a, b) => (a.date < b.date ? 1 : -1));
  return {
    title: 'All rounds', back: '#/',
    html: `<div class="card">${done.length ? `<div class="timeline">${done.map(roundItem).join('')}</div>` : '<div class="empty">No rounds yet.</div>'}</div>`,
  };
}

/* ---------------- players ---------------- */

function playersView() {
  return {
    title: 'The lads', back: '#/more', tab: 'more',
    actions: `<button id="add-p" aria-label="Add player">${icon('plus')}</button>`,
    html: `<div class="card">${state.players.length ? `<div class="list">${state.players.map((p) => {
      const h = G.handicapFor(p.id);
      return `<button class="item" data-edit="${p.id}" style="background:none;border:0;border-top:1px solid var(--line);text-align:left;width:100%">
        ${avatar(p)}<div class="grow"><b>${esc(p.name)}</b>${p.isMe ? ' <span class="pill good">Me</span>' : ''}
        <p class="small muted">Official ${hiText(p.officialIndex)} · App index ${hiText(h.current)} · ${h.records.length} scores</p></div>${icon('edit', 'width="20"')}</button>`;
    }).join('')}</div>` : '<div class="empty"><p>No players yet. Add yourself first, then the rest of the group.</p></div>'}
      <button class="btn primary block" id="add-p2">${icon('plus')} Add a player</button></div>
      <p class="small muted">The <b>official</b> index is the one on your England Golf app. Fairway Book also works out its own index from the rounds you log here, using the same WHS rules. Use it as a guide; your club's record is the one that counts in competitions.</p>`,
    mount(el) {
      $('#add-p').onclick = () => editPlayer();
      $('#add-p2').onclick = () => editPlayer();
      $$('[data-edit]', el).forEach((b) => (b.onclick = () => editPlayer(player(b.dataset.edit))));
    },
  };
}

export function editPlayer(p, after) {
  const isNew = !p;
  p = p ? { ...p } : { id: uid(), name: '', colour: COLOURS[state.players.length % COLOURS.length], officialIndex: '', useOfficial: true, isMe: !state.players.length, created: Date.now() };
  sheet(`<h2>${isNew ? 'Add a player' : 'Edit ' + esc(p.name)}</h2>
    <label class="field">Name<input type="text" id="p-name" value="${esc(p.name)}" autocomplete="off" placeholder="e.g. Kurt"></label>
    <div class="grid2">
      <label class="field">Official Handicap Index<input type="number" id="p-hi" step="0.1" min="-10" max="54" inputmode="decimal" value="${esc(p.officialIndex)}" placeholder="e.g. 18.4"></label>
      <label class="field">Home club<input type="text" id="p-club" value="${esc(p.club || '')}" placeholder="optional"></label>
    </div>
    <p class="tiny muted">Enter a plus handicap as a negative number (e.g. +1.2 → -1.2).</p>
    <div class="stack"><span class="eyebrow">Colour</span><div class="chips">${COLOURS.map((c) => `<button class="chip${c === p.colour ? ' on' : ''}" data-col="${c}" aria-label="Colour ${c}"><span class="avatar sm" style="background:${c};width:20px;height:20px"></span></button>`).join('')}</div></div>
    <label class="switch">Use official index for new rounds<input type="checkbox" id="p-useoff" ${p.useOfficial ? 'checked' : ''}></label>
    <p class="tiny muted" style="margin-top:-8px">Switch off to play off the index Fairway Book calculates from logged rounds.</p>
    <label class="switch">This is me<input type="checkbox" id="p-me" ${p.isMe ? 'checked' : ''}></label>
    <div class="btns">${isNew ? '' : '<button class="btn danger" id="p-del">Remove</button>'}<button class="btn primary" id="p-save">Save</button></div>`,
  (el, close) => {
    $$('[data-col]', el).forEach((b) => (b.onclick = () => { p.colour = b.dataset.col; $$('[data-col]', el).forEach((x) => x.classList.toggle('on', x === b)); }));
    $('#p-save', el).onclick = () => {
      p.name = $('#p-name', el).value.trim();
      if (!p.name) return toast('Give them a name');
      p.officialIndex = $('#p-hi', el).value === '' ? '' : +$('#p-hi', el).value;
      p.startIndex = p.officialIndex;
      p.club = $('#p-club', el).value.trim();
      p.useOfficial = $('#p-useoff', el).checked;
      p.isMe = $('#p-me', el).checked;
      p.updated = Date.now();
      if (p.isMe) state.players.forEach((x) => (x.isMe = false));
      const i = state.players.findIndex((x) => x.id === p.id);
      if (i >= 0) state.players[i] = p; else state.players.push(p);
      if (p.isMe) state.settings.meId = p.id;
      save(); close(); toast('Saved');
      after ? after(p) : render();
    };
    $('#p-del', el)?.addEventListener('click', async () => {
      const used = state.rounds.some((r) => r.players.some((x) => x.playerId === p.id));
      if (!(await ask('Remove ' + p.name + '?', used ? 'Their rounds stay in the history but will show as an unknown player.' : '', 'Remove', true))) return;
      state.players = state.players.filter((x) => x.id !== p.id);
      save(); close(); render();
    });
  });
}

/* ---------------- trips ---------------- */

function tripStandings(t, limit = 99) {
  const rounds = state.rounds.filter((r) => r.tripId === t.id && r.status !== 'deleted');
  const tally = {};
  for (const r of rounds) {
    const rows = G.sortRows(G.leaderboard(r), 'stableford');
    rows.forEach((row, i) => {
      const k = row.rp.playerId;
      tally[k] ||= { pts: 0, wins: 0, rounds: 0, gross: 0 };
      tally[k].pts += row.pts; tally[k].rounds++; tally[k].gross += row.gross;
      if (i === 0 && row.thru) tally[k].wins++;
    });
  }
  const list = Object.entries(tally).sort((a, b) => b[1].pts - a[1].pts).slice(0, limit);
  if (!list.length) return '<p class="small muted">No rounds on this trip yet.</p>';
  return `<div class="lb">${list.map(([pid, t], i) => `<div class="r"><span class="pos">${i + 1}</span>${avatar(player(pid))}<b class="ellip">${esc(player(pid)?.name || '?')}</b>
    <span class="sub">${t.rounds} rd · ${t.wins} win${t.wins === 1 ? '' : 's'}</span><span class="main">${t.pts}</span></div>`).join('')}</div>`;
}

function tripsView() {
  const trips = [...state.trips].sort((a, b) => (a.start < b.start ? 1 : -1));
  return {
    title: 'Trips', back: '#/more', tab: 'more',
    actions: `<button id="add-t" aria-label="New trip">${icon('plus')}</button>`,
    html: `<p class="muted small">Group rounds into a trip (a weekend away, a society season) for a running Stableford leaderboard across every round.</p>
    <div class="card">${trips.length ? `<div class="list">${trips.map((t) => `<a class="item" href="#/trip/${t.id}">${icon('trip', 'width="26"')}<div class="grow"><b>${esc(t.name)}</b><p class="small muted">${fmtDate(t.start)}${t.end ? ' – ' + fmtDate(t.end) : ''} · ${state.rounds.filter((r) => r.tripId === t.id).length} rounds</p></div></a>`).join('')}</div>`
      : '<div class="empty"><p>No trips yet.</p></div>'}
      <button class="btn primary block" id="add-t2">${icon('plus')} New trip</button></div>`,
    mount() { $('#add-t').onclick = () => editTrip(); $('#add-t2').onclick = () => editTrip(); },
  };
}

export function editTrip(t, after) {
  const isNew = !t;
  t = t ? { ...t } : { id: uid(), name: '', start: today(), end: '', notes: '', created: Date.now() };
  sheet(`<h2>${isNew ? 'New trip' : 'Edit trip'}</h2>
    <label class="field">Name<input type="text" id="t-name" value="${esc(t.name)}" placeholder="e.g. October weekend away"></label>
    <div class="grid2"><label class="field">Starts<input type="date" id="t-start" value="${esc(t.start)}"></label><label class="field">Ends<input type="date" id="t-end" value="${esc(t.end)}"></label></div>
    <label class="field">Notes<textarea id="t-notes" placeholder="Where you stayed, the stakes, the forfeits…">${esc(t.notes)}</textarea></label>
    <div class="btns">${isNew ? '' : '<button class="btn danger" id="t-del">Delete trip</button>'}<button class="btn primary" id="t-save">Save</button></div>`,
  (el, close) => {
    $('#t-save', el).onclick = () => {
      t.name = $('#t-name', el).value.trim() || 'Golf trip';
      t.start = $('#t-start', el).value || today(); t.end = $('#t-end', el).value; t.notes = $('#t-notes', el).value; t.updated = Date.now();
      const i = state.trips.findIndex((x) => x.id === t.id);
      if (i >= 0) state.trips[i] = t; else state.trips.push(t);
      save(); close(); after ? after(t) : go('#/trip/' + t.id);
    };
    $('#t-del', el)?.addEventListener('click', async () => {
      if (!(await ask('Delete this trip?', 'The rounds stay in your history.', 'Delete', true))) return;
      state.trips = state.trips.filter((x) => x.id !== t.id);
      state.rounds.forEach((r) => { if (r.tripId === t.id) r.tripId = null; });
      save(); close(); go('#/trips');
    });
  });
}

function tripView(id) {
  const t = state.trips.find((x) => x.id === id);
  if (!t) return { html: '<div class="empty">Trip not found.</div>', back: '#/trips' };
  const rounds = state.rounds.filter((r) => r.tripId === id && r.status === 'done').sort((a, b) => (a.date < b.date ? -1 : 1));
  return {
    title: t.name, back: '#/trips', tab: 'more',
    actions: `<button id="t-edit" aria-label="Edit trip">${icon('edit')}</button>`,
    html: `<section class="card"><span class="eyebrow">${fmtDate(t.start)}${t.end ? ' – ' + fmtDate(t.end) : ''}</span><h2>Trip leaderboard</h2>
      <p class="small muted">Total Stableford points across every round on the trip.</p>${tripStandings(t)}</section>
      ${t.notes ? `<section class="card"><span class="eyebrow">Notes</span><p style="white-space:pre-wrap">${esc(t.notes)}</p></section>` : ''}
      <section class="stack"><div class="section-h"><h2>Rounds</h2></div><div class="card">${rounds.length ? `<div class="timeline">${rounds.map(roundItem).join('')}</div>` : '<div class="empty">Start a round and pick this trip to add it here.</div>'}</div></section>
      <button class="btn block" id="t-share">${icon('share')} Share the standings</button>`,
    mount() {
      $('#t-edit').onclick = () => editTrip(t);
      $('#t-share').onclick = () => {
        const tmp = document.createElement('div'); tmp.innerHTML = tripStandings(t);
        const lines = $$('.r', tmp).map((r) => r.innerText.replace(/\s*\n\s*/g, ' ').trim());
        shareText(`⛳ ${t.name} — standings\n${lines.join('\n')}`);
      };
    },
  };
}

/* ---------------- more / settings ---------------- */

function moreView() {
  const s = state.settings;
  return {
    title: 'More', tab: 'more',
    html: `<section class="card"><div class="list">
        <a class="item" href="#/courses">${icon('course', 'width="24"')}<div class="grow"><b>Courses</b><p class="small muted">${state.courses.length} saved · search England's courses</p></div></a>
        <a class="item" href="#/players">${icon('people', 'width="24"')}<div class="grow"><b>The lads</b><p class="small muted">${state.players.length} players</p></div></a>
        <a class="item" href="#/trips">${icon('trip', 'width="24"')}<div class="grow"><b>Trips</b><p class="small muted">Weekends away and seasons</p></div></a>
        <a class="item" href="#/rounds">${icon('flag', 'width="24"')}<div class="grow"><b>All rounds</b><p class="small muted">${state.rounds.filter((r) => r.status === 'done').length} finished</p></div></a>
        <a class="item" href="#/watch">${icon('watch', 'width="24"')}<div class="grow"><b>Galaxy Watch</b><p class="small muted">Caddie mode and watch options</p></div></a>
      </div></section>

      ${liveCard()}

      <section class="card"><h2>Share with the lads</h2>
        <p class="small muted">Everything is stored on this phone. To keep everyone's history in step, send a round as a share code (WhatsApp works) or swap backup files. Importing merges rounds and never duplicates them.</p>
        <div class="btns"><button class="btn primary" id="imp-code">${icon('download')} Paste a share code</button><button class="btn" id="share-all">${icon('share')} Send everything</button></div>
        <div class="btns"><button class="btn" id="exp">${icon('download')} Save backup file</button><button class="btn" id="imp">${icon('upload')} Open backup file</button></div>
      </section>

      <section class="card"><h2>Settings</h2>
        <label class="field">Distances<select id="s-units"><option value="yd"${s.units === 'yd' ? ' selected' : ''}>Yards</option><option value="m"${s.units === 'm' ? ' selected' : ''}>Metres</option></select></label>
        <label class="field">Theme<select id="s-theme"><option value="">Match phone</option><option value="light"${s.theme === 'light' ? ' selected' : ''}>Light (best in sunshine)</option><option value="dark"${s.theme === 'dark' ? ' selected' : ''}>Dark</option></select></label>
        <label class="switch">Keep screen on during a round<input type="checkbox" id="s-awake" ${s.keepAwake ? 'checked' : ''}></label>
        <label class="switch">Move to next hole after everyone has scored<input type="checkbox" id="s-adv" ${s.autoAdvance ? 'checked' : ''}></label>
      </section>

      <section class="card"><details><summary>How handicaps are worked out</summary><div class="prose" style="margin-top:10px">
        <p>Fairway Book follows the World Handicap System used by England Golf and Scottish Golf.</p>
        <p><b>Score Differential</b> = (113 ÷ Slope Rating) × (Adjusted Gross Score − Course Rating − PCC).</p>
        <p><b>Adjusted Gross Score</b>: each hole is capped at <b>net double bogey</b> (par + 2 + any strokes you get on that hole). Unplayed holes count as net par. An 18-hole score needs 14 holes completed.</p>
        <p><b>Handicap Index</b> = average of the best 8 of your last 20 differentials. With fewer than 20 scores: 3 → lowest 1 minus 2.0; 4 → lowest 1 minus 1.0; 5 → lowest 1; 6 → average of lowest 2 minus 1.0; 7–8 → lowest 2; 9–11 → lowest 3; 12–14 → lowest 4; 15–16 → lowest 5; 17–18 → lowest 6; 19 → lowest 7.</p>
        <p><b>Caps</b>: once you have 20 scores, a rise of more than 3.0 above your lowest index in the last 365 days is halved (soft cap) and can never exceed 5.0 (hard cap).</p>
        <p><b>Exceptional score</b>: a differential 7.0–9.9 below your index takes 1.0 off; 10.0 or more takes 2.0 off.</p>
        <p><b>9-hole rounds</b>: your 9-hole differential plus the expected score for the other nine (index × 0.52 + 1.2).</p>
        <p><b>Course Handicap</b> = Index × (Slope ÷ 113) + (Course Rating − Par). Playing handicap applies the format allowance: 95% for singles stroke play and Stableford, 85% for four-ball better-ball, 90% for four-ball match play, 100% difference for singles match play.</p>
        <p class="muted small">Source: Scottish Golf and England Golf WHS guidance. Only scores submitted through your club count officially; this is your group's own record.</p>
      </div></details></section>

      <section class="card"><details><summary>Install on your phone</summary><div class="prose" style="margin-top:10px">
        <p><b>Android (Chrome or Samsung Internet)</b>: open the link, tap the menu (⋮ or ≡) and choose <b>Install app</b> or <b>Add to Home screen</b>.</p>
        <p><b>iPhone (Safari)</b>: tap Share, then <b>Add to Home Screen</b>.</p>
        <p>Once installed it works offline. Load your course map at home on Wi-Fi so yardages work with no signal on the course.</p>
      </div></details></section>

      <section class="card"><details><summary>Demo and reset</summary><div class="stack" style="margin-top:10px">
        <p class="small muted">Load a few made-up rounds to see the stats and handicap screens filled in. Demo players are named "Demo".</p>
        <div class="btns"><button class="btn" id="demo">Load demo data</button><button class="btn danger" id="wipe">Delete all data</button></div>
      </div></details></section>
      <p class="tiny muted" style="text-align:center">Fairway Book · course maps © OpenStreetMap contributors · imagery © Esri · weather by Open-Meteo</p>`,
    mount(el) {
      mountLiveCard();
      $('#s-units').onchange = (e) => { s.units = e.target.value; save(); };
      $('#s-theme').onchange = (e) => { s.theme = e.target.value; applyTheme(); save(); };
      $('#s-awake').onchange = (e) => { s.keepAwake = e.target.checked; save(); };
      $('#s-adv').onchange = (e) => { s.autoAdvance = e.target.checked; save(); };
      $('#exp').onclick = () => download(`fairway-book-${today()}.json`, fullBackup());
      $('#imp').onclick = async () => {
        const f = await pickFile();
        if (!f) return;
        try { importData(JSON.parse(await f.text())); } catch (e) { toast('Could not read that file: ' + e.message); }
      };
      $('#imp-code').onclick = () => importCodeSheet();
      $('#share-all').onclick = async () => {
        const code = await toShareCode({ kind: 'fairway-book', v: 1, players: state.players, courses: state.courses, rounds: state.rounds.filter((r) => r.status === 'done'), trips: state.trips, scores: state.scores });
        shareText(`Fairway Book full history (${state.rounds.length} rounds). In Fairway Book: More → Paste a share code.\n\n${code}`);
      };
      $('#demo').onclick = async () => {
        if (!(await ask('Load demo data?', 'Adds 3 demo players, a demo course and 12 rounds. You can delete them later with "Delete all data" or by removing the players.', 'Load demo'))) return;
        mergeIn(demoData()); toast('Demo loaded'); go('#/stats');
      };
      $('#wipe').onclick = async () => {
        if (!(await ask('Delete everything on this phone?', 'Players, courses, rounds and trips will be removed. Save a backup first if you might want them.', 'Delete everything', true))) return;
        Object.assign(state, { players: [], courses: [], rounds: [], trips: [], scores: [] });
        await saveNow(); toast('All data deleted'); go('#/');
      };
    },
  };
}

export function importData(data) {
  if (!data || data.kind !== 'fairway-book') { toast('That is not a Fairway Book file'); return; }
  const res = mergeIn(data);
  const n = (k) => (res[k] ? res[k].added + res[k].updated : 0);
  toast(`Imported ${n('rounds')} rounds, ${n('players')} players, ${n('courses')} courses`);
  render();
}

export function importCodeSheet() {
  sheet(`<h2>Paste a share code</h2><p class="small muted">Long-press and paste the whole message a mate sent you. Anything starting with FWB is picked up.</p>
    <textarea id="code" placeholder="FWB1.…" style="min-height:140px;font-family:monospace;font-size:.8rem"></textarea>
    <div class="btns"><button class="btn" data-close>Cancel</button><button class="btn primary" id="go">Import</button></div>`,
  (el, close) => {
    $('#go', el).onclick = async () => {
      try { const d = await fromShareCode($('#code', el).value); close(); importData(d); }
      catch (e) { toast(e.message); }
    };
  });
}

/* ---------------- watch ---------------- */

function watchView() {
  return {
    title: 'Galaxy Watch', back: '#/more', tab: 'more',
    html: `<section class="card"><h2>Caddie mode</h2>
      <p>During a round, open the GPS tab and tap <b>Caddie mode</b>. It fills the screen with a huge centre-of-green number and front/back underneath, in black and white for bright sun. It suits a phone in a cart holder or trolley clip.</p></section>
      <section class="card"><h2>Fairway Book on a Galaxy Watch</h2>
      <div class="prose">
      <p>There's a watch app for Galaxy Watch 4 and newer. It shows front, centre and back from the watch's own GPS, so the phone can stay in the bag. Turn the bezel to change hole, tap the big number to keep your score, and long-press it for bunker and water distances.</p>
      <p>Samsung only installs Play Store apps unless developer mode is on, so it's a one-time sideload of about 10 minutes, done with a free phone app called Wear Installer 2.</p>
      </div>
      <a class="btn primary" href="https://github.com/kurtrobertson1979-bit/fairway-book/blob/main/watch/README.md" target="_blank" rel="noopener">${icon('watch')} Install guide</a>
      <a class="btn" href="https://github.com/kurtrobertson1979-bit/fairway-book/releases/tag/watch-latest" target="_blank" rel="noopener">${icon('download')} Download the watch app</a></section>`,
  };
}

/* ---------------- boot ---------------- */

/* ---------------- live group ---------------- */

function liveCard() {
  if (!Live.inGroup()) {
    return `<section class="card" id="live-card"><h2>Live group</h2>
      <p class="small muted">See where the lads are on the course map and watch the leaderboard update as each of you scores on your own phone. Positions are only shared during a round, and everything is encrypted on the phone before it leaves.</p>
      <div class="btns"><button class="btn primary" id="live-new">${icon('people')} Start a live group</button><button class="btn" id="live-join">Join with a code</button></div></section>`;
  }
  const st = Live.liveStatus();
  const n = Live.peerList().length;
  const me = player(state.settings.meId);
  return `<section class="card" id="live-card"><div class="row between"><h2>Live group</h2><span class="pill ${st === 'live' ? 'good' : 'warn'}">${st === 'live' ? 'Connected' : st === 'error' ? 'Offline' : 'Connecting…'}</span></div>
    <p class="small muted">${n ? `${n} of the lads seen in the last 15 minutes.` : 'Nobody else on the course right now.'} You appear as <b>${esc(me?.name || 'nobody yet')}</b>.</p>
    <label class="switch">Share my location during rounds<input type="checkbox" id="live-share" ${Live.sharing() ? 'checked' : ''}></label>
    <div class="btns"><button class="btn primary" id="live-invite">${icon('share')} Invite the lads</button><button class="btn danger" id="live-leave">Leave group</button></div></section>`;
}

function mountLiveCard() {
  $('#live-new')?.addEventListener('click', () => ensureMe(() => startGroup()));
  $('#live-join')?.addEventListener('click', () => {
    sheet(`<h2>Join a live group</h2><p class="small muted">Paste the invite message or code a mate sent you.</p>
      <textarea id="lj-code" placeholder="https://…#/join/… or the code"></textarea>
      <div class="btns"><button class="btn" data-close>Cancel</button><button class="btn primary" id="lj-go">Join</button></div>`, (el, close) => {
      $('#lj-go', el).onclick = () => {
        const m = $('#lj-code', el).value.match(/join\/([\w-]{16,})/) || $('#lj-code', el).value.trim().match(/^([\w-]{16,})$/);
        if (!m) return toast('That does not look like an invite');
        close(); ensureMe(() => joinGroup(m[1]));
      };
    });
  });
  $('#live-share')?.addEventListener('change', (e) => { state.settings.live.share = e.target.checked; save(); });
  $('#live-invite')?.addEventListener('click', () => shareText(`⛳ Join our Fairway Book live group: see each other on the course map and a live leaderboard.\nOpen this on your phone:\n${Live.inviteLink()}`));
  $('#live-leave')?.addEventListener('click', async () => {
    if (!(await ask('Leave the live group?', 'You stop sharing your position and stop receiving live scores. Rounds already on this phone stay.', 'Leave', true))) return;
    Live.leave(); render();
  });
}

// Live sharing needs to know which player is on this phone
function ensureMe(next) {
  if (player(state.settings.meId)) return next();
  if (!state.players.length) return editPlayer(null, (p) => { state.settings.meId = p.id; p.isMe = true; save(); next(); });
  sheet(`<h2>Which one is you?</h2><p class="small muted">The lads see this name on the map.</p>
    <div class="list">${state.players.map((p) => `<button class="item btn ghost" data-me="${p.id}" style="justify-content:flex-start">${avatar(p)} ${esc(p.name)}</button>`).join('')}</div>
    <button class="btn" id="me-new">${icon('plus')} I'm not listed</button>`, (el, close) => {
    $$('[data-me]', el).forEach((b) => (b.onclick = () => {
      state.players.forEach((p) => (p.isMe = p.id === b.dataset.me));
      state.settings.meId = b.dataset.me; save(); close(); next();
    }));
    $('#me-new', el).onclick = () => { close(); editPlayer(null, (p) => { state.settings.meId = p.id; save(); next(); }); };
  });
}

async function startGroup() {
  await Live.join(Live.newCode());
  render();
  shareText(`⛳ Join our Fairway Book live group: see each other on the course map and a live leaderboard.\nOpen this on your phone:\n${Live.inviteLink()}`);
}

async function joinGroup(code) {
  if (state.settings.live?.code === code) { toast('Already in this group'); return go('#/more'); }
  await Live.join(code);
  toast('Joined the live group');
  go('#/more');
}

function joinView(code) {
  return {
    title: 'Live group', back: '#/',
    html: `<section class="card"><h2>Join the live group?</h2>
      <p>You'll see the lads on the course map and the leaderboard will update as each of you scores. Your position is shared with the group during rounds only, and you can switch that off at any time under More.</p>
      <div class="btns"><a class="btn" href="#/">Not now</a><button class="btn primary" id="jv-go">${icon('people')} Join</button></div></section>`,
    mount() { $('#jv-go').onclick = () => ensureMe(() => joinGroup(code)); },
  };
}

function applyTheme() {
  const t = state.settings.theme;
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}

async function boot() {
  drawTabbar();
  await load();
  applyTheme();
  window.addEventListener('hashchange', render);
  render();
  if (Live.inGroup()) Live.connect();
  // keep the More page's live status fresh
  Live.onLive((what) => {
    if (what === 'status' && location.hash === '#/more') { const c = $('#live-card'); if (c) { c.outerHTML = liveCard(); mountLiveCard(); } }
    if (what === 'round' && (location.hash === '#/' || location.hash === '')) render();
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
