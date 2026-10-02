import { state, save, uid, player, course } from './store.js';
import { $, $$, esc, icon, avatar, toast, sheet, ask, fmtDate, today, hiText, fmt1, fmt0, pct, lineChart, bars } from './ui.js';
import * as G from './golf.js';
import * as W from './whs.js';
import { M_TO_YD } from './geo.js';
import { render, go } from './app.js';

function pickPlayer(id) {
  return player(id) || player(state.settings.meId) || state.players[0] || null;
}

function playerChips(base, sel) {
  return `<div class="chips scroll">${state.players.map((p) => `<a class="chip${p.id === sel.id ? ' on' : ''}" href="#/${base}/${p.id}">${avatar(p, true)} ${esc(p.name)}</a>`).join('')}</div>`;
}

const noPlayers = (title) => ({
  title, html: `<div class="card empty"><p>Add the lads first, then log a round.</p><a class="btn primary" href="#/players">${icon('people')} Add players</a></div>`,
});

/* ======================= Handicap ======================= */

export function handicapView(id) {
  const p = pickPlayer(id);
  if (!p) return noPlayers('Handicap');
  const h = G.handicapFor(p.id);
  const hist = h.history;
  const recent = [...hist].reverse();
  const window20 = recent.slice(0, 20);
  const older = recent.slice(20);
  const counting = hist.filter((x) => x.counting);
  const worstCounting = counting.length && h.count >= 3 ? Math.max(...counting.map((x) => x.adjDiff)) : null;

  const trend = hist.filter((x) => x.indexAfter != null).map((x) => ({ x: fmtDate(x.date, { day: 'numeric', month: 'short' }), y: x.indexAfter }));

  const targets = worstCounting != null ? state.courses.flatMap((c) => c.tees.filter((t) => t.cr && t.slope).map((t) => ({ c, t, s: W.scoreForDiff(worstCounting - 0.05, t.cr, t.slope) }))).slice(0, 6) : [];

  const calc = state.courses.length ? `<section class="card"><h2>Course handicap</h2>
      <p class="small muted">How many shots ${esc(p.name)} gets, using ${h.current != null && !p.useOfficial ? 'the app index' : 'the playing index'} of <b>${hiText(G.playingIndex(p.id))}</b>.</p>
      <select id="ch-tee">${state.courses.flatMap((c) => c.tees.map((t) => `<option value="${c.id}|${t.id}">${esc(c.name)} · ${esc(t.name)}${t.cr ? ` (${t.cr}/${t.slope})` : ' (no rating)'}</option>`)).join('')}</select>
      <div class="tiles" id="ch-out"></div></section>` : '';

  return {
    title: 'Handicap', tab: 'handicap',
    html: `${playerChips('handicap', p)}
      <section class="card">
        <div class="row between" style="align-items:flex-start">
          <div><span class="eyebrow">App Handicap Index</span><div class="bignum" style="font-size:4.4rem">${hiText(h.current)}</div></div>
          <div class="stack" style="text-align:right;gap:2px"><span class="eyebrow">Official</span><b class="bignum" style="font-size:2rem">${hiText(p.officialIndex)}</b>
            ${h.low != null ? `<span class="tiny muted">Low index ${hiText(h.low)}</span>` : ''}</div>
        </div>
        <p class="small muted">${h.count >= 3 ? `Average of the best ${h.take} of ${h.count} differential${h.count === 1 ? '' : 's'}${h.adj ? ` ${h.adj > 0 ? '+' : ''}${h.adj.toFixed(1)}` : ''}${h.count < 20 ? ' (fewer than 20 scores, so the WHS table applies)' : ''}.`
          : `Needs 3 scores to calculate (has ${h.count}). Until then rounds use the official index.`}
          ${hist.length && hist[hist.length - 1].cap ? ` <span class="pill warn">${hist[hist.length - 1].cap} cap applied</span>` : ''}</p>
        ${trend.length > 1 ? lineChart(trend, { fmtY: (v) => hiText(v), height: 150 }) : ''}
      </section>

      ${worstCounting != null ? `<section class="card"><h2>To bring it down</h2>
        <p>A differential under <b>${fmt1(worstCounting)}</b> replaces ${esc(p.name)}'s worst counting score${h.count < 20 ? ' (and with fewer than 20 scores, any new score can shift the average)' : ''}.</p>
        ${targets.length ? `<div class="list">${targets.map((x) => `<div class="item"><div class="grow"><b>${esc(x.c.name)}</b><p class="small muted">${esc(x.t.name)} tees · CR ${x.t.cr} / Slope ${x.t.slope}</p></div><div style="text-align:right"><div class="bignum" style="font-size:1.8rem">${x.s}</div><span class="tiny muted">adj. gross or better</span></div></div>`).join('')}</div>` : ''}
      </section>` : ''}

      <section class="card"><div class="row between"><h2>Scoring record</h2><button class="btn sm" id="add-score">${icon('plus')} Past score</button></div>
        ${window20.length ? `<p class="small muted">Most recent 20. Highlighted scores count towards the index.</p>
        <div class="tbl-wrap"><table class="data"><thead><tr><th>Date</th><th>Course</th><th class="r">AGS</th><th class="r">Diff</th><th class="r">Index</th></tr></thead><tbody>
        ${window20.map(recRow).join('')}</tbody></table></div>
        ${older.length ? `<details><summary class="small">${older.length} older scores</summary><div class="tbl-wrap"><table class="data"><tbody>${older.map(recRow).join('')}</tbody></table></div></details>` : ''}`
        : '<div class="empty"><p>Finished rounds land here automatically. You can also add recent scores from your England Golf record to get a running start.</p></div>'}
      </section>
      ${calc}`,
    mount() {
      $('#add-score').onclick = () => addPastScore(p);
      $$('[data-score]').forEach((b) => (b.onclick = () => editPastScore(b.dataset.score)));
      const sel = $('#ch-tee');
      if (sel) {
        const upd = () => {
          const [cid, tid] = sel.value.split('|');
          const c = course(cid); const t = c.tees.find((x) => x.id === tid);
          const par = c.holes.reduce((s, x) => s + (x.par || 4), 0);
          const hi = G.playingIndex(p.id);
          const ch = W.courseHandicap(hi, t.slope || 113, t.cr || par, par);
          $('#ch-out').innerHTML = ch == null ? '<p class="muted">No index yet.</p>'
            : [['Course handicap', ch], ['Stableford / stroke (95%)', W.playingHandicap(ch, 95)], ['Better-ball (85%)', W.playingHandicap(ch, 85)], ['Four-ball match (90%)', W.playingHandicap(ch, 90)]]
              .map(([k, v]) => `<div class="tile"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
        };
        sel.onchange = upd; upd();
      }
    },
  };
}

function recRow(r) {
  const clickable = r.source === 'manual';
  return `<tr class="${r.counting ? 'count' : ''}" ${clickable ? `data-score="${r.id}" style="cursor:pointer"` : `onclick="location.hash='#/r/${r.id}'" style="cursor:pointer"`}>
    <td class="small">${fmtDate(r.date, { day: 'numeric', month: 'short', year: '2-digit' })}</td>
    <td class="small"><span class="ellip" style="display:block;max-width:11em">${esc(r.course)}</span>${r.nine ? '<span class="pill">9</span> ' : ''}${r.estimated ? '<span class="pill warn">est.</span> ' : ''}${r.esr ? `<span class="pill good">ESR −${r.esr}</span>` : ''}${clickable ? '<span class="pill">added</span>' : ''}</td>
    <td class="r">${r.ags ?? ''}</td><td class="r"><b>${fmt1(r.adjDiff)}</b></td><td class="r">${hiText(r.indexAfter)}</td></tr>`;
}

function addPastScore(p, s) {
  const isNew = !s;
  s = s || { id: uid(), playerId: p.id, date: today(), course: '', cr: '', slope: '', ags: '', diff: '', created: Date.now() };
  sheet(`<h2>${isNew ? 'Add a past score' : 'Edit score'}</h2>
    <p class="small muted">Copy recent scores from the England Golf app (Scoring record) so ${esc(p.name)}'s index starts from real history. Enter the differential if you have it; otherwise the adjusted gross score plus the course's rating and slope.</p>
    <div class="grid2"><label class="field">Date<input type="date" id="ps-date" value="${esc(s.date)}"></label><label class="field">Course<input type="text" id="ps-course" value="${esc(s.course)}" list="ps-courses"></label></div>
    <datalist id="ps-courses">${state.courses.map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist>
    <label class="field">Score differential (if known)<input type="number" step="0.1" id="ps-diff" value="${esc(s.diff)}" inputmode="decimal"></label>
    <div class="grid3"><label class="field">Adj. gross<input type="number" id="ps-ags" value="${esc(s.ags)}" inputmode="numeric"></label><label class="field">Course Rating<input type="number" step="0.1" id="ps-cr" value="${esc(s.cr)}" inputmode="decimal"></label><label class="field">Slope<input type="number" id="ps-sl" value="${esc(s.slope)}" inputmode="numeric"></label></div>
    <div class="btns">${isNew ? '' : '<button class="btn danger" id="ps-del">Delete</button>'}<button class="btn primary" id="ps-save">Save</button></div>`,
  (el, close) => {
    $('#ps-save', el).onclick = () => {
      const v = (q) => $(q, el).value;
      s.date = v('#ps-date') || today(); s.course = v('#ps-course') || 'Unknown';
      s.diff = v('#ps-diff') === '' ? '' : +v('#ps-diff');
      s.ags = v('#ps-ags') === '' ? '' : +v('#ps-ags'); s.cr = v('#ps-cr') === '' ? '' : +v('#ps-cr'); s.slope = v('#ps-sl') === '' ? '' : +v('#ps-sl');
      if (s.diff === '' && (s.ags === '' || s.cr === '' || !s.slope)) return toast('Enter a differential, or gross + rating + slope');
      s.updated = Date.now();
      const i = state.scores.findIndex((x) => x.id === s.id);
      if (i >= 0) state.scores[i] = s; else state.scores.push(s);
      save(); close(); render(); toast('Score saved');
    };
    $('#ps-del', el)?.addEventListener('click', async () => {
      state.scores = state.scores.filter((x) => x.id !== s.id); save(); close(); render();
    });
  });
}

function editPastScore(id) {
  const s = state.scores.find((x) => x.id === id);
  if (s) addPastScore(player(s.playerId), s);
}

/* ======================= Stats ======================= */

let range = 'all';

export function statsView(id) {
  const p = pickPlayer(id);
  if (!p) return noPlayers('Stats');
  const rounds = G.playerRounds(p.id);
  const since = range === 'year' ? `${new Date().getFullYear()}-01-01` : range === 'last10' && rounds.length > 10 ? rounds[9].date : null;
  const s = G.playerStats(p.id, { since });
  const clubs = G.clubDistances(p.id);
  const badges = G.achievements(p.id);
  const u = state.settings.units || 'yd';
  const conv = (m) => Math.round(u === 'yd' ? m * M_TO_YD : m);

  if (!s.rounds) {
    return {
      title: 'Stats', tab: 'stats',
      html: `${playerChips('stats', p)}<div class="card empty"><p>No finished rounds for ${esc(p.name)} yet. Log putts, fairways and bunkers as you score for the full picture.</p>
        <a class="btn primary" href="#/new">${icon('flag')} Start a round</a></div>`,
    };
  }

  const holeRows = Object.values(s.holeAvg).filter((x) => x[1] >= 2).map(([sum, n, par, cname, hn]) => ({ avg: sum / n, over: sum / n - par, par, cname, hn, n }));
  holeRows.sort((a, b) => b.over - a.over);
  const nemesis = holeRows.slice(0, 3);
  const friends = [...holeRows].sort((a, b) => a.over - b.over).slice(0, 3);

  const totalDist = Object.values(s.dist).reduce((a, b) => a + b, 0) || 1;
  const distRows = [
    ['Eagle+', s.dist.eagle + s.dist.albatross, 'under'], ['Birdie', s.dist.birdie, 'under'], ['Par', s.dist.par, ''],
    ['Bogey', s.dist.bogey, 'over'], ['Double', s.dist.double, 'over'], ['Triple+', s.dist.triple, 'over'],
  ].map(([k, v, cls]) => ({ k, v, cls, label: pct((100 * v) / totalDist) }));

  const trend = s.trend.map((t) => ({ x: fmtDate(t.date, { day: 'numeric', month: 'short' }), y: t.pts }));

  return {
    title: 'Stats', tab: 'stats',
    html: `${playerChips('stats', p)}
      <div class="chips">${[['all', 'All time'], ['year', 'This year'], ['last10', 'Last 10']].map(([k, l]) => `<button class="chip${range === k ? ' on' : ''}" data-range="${k}">${l}</button>`).join('')}</div>
      <div class="tiles">
        <div class="tile"><span class="k">Rounds</span><span class="v">${s.rounds}</span></div>
        <div class="tile"><span class="k">Avg Stableford</span><span class="v">${fmt1(s.avgPts)}<small>pts</small></span></div>
        <div class="tile"><span class="k">Avg gross (18)</span><span class="v">${fmt1(s.avgGross)}</span></div>
        <div class="tile"><span class="k">Best round</span><span class="v">${s.best ? s.best.gross : '—'}</span>${s.best ? `<span class="tiny muted ellip">${esc(s.best.course)}</span>` : ''}</div>
      </div>
      <section class="card"><span class="eyebrow">Where the shots go</span>${insights(s).map((t) => `<p class="insight">${t}</p>`).join('') || '<p class="muted small">Log putts and fairways during rounds to get pointers here.</p>'}</section>
      <div class="tiles">
        <div class="tile"><span class="k">Fairways</span><span class="v">${pct(s.firPct)}</span><span class="tiny muted">${s.fir.n ? `${s.fir.left} left · ${s.fir.right} right` : 'not logged'}</span></div>
        <div class="tile"><span class="k">Greens in reg.</span><span class="v">${pct(s.girPct)}</span></div>
        <div class="tile"><span class="k">Putts / round</span><span class="v">${fmt1(s.puttsPerRound)}</span><span class="tiny muted">${s.putts.n ? fmt1(s.threePuttsPerRound) + ' three-putts' : 'not logged'}</span></div>
        <div class="tile"><span class="k">Scrambling</span><span class="v">${pct(s.scramblePct)}</span><span class="tiny muted">par or better after missing the green</span></div>
        <div class="tile"><span class="k">Sand saves</span><span class="v">${pct(s.sandPct)}</span><span class="tiny muted">${s.sand.n} bunker holes</span></div>
        <div class="tile"><span class="k">Penalties / rd</span><span class="v">${fmt1(s.pensPerRound)}</span></div>
      </div>
      <section class="card"><span class="eyebrow">Stableford points per round</span>${lineChart(trend, { fmtY: (v) => fmt0(v) })}</section>
      <section class="card"><span class="eyebrow">Scoring mix (${s.holes} holes)</span>${bars(distRows, { max: Math.max(...distRows.map((r) => r.v)) })}</section>
      <section class="card"><span class="eyebrow">Average score by par</span>
        <div class="tiles">${[3, 4, 5].map((k) => `<div class="tile"><span class="k">Par ${k}s</span><span class="v">${fmt1(s.parAvg[k])}</span><span class="tiny muted">${s.byPar[k].n ? `${s.byPar[k].over / s.byPar[k].n >= 0 ? '+' : ''}${(s.byPar[k].over / s.byPar[k].n).toFixed(2)} per hole` : ''}</span></div>`).join('')}</div>
        <p class="small muted">By hole difficulty: ${['SI 1–6', 'SI 7–12', 'SI 13–18'].map((l, i) => `${l} ${s.bySi[i][1] ? `${s.bySi[i][0] / s.bySi[i][1] >= 0 ? '+' : ''}${(s.bySi[i][0] / s.bySi[i][1]).toFixed(2)}` : '—'}`).join(' · ')} over par per hole.</p></section>
      ${holeRows.length ? `<section class="card"><span class="eyebrow">Holes that bite (played 2+ times)</span>
        <div class="list">${nemesis.map((x) => `<div class="item"><div class="grow"><b>${esc(x.cname)} · ${x.hn}</b><p class="small muted">Par ${x.par}, played ${x.n}×</p></div><b class="bignum" style="font-size:1.6rem;color:var(--over)">+${x.over.toFixed(1)}</b></div>`).join('')}</div>
        <span class="eyebrow">Favourite holes</span>
        <div class="list">${friends.map((x) => `<div class="item"><div class="grow"><b>${esc(x.cname)} · ${x.hn}</b><p class="small muted">Par ${x.par}, played ${x.n}×</p></div><b class="bignum" style="font-size:1.6rem;color:${x.over < 0 ? 'var(--under)' : 'var(--ink)'}">${x.over >= 0 ? '+' : ''}${x.over.toFixed(1)}</b></div>`).join('')}</div></section>` : ''}
      <section class="card"><div class="row between"><span class="eyebrow">My bag</span><button class="btn sm" id="edit-bag">${icon('edit')} Edit distances</button></div>
        <p class="small muted">Used for club suggestions on the GPS screen. Clubs with 3 or more GPS-marked shots use ${esc(p.name)}'s real average automatically.</p>
        <div class="tbl-wrap"><table class="data"><thead><tr><th>Club</th><th class="r">Plays</th><th class="r">Tracked avg</th><th class="r">Longest</th><th class="r">Shots</th></tr></thead><tbody>
          ${G.bagFor(p.id).map((b) => { const t = clubs.find((c) => c.club === b.club); return `<tr><td><b>${G.CLUB_NAMES[b.club]}</b></td><td class="r"><b>${u === 'yd' ? b.yd : Math.round(b.yd / 1.0936)}</b> <span class="pill ${b.source === 'tracked' ? 'good' : ''}">${b.source === 'tracked' ? 'GPS' : b.source === 'set' ? 'yours' : 'typical'}</span></td><td class="r">${t ? conv(t.avg) : '—'}</td><td class="r">${t ? conv(t.max) : '—'}</td><td class="r">${t?.n ?? 0}</td></tr>`; }).join('')}</tbody></table></div>
        <p class="tiny muted">Distances in ${u === 'yd' ? 'yards' : 'metres'}, including roll. To track a club: on the GPS tab pick it, tap <b>Mark ball here</b> where you hit from, then mark where it finished.</p></section>
      ${headToHead(p)}
      <section class="card"><span class="eyebrow">Achievements</span><div class="badges">${badges.map((b) => `<div class="badge${b.got ? ' got' : ''}">${icon(b.got ? 'star' : 'flag')}${esc(b.name)}</div>`).join('')}</div></section>`,
    mount() {
      $$('[data-range]').forEach((b) => (b.onclick = () => { range = b.dataset.range; render(); }));
      $('#edit-bag').onclick = () => editBag(p.id, render);
    },
  };
}

export function editBag(playerId, after) {
  const p = player(playerId);
  if (!p) return;
  const own = p.bag || {};
  sheet(`<h2>${esc(p.name)}'s bag</h2>
    <p class="small muted">How far each club goes in yards, including roll. Leave blank to use the typical distance shown; enter 0 for a club that isn't in the bag.</p>
    <div class="grid3">${G.CLUBS.filter((k) => k !== 'Pt').map((k) => `<label class="field">${G.CLUB_NAMES[k]}<input type="number" inputmode="numeric" min="0" max="350" data-bag="${k}" value="${own[k] ?? ''}" placeholder="${G.DEFAULT_BAG[k] ?? '–'}"></label>`).join('')}</div>
    <button class="btn primary" id="bag-save">Save</button>`, (el, close) => {
    $('#bag-save', el).onclick = () => {
      const bag = {};
      $$('[data-bag]', el).forEach((i) => { if (i.value !== '') bag[i.dataset.bag] = Math.max(0, +i.value); });
      p.bag = bag; p.updated = Date.now();
      save(); close(); toast('Bag saved'); after?.();
    };
  });
}

function insights(s) {
  const out = [];
  if (s.putts.n >= 18 && s.threePuttsPerRound > 1.5) out.push(`<b>${fmt1(s.threePuttsPerRound)} three-putts a round.</b> Lag putting practice is the quickest saving here: each one is a shot straight back.`);
  if (s.putts.n >= 18 && s.puttsPerRound < 31) out.push(`<b>${fmt1(s.puttsPerRound)} putts a round</b> is good. The shots to find are elsewhere.`);
  if (s.fir.n >= 10) {
    const miss = s.fir.left + s.fir.right;
    if (miss && Math.max(s.fir.left, s.fir.right) / miss >= 0.65) out.push(`Missed fairways go <b>${s.fir.left > s.fir.right ? 'left' : 'right'}</b> ${Math.round((100 * Math.max(s.fir.left, s.fir.right)) / miss)}% of the time. Aim for the ${s.fir.left > s.fir.right ? 'right' : 'left'} half off the tee.`);
  }
  if (s.pensPerRound != null && s.pensPerRound >= 1) out.push(`<b>${fmt1(s.pensPerRound)} penalty shots a round.</b> A safer club off the tee near trouble would save these.`);
  const pr = [3, 4, 5].filter((k) => s.byPar[k].n >= 6).map((k) => [k, s.byPar[k].over / s.byPar[k].n]);
  if (pr.length >= 2) {
    pr.sort((a, b) => b[1] - a[1]);
    out.push(`Par ${pr[0][0]}s cost the most: <b>${pr[0][1] >= 0 ? '+' : ''}${pr[0][1].toFixed(2)}</b> a hole, against ${pr[pr.length - 1][1] >= 0 ? '+' : ''}${pr[pr.length - 1][1].toFixed(2)} on par ${pr[pr.length - 1][0]}s.`);
  }
  const blow = s.dist.triple / Math.max(1, s.holes);
  if (s.holes >= 36 && blow > 0.08) out.push(`<b>${Math.round(blow * 18 * 10) / 10} triple bogeys or worse a round.</b> Taking your medicine after a bad shot (chip out, bogey) avoids the big numbers.`);
  if (s.gir.n >= 18 && s.scramblePct != null && s.scramblePct < 20) out.push(`Getting up and down only ${pct(s.scramblePct)} of the time. Short-game practice around the green will pay off.`);
  return out.slice(0, 4);
}

function headToHead(p) {
  const rows = state.players.filter((o) => o.id !== p.id).map((o) => {
    let n = 0, won = 0, lost = 0, diff = 0;
    for (const r of state.rounds) {
      if (r.status !== 'done') continue;
      const a = r.players.findIndex((x) => x.playerId === p.id);
      const b = r.players.findIndex((x) => x.playerId === o.id);
      if (a < 0 || b < 0) continue;
      const lb = G.leaderboard(r);
      n++;
      const d = lb[a].pts - lb[b].pts;
      diff += d;
      if (d > 0) won++; else if (d < 0) lost++;
    }
    return { o, n, won, lost, diff };
  }).filter((x) => x.n);
  if (!rows.length) return '';
  return `<section class="card"><span class="eyebrow">Head to head (Stableford points)</span>
    <div class="list">${rows.map((x) => `<div class="item">${avatar(x.o, true)}<div class="grow"><b>v ${esc(x.o.name)}</b><p class="small muted">${x.n} round${x.n > 1 ? 's' : ''} together · ${x.diff >= 0 ? '+' : ''}${(x.diff / x.n).toFixed(1)} pts a round</p></div>
      <b class="bignum" style="font-size:1.5rem">${x.won}–${x.lost}</b></div>`).join('')}</div></section>`;
}

void go; void ask;
