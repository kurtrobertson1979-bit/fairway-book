// Looking back at a round: hole-by-hole breakdown with plain-English scoring, plus the
// "How scoring works" guide for golfers new to handicaps and Stableford.
import { state, player, course } from './store.js';
import { $, $$, esc, icon, avatar, sheet, scoreMark, toParText } from './ui.js';
import * as G from './golf.js';
import * as W from './whs.js';

const ord = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function scoreName(g, par) {
  if (!g) return '';
  if (g === 1) return 'hole in one';
  const d = g - par;
  return { '-3': 'albatross', '-2': 'eagle', '-1': 'birdie', 0: 'par', 1: 'bogey', 2: 'double bogey', 3: 'triple bogey' }[d] || (d > 3 ? `${d} over par` : 'better than an albatross');
}

const netName = (d) => ({ '-3': 'net albatross', '-2': 'net eagle', '-1': 'net birdie', 0: 'net par', 1: 'net bogey', 2: 'net double bogey' }[d] || (d > 2 ? `${d} over net par` : `${-d} under net par`));

// One hole for one player, worked out in words
export function holeFacts(r, pi, k) {
  const c = course(r.courseId);
  const holes = G.roundHoles(r, c);
  const h = holes[k];
  const rp = r.players[pi];
  const e = rp.scores?.[h.i] || {};
  const recv = G.strokeMap(r, c)[pi][k];
  const hc = G.playerHandicaps(r, rp, c);
  const tee = G.teeOf(c, rp.teeId);
  const g = e.g || null;
  const pts = g ? W.stablefordPoints(g, h.par, recv) : 0;
  const netPar = h.par + recv;
  const ndb = W.netDoubleBogey(h.par, recv);
  return { h, e, g, recv, pts, netPar, ndb, ph: G.strokesBase(r, c)[pi], ch: hc.ch, yards: tee?.yards?.[h.i] || (h.lengthM ? Math.round(h.lengthM * 1.0936) : null) };
}

export function explainHole(r, pi, k) {
  const f = holeFacts(r, pi, k);
  const { h, g, recv, pts, netPar, ndb, ph } = f;
  const name = esc(player(r.players[pi].playerId)?.name || 'This player');
  const parts = [];
  if (recv > 0) parts.push(`${name} plays off <b>${ph}</b>, so gets <b>${plural(recv, 'shot')}</b> here (stroke index ${h.si} is one of the ${Math.min(ph, 18)} hardest holes${recv > 1 ? `, and over 18 means a second shot on the hardest ${ph - 18}` : ''}). That makes <b>net par ${netPar}</b>.`);
  else if (recv < 0) parts.push(`${name} has a plus handicap, so gives a shot back here: net par is <b>${netPar}</b>.`);
  else if (ph > 0) parts.push(`${name} plays off <b>${ph}</b>, so only gets shots on the ${ph} hardest holes (stroke index 1${ph > 1 ? `–${Math.min(ph, 18)}` : ''}). This is stroke index ${h.si ?? '–'}, so no shot here: net par is just par, <b>${netPar}</b>.`);
  else parts.push(`${name} plays off <b>0</b>, so gets no shots anywhere: net par is just par, <b>${netPar}</b>.`);
  if (!g) parts.push('No score was entered, so it scores <b>0 points</b>. For the handicap it counts as net par.');
  else if (f.e.pu) parts.push(`Picked up, so it scores <b>0 points</b>. For the handicap it counts as net double bogey (<b>${ndb}</b>).`);
  else {
    const d = g - netPar;
    const sn = scoreName(g, h.par);
    parts.push(`Took <b>${g}</b> (${/^[aeiou]/.test(sn) ? 'an' : 'a'} ${sn}). Against net par that's a <b>${netName(d)}</b>, worth <b>${plural(pts, 'point')}</b>.`);
    if (g > ndb) parts.push(`For the handicap, holes are capped at net double bogey, so this ${g} counts as <b>${ndb}</b>.`);
  }
  return parts.join(' ');
}

// Explain the current hole for everyone (live round "?" button)
export function explainSheet(r, k) {
  const c = course(r.courseId);
  const h = G.roundHoles(r, c)[k];
  sheet(`<h2>Hole ${h.n}: how it's scored</h2>
    <p class="small muted">Par ${h.par} · stroke index ${h.si ?? '–'} (1 = hardest hole on the course).</p>
    <div class="list">${r.players.map((rp, pi) => `<div class="item" style="align-items:flex-start">${avatar(player(rp.playerId), true)}<p class="small grow">${explainHole(r, pi, k)}</p></div>`).join('')}</div>
    <a class="btn" href="#/help" data-close>${icon('hcp')} How scoring works</a>`);
}

/* ---------------- round analysis ---------------- */

let anaPlayer = null;

