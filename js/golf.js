// Round scoring, games, handicap records and stats. Pure-ish (reads state, no DOM).
import * as W from './whs.js';
import { state, course as getCourse, player as getPlayer } from './store.js';
import { dist } from './geo.js';

export const CLUBS = ['Dr', '3W', '5W', 'Hy', '3i', '4i', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'SW', 'LW', 'Pt'];

export function teeOf(c, teeId) {
  return c?.tees?.find((t) => t.id === teeId) || c?.tees?.[0] || null;
}

// The holes in play for a round, each with its course index `i`
export function roundHoles(r, c = getCourse(r.courseId)) {
  if (!c) return [];
  const all = c.holes.map((h, i) => ({ ...h, i }));
  if (r.holesMode === 'front') return all.slice(0, 9);
  if (r.holesMode === 'back') return all.slice(9, 18);
  return all;
}

export const isNine = (r) => r.holesMode === 'front' || r.holesMode === 'back';

export function teeFigures(c, tee, r) {
  const holes = roundHoles(r, c);
  const par = holes.reduce((s, h) => s + (h.par || 4), 0);
  if (!tee) return { cr: par, slope: 113, par, estimated: true };
  if (isNine(r)) {
    const cr9 = r.holesMode === 'front' ? tee.cr9f : tee.cr9b;
    return { cr: cr9 || (tee.cr ? tee.cr / 2 : par), slope: (r.holesMode === 'front' ? tee.slope9f : tee.slope9b) || tee.slope || 113, par, estimated: !tee.cr || !tee.slope };
  }
  return { cr: tee.cr || par, slope: tee.slope || 113, par, estimated: !tee.cr || !tee.slope };
}

// Course & playing handicap for a player in a round
export function playerHandicaps(r, rp, c = getCourse(r.courseId)) {
  const tee = teeOf(c, rp.teeId);
  const f = teeFigures(c, tee, r);
  if (rp.hi == null || rp.hi === '') return { ch: null, ph: 0, ...f };
  const hi = isNine(r) ? rp.hi / 2 : rp.hi;
  const ch = Math.round(hi * (f.slope / 113) + (f.cr - f.par));
  let allowance = r.allowance ?? W.FORMATS[r.format]?.allowance ?? 100;
  const ph = Math.round(ch * allowance / 100);
  return { ch, ph, ...f };
}

// Match/four-ball formats play off the difference from the lowest playing handicap
export function strokesBase(r, c) {
  const hs = r.players.map((rp) => playerHandicaps(r, rp, c).ph);
  if (r.format === 'match' || r.format === 'fourball') {
    const low = Math.min(...hs);
    return hs.map((h) => h - low);
  }
  return hs;
}

export function strokeMap(r, c = getCourse(r.courseId)) {
  const holes = roundHoles(r, c);
  const sis = holes.map((h) => h.si);
  return strokesBase(r, c).map((ph) => W.strokesPerHole(ph, sis));
}

const sc = (rp, i) => rp.scores?.[i]?.g || null;

// Leaderboard rows for a round
export function leaderboard(r) {
  const c = getCourse(r.courseId);
  const holes = roundHoles(r, c);
  const strokes = strokeMap(r, c);
  const rows = r.players.map((rp, pi) => {
    let gross = 0, net = 0, pts = 0, thru = 0, toPar = 0, putts = 0;
    holes.forEach((h, k) => {
      const g = sc(rp, h.i);
      if (!g) return;
      thru++;
      gross += g;
      net += g - strokes[pi][k];
      toPar += g - h.par;
      pts += W.stablefordPoints(g, h.par, strokes[pi][k]);
      putts += rp.scores[h.i]?.putts || 0;
    });
    const hc = playerHandicaps(r, rp, c);
    const netToPar = toPar - strokes[pi].slice(0, holes.length).reduce((s, x, k) => s + (sc(rp, holes[k].i) ? x : 0), 0);
    return { rp, pi, player: getPlayer(rp.playerId), gross, net, pts, thru, toPar, netToPar, putts, ph: hc.ph, ch: hc.ch };
  });
  return rows;
}