export function analysisCard(r) {
  if (!r.players.some((rp) => rp.playerId === anaPlayer)) {
    anaPlayer = r.players.find((rp) => rp.playerId === state.settings.meId)?.playerId || r.players[0]?.playerId;
  }
  return `<section class="card" id="analysis"><div class="row between"><h2>Round analysis</h2><a class="small" href="#/help">How scoring works</a></div>
    ${r.players.length > 1 ? `<div class="chips">${r.players.map((rp) => `<button class="chip${rp.playerId === anaPlayer ? ' on' : ''}" data-ana="${rp.playerId}">${esc(player(rp.playerId)?.name || '?')}</button>`).join('')}</div>` : ''}
    <div id="ana-body">${analysisBody(r)}</div></section>`;
}

export function mountAnalysis(r) {
  $$('[data-ana]').forEach((b) => (b.onclick = () => {
    anaPlayer = b.dataset.ana;
    $$('[data-ana]').forEach((x) => x.classList.toggle('on', x === b));
    $('#ana-body').innerHTML = analysisBody(r);
  }));
}

function avgOnHole(playerId, courseId, holeN, exceptId) {
  let sum = 0, n = 0;
  for (const r of state.rounds) {
    if (r.id === exceptId || r.status !== 'done' || r.courseId !== courseId) continue;
    const rp = r.players.find((p) => p.playerId === playerId);
    const c = course(r.courseId);
    const i = c?.holes.findIndex((h) => h.n === holeN);
    const g = i >= 0 ? rp?.scores?.[i]?.g : null;
    if (g) { sum += g; n++; }
  }
  return n ? { avg: sum / n, n } : null;
}

function analysisBody(r) {
  const c = course(r.courseId);
  const pi = r.players.findIndex((rp) => rp.playerId === anaPlayer);
  if (pi < 0 || !c) return '';
  const holes = G.roundHoles(r, c);
  const facts = holes.map((_, k) => holeFacts(r, pi, k));
  const played = facts.filter((f) => f.g);
  const sum = (arr, fn) => arr.reduce((s, x) => s + (fn(x) || 0), 0);
  const gross = sum(played, (f) => f.g);
  const parPlayed = sum(played, (f) => f.h.par);
  const pts = sum(facts, (f) => f.pts);
  const shots = sum(played, (f) => f.recv);
  const putts = played.filter((f) => f.e.putts != null && f.e.putts !== '');
  const firHoles = played.filter((f) => f.h.par >= 4 && f.e.fir);
  const girKnown = putts;
  const gir = girKnown.filter((f) => f.g - f.e.putts <= f.h.par - 2).length;
  const pens = sum(played, (f) => +f.e.pen || 0);
  const half = (a, b) => facts.slice(a, b).filter((f) => f.g);
  const split = holes.length === 18 ? [['Front 9', half(0, 9)], ['Back 9', half(9, 18)]] : [];
  const mix = { 'Eagle or better': 0, Birdie: 0, Par: 0, Bogey: 0, 'Double bogey': 0, 'Triple or worse': 0 };
  played.forEach((f) => { const d = f.g - f.h.par; mix[d <= -2 ? 'Eagle or better' : d === -1 ? 'Birdie' : d === 0 ? 'Par' : d === 1 ? 'Bogey' : d === 2 ? 'Double bogey' : 'Triple or worse']++; });
  const byPar = [3, 4, 5].map((p) => { const a = played.filter((f) => f.h.par === p); return a.length ? { p, n: a.length, avg: sum(a, (f) => f.g) / a.length } : null; }).filter(Boolean);
  const best = [...played].sort((a, b) => b.pts - a.pts || (a.g - a.h.par) - (b.g - b.h.par)).slice(0, 3);
  const worst = [...played].sort((a, b) => a.pts - b.pts || (b.g - b.h.par) - (a.g - a.h.par)).slice(0, 3);

  const tile = (k, v, s = '') => `<div class="tile"><span class="k">${k}</span><span class="v">${v}</span>${s ? `<span class="tiny muted">${s}</span>` : ''}</div>`;
  return `
    <div class="tiles">
      ${tile('Strokes', gross || '—', played.length ? `${toParText(gross - parPlayed)} against par ${parPlayed}` : '')}
      ${tile('Net', played.length ? gross - shots : '—', `after ${plural(shots, 'handicap shot')}`)}
      ${tile('Stableford', pts + '<small>pts</small>', '36 = playing to your handicap')}
      ${tile('Putts', putts.length ? sum(putts, (f) => +f.e.putts) : '—', putts.length ? `${(sum(putts, (f) => +f.e.putts) / putts.length).toFixed(1)} a hole` : 'not logged')}
      ${tile('Fairways', firHoles.length ? `${firHoles.filter((f) => f.e.fir === 'hit').length}/${firHoles.length}` : '—', 'par 4s and 5s')}
      ${tile('Greens in reg.', girKnown.length ? `${gir}/${girKnown.length}` : '—', 'on in par minus 2')}
      ${pens ? tile('Penalties', pens) : ''}
    </div>
    ${split.length ? `<div class="tiles">${split.map(([l, a]) => tile(l, a.length ? sum(a, (f) => f.g) : '—', a.length ? `${toParText(sum(a, (f) => f.g - f.h.par))} · ${sum(a, (f) => f.pts)} pts` : '')).join('')}</div>` : ''}
    ${played.length ? `<div class="stack"><span class="eyebrow">Scoring mix</span><div class="chips">${Object.entries(mix).filter(([, v]) => v).map(([k, v]) => `<span class="chip" style="cursor:default">${v} × ${k}</span>`).join('')}</div></div>` : ''}
    ${byPar.length ? `<p class="small">${byPar.map((x) => `Par ${x.p}s: average <b>${x.avg.toFixed(1)}</b> (${toParText(+(x.avg - x.p).toFixed(1))})`).join(' · ')}</p>` : ''}
    ${played.length >= 6 ? `<div class="grid2">
      <div class="stack"><span class="eyebrow">Best holes</span>${best.map((f) => `<p class="small">${ord(f.h.n)}: ${f.g} on a par ${f.h.par}, ${plural(f.pts, 'pt')}</p>`).join('')}</div>
      <div class="stack"><span class="eyebrow">Toughest holes</span>${worst.map((f) => `<p class="small">${ord(f.h.n)}: ${f.g} on a par ${f.h.par}, ${plural(f.pts, 'pt')}</p>`).join('')}</div></div>` : ''}

    <div class="stack" style="gap:0">
      <div class="ana-row ana-head"><span>Hole</span><span>Par</span><span>SI</span><span>Yds</span><span>Shots</span><span>Score</span><span>Pts</span></div>
      ${facts.map((f, k) => {
        const hist = avgOnHole(anaPlayer, r.courseId, f.h.n, r.id);
        const extra = [
          f.e.putts != null && f.e.putts !== '' ? plural(+f.e.putts, 'putt') : '',
          f.h.par >= 4 && f.e.fir ? (f.e.fir === 'hit' ? 'fairway hit' : `missed fairway ${f.e.fir}`) : '',
          f.e.sand ? 'in a bunker' : '',
          f.e.pen ? plural(+f.e.pen, 'penalty shot') : '',
        ].filter(Boolean).join(' · ');
        return `<details class="ana-hole"><summary class="ana-row">
          <b>${f.h.n}</b><span>${f.h.par}</span><span>${f.h.si ?? '–'}</span><span>${f.yards ?? '–'}</span>
          <span>${f.recv > 0 ? `<span class="dots">${'<i></i>'.repeat(Math.min(f.recv, 3))}</span>` : f.recv < 0 ? '−1' : ''}</span>
          <span>${f.e.pu ? '<span class="mk">P/U</span>' : scoreMark(f.g, f.h.par)}</span><b>${f.g || f.e.pu ? f.pts : '–'}</b></summary>
          <div class="ana-explain"><p class="small">${explainHole(r, r.players.findIndex((x) => x.playerId === anaPlayer), k)}</p>
          ${extra ? `<p class="tiny muted">${extra}</p>` : ''}
          ${hist ? `<p class="tiny muted">Your average on this hole: <b>${hist.avg.toFixed(1)}</b> over ${plural(hist.n, 'other round')}.</p>` : ''}</div></details>`;
      }).join('')}
      <p class="tiny muted" style="margin-top:8px">Tap any hole to see how it was scored. Dots = handicap shots you get on that hole. Circled = under par, boxed = over par.</p>
    </div>`;
}

/* ---------------- How scoring works ---------------- */