export function sortRows(rows, format) {
  const key = format === 'stableford' || format === 'bbstable' ? (a, b) => b.pts - a.pts || a.gross - b.gross
    : format === 'stroke' ? (a, b) => a.netToPar - b.netToPar || a.gross - b.gross
      : (a, b) => b.pts - a.pts;
  return [...rows].sort((a, b) => (b.thru > 0) - (a.thru > 0) || key(a, b));
}

// Skins with carry-overs (net)
export function skins(r) {
  const c = getCourse(r.courseId);
  const holes = roundHoles(r, c);
  const strokes = strokeMap(r, c);
  const won = r.players.map(() => 0);
  const log = [];
  let carry = 0;
  holes.forEach((h, k) => {
    const nets = r.players.map((rp, pi) => { const g = sc(rp, h.i); return g ? g - strokes[pi][k] : null; });
    if (nets.some((x) => x == null)) { log.push({ n: h.n, pending: true }); return; }
    carry++;
    const min = Math.min(...nets);
    const winners = nets.map((x, i) => (x === min ? i : -1)).filter((i) => i >= 0);
    if (winners.length === 1) { won[winners[0]] += carry; log.push({ n: h.n, winner: winners[0], value: carry }); carry = 0; }
    else log.push({ n: h.n, halved: true, carry });
  });
  return { won, log, carry };
}

// Singles match between player a and b (indices). Returns running status.
export function matchStatus(r, a = 0, b = 1) {
  const c = getCourse(r.courseId);
  const holes = roundHoles(r, c);
  const strokes = strokeMap(r, c);
  let up = 0, played = 0;
  const log = [];
  for (let k = 0; k < holes.length; k++) {
    const h = holes[k];
    const ga = sc(r.players[a], h.i), gb = sc(r.players[b], h.i);
    if (!ga || !gb) break;
    played++;
    const na = ga - strokes[a][k], nb = gb - strokes[b][k];
    if (na < nb) up++; else if (nb < na) up--;
    log.push({ n: h.n, up });
    const left = holes.length - played;
    if (Math.abs(up) > left) return { up, played, left, done: true, text: `${Math.abs(up)}&${left}`, log };
  }
  const left = holes.length - played;
  const text = up === 0 ? 'All square' : `${Math.abs(up)} up`;
  return { up, played, left, done: left === 0, text, log };
}

// Team better-ball: teams 'A' and 'B' by rp.team
export function teamBetterBall(r) {
  const c = getCourse(r.courseId);
  const holes = roundHoles(r, c);
  const strokes = strokeMap(r, c);
  const teams = {};
  r.players.forEach((rp, pi) => { const t = rp.team || 'A'; (teams[t] ||= { pts: 0, holes: [], members: [] }).members.push(pi); });
  holes.forEach((h, k) => {
    for (const t of Object.values(teams)) {
      const pts = t.members.map((pi) => { const g = sc(r.players[pi], h.i); return g ? W.stablefordPoints(g, h.par, strokes[pi][k]) : null; });
      const nets = t.members.map((pi) => { const g = sc(r.players[pi], h.i); return g ? g - strokes[pi][k] : null; });
      const best = pts.some((x) => x != null) ? Math.max(...pts.filter((x) => x != null)) : null;
      const bestNet = nets.some((x) => x != null) ? Math.min(...nets.filter((x) => x != null)) : null;
      t.holes.push({ pts: best, net: bestNet });
      if (best != null) t.pts += best;
    }
  });
  // four-ball match play status between A and B
  let up = 0;
  if (teams.A && teams.B) {
    teams.A.holes.forEach((ha, k) => {
      const hb = teams.B.holes[k];
      if (ha.net == null || hb.net == null) return;
      if (ha.net < hb.net) up++; else if (hb.net < ha.net) up--;
    });
  }
  return { teams, up };
}

/* ---------------- Handicap records ---------------- */