export function helpView() {
  const me = player(state.settings.meId);
  const exPh = 22;
  return {
    title: 'How scoring works', back: true, tab: 'more',
    html: `<section class="card prose">
      <h2>Strokes and par</h2>
      <p>Every swing at the ball counts as one <b>stroke</b>, including air shots. Penalties (ball in the water, out of bounds, lost) add extra strokes. Your score on a hole is how many strokes it took to get the ball in the hole.</p>
      <p><b>Par</b> is what a good player should take: 3 on short holes, 4 on medium, 5 on long ones. Scores are named against par:</p>
      <div class="tbl-wrap"><table class="data"><tbody>
        <tr><td>2 under par</td><td><b>Eagle</b></td><td>${scoreMark(2, 4)}</td></tr>
        <tr><td>1 under par</td><td><b>Birdie</b></td><td>${scoreMark(3, 4)}</td></tr>
        <tr><td>Level</td><td><b>Par</b></td><td>${scoreMark(4, 4)}</td></tr>
        <tr><td>1 over par</td><td><b>Bogey</b></td><td>${scoreMark(5, 4)}</td></tr>
        <tr><td>2 over par</td><td><b>Double bogey</b></td><td>${scoreMark(6, 4)}</td></tr>
      </tbody></table></div>
      <p>On the scorecard, scores under par are <b>circled</b> and scores over par are <b>boxed</b>. Two rings or two boxes mean two or more under or over.</p>
    </section>

    <section class="card prose">
      <h2>Your handicap gives you shots</h2>
      <p>A handicap levels the playing field, so a beginner can play a fair game against a good player.</p>
      <p>Your <b>Handicap Index</b> (from England Golf, or worked out by this app) becomes a <b>course handicap</b> for the tees you play, and then a <b>playing handicap</b> for the format (95% for Stableford). That number is how many <b>shots</b> you get during the round.</p>
      <p>Each hole has a <b>stroke index (SI)</b> from 1 (hardest) to 18 (easiest). You get one shot on each hole from SI 1 upwards. A handicap over 18 gives a second shot on the hardest holes. In the app, the <b>dots</b> next to your name show the shots you get on that hole.</p>
      <p class="small"><b>Example:</b> playing off ${exPh}, you get one shot on every hole, plus a second shot on SI 1 to 4.</p>
      <p>Your <b>net score</b> is your strokes minus the shots you get. So a 6 on a hole where you get a shot is a net 5.</p>
    </section>

    <section class="card prose">
      <h2>Stableford points</h2>
      <p>Stableford is the most popular format for groups and club competitions. You score points on each hole based on your net score against par:</p>
      <div class="tbl-wrap"><table class="data"><thead><tr><th>Net score</th><th class="r">Points</th></tr></thead><tbody>
        <tr><td>Net double bogey or worse</td><td class="r"><b>0</b></td></tr>
        <tr><td>Net bogey</td><td class="r"><b>1</b></td></tr>
        <tr><td>Net par</td><td class="r"><b>2</b></td></tr>
        <tr><td>Net birdie</td><td class="r"><b>3</b></td></tr>
        <tr><td>Net eagle</td><td class="r"><b>4</b></td></tr>
      </tbody></table></div>
      <p><b>Worked example:</b> a par 4 with stroke index 3, playing off ${exPh}. You get 2 shots, so net par is 6.</p>
      <ul>
        <li>Take 5: that's a net birdie, <b>3 points</b></li>
        <li>Take 6: net par, <b>2 points</b></li>
        <li>Take 7: net bogey, <b>1 point</b></li>
        <li>Take 8 or more: <b>0 points</b>, so you can pick up and move on</li>
      </ul>
      <p>The highest total wins. <b>36 points</b> means you played exactly to your handicap. Because a disaster hole only costs that hole, Stableford is kind to beginners.</p>
      <p><b>Picked up (P/U):</b> if you can't score points on a hole, pick up your ball. It scores 0 points and keeps the game moving.</p>
    </section>

    <section class="card prose">
      <h2>Other formats</h2>
      <p><b>Stroke play:</b> add up every stroke. Lowest net score (strokes minus your handicap) wins. Every hole must be finished.</p>
      <p><b>Match play:</b> win, lose or halve each hole against your opponent, using net scores. "2 up" means you've won two more holes than them. "3&2" means 3 ahead with only 2 left, so the match is over.</p>
      <p><b>Better-ball:</b> play in pairs. Only the better Stableford score of the two counts on each hole.</p>
      <p><b>Skins:</b> each hole is worth a skin. Win it outright and you take it. If it's tied, the skin carries over to the next hole.</p>
    </section>

    <section class="card prose">
      <h2>How your handicap changes</h2>
      <p>After each round, the app works out a <b>score differential</b>: how well you played compared with the course's difficulty (its Course Rating and Slope). Bad holes are capped at net double bogey first, so one disaster doesn't wreck your handicap.</p>
      <p>Your <b>Handicap Index</b> is the average of your best 8 differentials from your last 20 rounds. Play better than usual and it comes down. One bad day barely moves it.</p>
      <p>The full rules are under <a href="#/more">More → How handicaps are worked out</a>.</p>
    </section>

    <section class="card prose">
      <h2>Seeing it on your own rounds</h2>
      <p>Open any finished round from <b>Home → The journey</b> and scroll to <b>Round analysis</b>. Tap a hole and the app explains in words how that hole was scored for you. During a round, tap the <b>?</b> next to the hole number for the same explanation.</p>
      ${me ? '' : '<p class="small muted">Tip: set which player is you under More → The lads, so your rounds open on you first.</p>'}
    </section>`,
  };
}