// Score differential for one player's completed round (or null + reason)
export function roundDifferential(r, rp) {
  const c = getCourse(r.courseId);
  if (!c) return { diff: null, why: 'Course missing' };
  const holes = roundHoles(r, c);
  const hc = playerHandicaps(r, rp, c);
  const scores = holes.map((h) => sc(rp, h.i));
  const played = scores.filter(Boolean).length;
  const nine = isNine(r);
  if (!nine && played < 14) return { diff: null, why: `Only ${played} holes completed (need 14 for an 18-hole score)` };
  if (nine && played < 7) return { diff: null, why: `Only ${played} holes completed` };
  // NDB uses the full Course Handicap (not the playing handicap)
  const adj = W.adjustedGross(holes, scores, hc.ch);
  const pcc = +r.pcc || 0;
  if (nine) {
    if (rp.hi == null || rp.hi === '') return { diff: null, why: '9-hole scores need a Handicap Index' };
    const d9 = (113 / hc.slope) * (adj.ags - hc.cr - pcc / 2);
    const diff = W.round1(d9 + W.expectedNineDiff(+rp.hi));
    return { diff, ags: adj.ags, adj, nine: true, cr: hc.cr, slope: hc.slope, par: hc.par, estimated: hc.estimated };
  }
  const diff = W.differential(adj.ags, hc.cr, hc.slope, pcc);
  return { diff, ags: adj.ags, adj, cr: hc.cr, slope: hc.slope, par: hc.par, estimated: hc.estimated };
}

export function handicapRecords(playerId) {
  const recs = [];
  for (const r of state.rounds) {
    if (r.status !== 'done' || r.countsForHandicap === false) continue;
    const rp = r.players.find((p) => p.playerId === playerId);
    if (!rp) continue;
    const d = roundDifferential(r, rp);
    if (d.diff == null) continue;
    const c = getCourse(r.courseId);
    recs.push({ id: r.id, date: r.date, diff: d.diff, ags: d.ags, course: c?.name || '?', cr: d.cr, slope: d.slope, nine: !!d.nine, estimated: d.estimated, source: 'app' });
  }
  for (const s of state.scores) {
    if (s.playerId !== playerId) continue;
    const diff = s.diff != null && s.diff !== '' ? +s.diff : W.differential(+s.ags, +s.cr, +s.slope, +s.pcc || 0);
    recs.push({ id: s.id, date: s.date, diff, ags: s.ags, course: s.course, cr: s.cr, slope: s.slope, source: 'manual' });
  }
  return recs;
}

export function handicapFor(playerId) {
  const p = getPlayer(playerId);
  const recs = handicapRecords(playerId);
  const start = p?.startIndex != null && p.startIndex !== '' ? +p.startIndex : null;
  const h = W.handicapHistory(recs, start);
  return { ...h, records: recs, start, official: p?.officialIndex };
}

// Index to use when starting a new round: official (if entered & newer) else app-calculated
export function playingIndex(playerId) {
  const p = getPlayer(playerId);
  if (p?.useOfficial && p.officialIndex !== '' && p.officialIndex != null) return +p.officialIndex;
  const h = handicapFor(playerId);
  return h.current ?? (p?.officialIndex !== '' && p?.officialIndex != null ? +p.officialIndex : null);
}

/* ---------------- Stats ---------------- */

export function playerRounds(playerId, filter = {}) {
  return state.rounds
    .filter((r) => r.status === 'done' && r.players.some((p) => p.playerId === playerId))
    .filter((r) => !filter.courseId || r.courseId === filter.courseId)
    .filter((r) => !filter.since || r.date >= filter.since)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function playerStats(playerId, filter = {}) {
  const rounds = playerRounds(playerId, filter);
  const s = {
    rounds: rounds.length, holes: 0, rounds18: 0, grossTotals: [], ptsTotals: [], diffs: [],
    dist: { albatross: 0, eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0, triple: 0 },
    byPar: { 3: { n: 0, over: 0 }, 4: { n: 0, over: 0 }, 5: { n: 0, over: 0 } },
    putts: { n: 0, total: 0, one: 0, three: 0 }, fir: { n: 0, hit: 0, left: 0, right: 0 }, gir: { n: 0, hit: 0 },
    scramble: { n: 0, made: 0 }, sand: { n: 0, saved: 0 }, pens: 0, pensRounds: 0,
    bySi: [[0, 0], [0, 0], [0, 0]], // [overParSum, n] for SI 1-6, 7-12, 13-18
    holeAvg: {}, // courseId:holeN -> [sum, n]
    best: null, trend: [],
  };
  for (const r of rounds) {
    const c = getCourse(r.courseId);
    const holes = roundHoles(r, c);
    const pi = r.players.findIndex((p) => p.playerId === playerId);
    const rp = r.players[pi];
    const strokes = strokeMap(r, c)[pi];
    let gross = 0, pts = 0, full = true, hadPutts = false;
    holes.forEach((h, k) => {
      const e = rp.scores?.[h.i];
      const g = e?.g;
      if (!g) { full = false; return; }
      s.holes++;
      gross += g;
      pts += W.stablefordPoints(g, h.par, strokes[k]);
      const d = g - h.par;
      if (d <= -3) s.dist.albatross++; else if (d === -2) s.dist.eagle++; else if (d === -1) s.dist.birdie++;
      else if (d === 0) s.dist.par++; else if (d === 1) s.dist.bogey++; else if (d === 2) s.dist.double++; else s.dist.triple++;
      if (s.byPar[h.par]) { s.byPar[h.par].n++; s.byPar[h.par].over += d; }
      if (h.si) { const b = h.si <= 6 ? 0 : h.si <= 12 ? 1 : 2; s.bySi[b][0] += d; s.bySi[b][1]++; }
      const key = r.courseId + ':' + h.n;
      (s.holeAvg[key] ||= [0, 0, h.par, c?.name, h.n]); s.holeAvg[key][0] += g; s.holeAvg[key][1]++;
      if (e.putts != null && e.putts !== '') {
        hadPutts = true;
        s.putts.n++; s.putts.total += +e.putts;
        if (+e.putts === 1) s.putts.one++;
        if (+e.putts >= 3) s.putts.three++;
        s.gir.n++;
        const gir = g - e.putts <= h.par - 2;
        if (gir) s.gir.hit++;
        else { s.scramble.n++; if (d <= 0) s.scramble.made++; }
      }
      if (h.par >= 4 && e.fir) { s.fir.n++; if (e.fir === 'hit') s.fir.hit++; else if (e.fir === 'left') s.fir.left++; else if (e.fir === 'right') s.fir.right++; }
      if (e.sand) { s.sand.n++; if (d <= 0) s.sand.saved++; }
      if (e.pen) s.pens += +e.pen;
    });
    s.pensRounds++;
    if (full && holes.length === 18) {
      s.rounds18++;
      s.grossTotals.push(gross);
      if (!s.best || gross < s.best.gross) s.best = { gross, date: r.date, course: c?.name, id: r.id };
    }
    if (full) s.ptsTotals.push(isNine(r) ? pts * 2 : pts);
    const d = roundDifferential(r, rp);
    s.trend.push({ date: r.date, gross: full && holes.length === 18 ? gross : null, pts, diff: d.diff, course: c?.name, id: r.id });
  }
  s.trend.reverse();
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  s.avgGross = avg(s.grossTotals);
  s.avgPts = avg(s.ptsTotals);
  s.puttsPerRound = s.putts.n ? (s.putts.total / s.putts.n) * 18 : null;
  s.puttsPerHole = s.putts.n ? s.putts.total / s.putts.n : null;
  s.firPct = s.fir.n ? (100 * s.fir.hit) / s.fir.n : null;
  s.girPct = s.gir.n ? (100 * s.gir.hit) / s.gir.n : null;
  s.scramblePct = s.scramble.n ? (100 * s.scramble.made) / s.scramble.n : null;
  s.sandPct = s.sand.n ? (100 * s.sand.saved) / s.sand.n : null;
  s.threePuttsPerRound = s.putts.n ? (s.putts.three / s.putts.n) * 18 : null;
  s.pensPerRound = s.pensRounds ? s.pens / s.pensRounds : null;
  s.parAvg = Object.fromEntries(Object.entries(s.byPar).map(([k, v]) => [k, v.n ? +k + v.over / v.n : null]));
  return s;
}

// Average carry per club from GPS-marked shots
export function clubDistances(playerId) {
  const out = {};
  for (const r of state.rounds) {
    const shots = (r.shots || []).filter((x) => x.pid === playerId);
    for (let i = 0; i < shots.length - 1; i++) {
      const a = shots[i], b = shots[i + 1];
      if (!a.club || a.hole !== b.hole) continue;
      const d = dist(a.ll, b.ll);
      if (d < 5 || d > 400) continue;
      (out[a.club] ||= []).push(d);
    }
    // last marked shot on a hole that finished on the green: measure to the green centre
    const c = getCourse(r.courseId);
    const byHole = {};
    shots.forEach((s) => (byHole[s.hole] ||= []).push(s));
    for (const [hole, list] of Object.entries(byHole)) {
      const last = list[list.length - 1];
      const g = c?.holes?.[hole]?.green?.c;
      if (last?.club && last.toGreen && g) { const d = dist(last.ll, g); if (d > 5 && d < 300) (out[last.club] ||= []).push(d); }
    }
  }
  return CLUBS.filter((k) => out[k]).map((k) => {
    const a = out[k].sort((x, y) => x - y);
    return { club: k, n: a.length, avg: a.reduce((s, x) => s + x, 0) / a.length, max: a[a.length - 1], med: a[Math.floor(a.length / 2)] };
  });
}

/* ---------------- Achievements ---------------- */

export const BADGES = [
  { id: 'first', name: 'First round logged', test: (s) => s.rounds >= 1 },
  { id: 'birdie', name: 'First birdie', test: (s) => s.dist.birdie >= 1 },
  { id: 'eagle', name: 'Eagle', test: (s) => s.dist.eagle >= 1 || s.dist.albatross >= 1 },
  { id: 'ace', name: 'Hole in one', test: (s, x) => x.ace },
  { id: 'b100', name: 'Broke 100', test: (s) => s.best && s.best.gross < 100 },
  { id: 'b90', name: 'Broke 90', test: (s) => s.best && s.best.gross < 90 },
  { id: 'b80', name: 'Broke 80', test: (s) => s.best && s.best.gross < 80 },
  { id: 'p36', name: '36 points', test: (s) => s.ptsTotals.some((p) => p >= 36) },
  { id: 'p40', name: '40 points', test: (s) => s.ptsTotals.some((p) => p >= 40) },
  { id: 'sandy', name: 'Sandy (up & down from a bunker)', test: (s) => s.sand.saved >= 1 },
  { id: 'no3', name: 'No three-putts in a round', test: (s, x) => x.noThree },
  { id: 'bb', name: 'Back-to-back birdies', test: (s, x) => x.backToBack },
  { id: 'r10', name: '10 rounds', test: (s) => s.rounds >= 10 },
  { id: 'r50', name: '50 rounds', test: (s) => s.rounds >= 50 },
  { id: 'courses5', name: '5 different courses', test: (s, x) => x.courses >= 5 },
];

export function achievements(playerId) {
  const s = playerStats(playerId);
  const x = { ace: false, noThree: false, backToBack: false, courses: 0 };
  const seen = new Set();
  for (const r of playerRounds(playerId)) {
    seen.add(r.courseId);
    const c = getCourse(r.courseId);
    const holes = roundHoles(r, c);
    const rp = r.players.find((p) => p.playerId === playerId);
    let prevBirdie = false, puttsLogged = 0, threes = 0;
    holes.forEach((h) => {
      const e = rp.scores?.[h.i];
      if (!e?.g) { prevBirdie = false; return; }
      if (e.g === 1) x.ace = true;
      const b = e.g < h.par;
      if (b && prevBirdie) x.backToBack = true;
      prevBirdie = b;
      if (e.putts != null && e.putts !== '') { puttsLogged++; if (e.putts >= 3) threes++; }
    });
    if (puttsLogged >= holes.length && holes.length >= 9 && threes === 0) x.noThree = true;
  }
  x.courses = seen.size;
  return BADGES.map((b) => ({ ...b, got: !!b.test(s, x) }));
}

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}
