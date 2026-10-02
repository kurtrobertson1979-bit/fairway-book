// World Handicap System (WHS) maths, as administered by England Golf / Scottish Golf.
// Pure functions only, no DOM, so they can be unit-tested in Node.
//
// References:
//  - Handicap Index = average of the best 8 of the most recent 20 Score Differentials
//  - Score Differential = (113 / Slope) x (Adjusted Gross Score - Course Rating - PCC)
//  - Course Handicap = Handicap Index x (Slope / 113) + (Course Rating - Par)
//  - Net Double Bogey (max hole score) = Par + 2 + handicap strokes received on that hole
//  - Soft cap (+3.0 then 50%) and hard cap (+5.0) against the Low Handicap Index of the last 365 days
//  - Exceptional Score Reduction: -1.0 when a differential is 7.0-9.9 below the index, -2.0 when 10.0+
//  - 9-hole scores (2024 rules): 9-hole differential + expected differential for the other 9
//    expected 9-hole differential = (Handicap Index x 0.52) + 1.2

export const MAX_HI = 54;

// How many differentials count, and the adjustment, for records with fewer than 20 scores.
export const FEWER_THAN_20 = {
  3: [1, -2], 4: [1, -1], 5: [1, 0], 6: [2, -1], 7: [2, 0], 8: [2, 0],
  9: [3, 0], 10: [3, 0], 11: [3, 0], 12: [4, 0], 13: [4, 0], 14: [4, 0],
  15: [5, 0], 16: [5, 0], 17: [6, 0], 18: [6, 0], 19: [7, 0], 20: [8, 0],
};

export const round1 = (x) => Math.round(x * 10 + Number.EPSILON * Math.sign(x)) / 10;

export function differential(ags, cr, slope, pcc = 0) {
  return round1((113 / slope) * (ags - cr - pcc));
}

export function courseHandicap(hi, slope, cr, par) {
  if (hi == null || isNaN(hi)) return null;
  return Math.round(hi * (slope / 113) + (cr - par));
}

export function playingHandicap(ch, allowancePct) {
  if (ch == null) return null;
  return Math.round(ch * (allowancePct / 100));
}

// Strokes received on each hole for a given handicap. `sis` = stroke index per hole
// (1 = hardest). For 9-hole play pass only the 9 holes' SIs; they are ranked within the nine.
// Plus handicaps (negative) give strokes back starting from the easiest hole.
export function strokesPerHole(hcp, sis) {
  const n = sis.length;
  const out = new Array(n).fill(0);
  if (!hcp || !n) return out;
  const order = sis.map((si, i) => [si ?? 99, i]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  if (hcp > 0) {
    for (let k = 0; k < hcp; k++) out[order[k % n]] += 1;
  } else {
    for (let k = 0; k < -hcp; k++) out[order[n - 1 - (k % n)]] -= 1;
  }
  return out;
}

export function netDoubleBogey(par, strokes) {
  return par + 2 + strokes;
}

export function stablefordPoints(gross, par, strokes) {
  if (gross == null || gross === 0) return 0; // 0 / blank = no return (picked up)
  return Math.max(0, 2 + par + strokes - gross);
}

// Adjusted Gross Score for handicap purposes.
// holes: [{par, si}] for the holes played; scores: gross per hole (null/0 = not completed);
// ch: course handicap for this set of holes (null when the player has no index yet).
// Returns {ags, holesCompleted, adjustedHoles:[...]} or null if too few holes.
export function adjustedGross(holes, scores, ch) {
  const strokes = strokesPerHole(ch ?? 0, holes.map((h) => h.si));
  let total = 0, completed = 0;
  const adjusted = holes.map((h, i) => {
    const g = scores[i];
    const cap = ch == null ? h.par + 5 : netDoubleBogey(h.par, strokes[i]);
    if (g == null || g === 0) {
      // Hole not played/completed: counts as net par
      const v = h.par + strokes[i];
      total += v;
      return { v, capped: false, netPar: true };
    }
    completed++;
    const v = Math.min(g, cap);
    total += v;
    return { v, capped: g > cap, netPar: false };
  });
  return { ags: total, holesCompleted: completed, adjusted };
}

// Expected 9-hole Score Differential for the unplayed nine (2024 WHS update)
export function expectedNineDiff(hi) {
  return hi * 0.52 + 1.2;
}

// Handicap Index from a list of differentials (most recent last). Only the last 20 are used.
export function indexFromDiffs(diffs) {
  const recent = diffs.slice(-20);
  const n = recent.length;
  if (n < 3) return { index: null, used: [], count: n };
  const [take, adj] = FEWER_THAN_20[n];
  const ranked = recent.map((d, i) => ({ d, i })).sort((a, b) => a.d - b.d);
  const used = ranked.slice(0, take);
  const avg = used.reduce((s, x) => s + x.d, 0) / take;
  // WHS truncates/rounds to one decimal place: rounding to nearest tenth
  const index = Math.min(MAX_HI, round1(avg + adj));
  return { index, used: used.map((x) => x.i + (diffs.length - n)), count: n, take, adj };
}

function applyCaps(raw, lowHI) {
  if (raw == null || lowHI == null) return { index: raw, cap: null };
  const diff = raw - lowHI;
  if (diff <= 3) return { index: raw, cap: null };
  let capped = lowHI + 3 + (diff - 3) / 2;
  let cap = 'soft';
  if (capped - lowHI > 5) { capped = lowHI + 5; cap = 'hard'; }
  return { index: round1(capped), cap };
}

/**
 * Builds a full handicap history for one player.
 * records: [{ id, date (ISO), diff (number, 18-hole equivalent before ESR), ... }] in any order.
 * startIndex: optional official index to use before the record has 3 scores.
 * Returns { current, low, history:[{...record, esr, adjDiff, indexAfter, counting}], usedIds:Set }
 */
export function handicapHistory(records, startIndex = null) {
  const recs = [...records].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((r) => ({ ...r, esrAdj: 0 }));
  const history = [];
  let current = startIndex;
  const indexLog = []; // {date, index}

  for (let k = 0; k < recs.length; k++) {
    const r = recs[k];
    const before = current;
    r.indexBefore = before;

    // Exceptional Score Reduction: compares against the index in force when the score was made
    let esr = 0;
    if (before != null) {
      const gap = before - r.diff;
      if (gap >= 10) esr = 2; else if (gap >= 7) esr = 1;
    }
    r.esr = esr;
    if (esr) {
      for (let j = Math.max(0, k - 19); j <= k; j++) recs[j].esrAdj += esr;
    }

    const adjDiffs = recs.slice(0, k + 1).map((x) => round1(x.diff - x.esrAdj));
    const calc = indexFromDiffs(adjDiffs);
    let idx = calc.index;
    if (idx == null) idx = startIndex; // not enough scores: keep official/starting index

    // Low Handicap Index needs an established record (20 scores) and looks back 365 days
    let low = null, cap = null;
    if (calc.index != null && k + 1 > 20) {
      const cutoff = new Date(new Date(r.date).getTime() - 365 * 864e5).toISOString().slice(0, 10);
      const window = indexLog.filter((x) => x.date >= cutoff && x.index != null && x.established);
      if (window.length) low = Math.min(...window.map((x) => x.index));
      const c = applyCaps(calc.index, low);
      idx = c.index; cap = c.cap;
    }
    if (idx != null) idx = Math.min(MAX_HI, idx);
    current = idx;
    indexLog.push({ date: r.date, index: idx, established: k + 1 >= 20 });
    r.indexAfter = idx;
    r.cap = cap;
    r.low = low;
    history.push(r);
  }

  // Which of the current 20 count
  const finalDiffs = recs.map((x) => round1(x.diff - x.esrAdj));
  const fin = indexFromDiffs(finalDiffs);
  const usedIds = new Set(fin.used.map((i) => recs[i].id));
  history.forEach((h, i) => { h.adjDiff = finalDiffs[i]; h.counting = usedIds.has(h.id); h.inWindow = i >= recs.length - 20; });
  const lows = indexLog.filter((x) => x.established).slice(-1);
  return { current, history, usedIds, take: fin.take, adj: fin.adj, count: fin.count, low: lows.length ? lows[0].index : null };
}

// "What do I need to shoot?" - the gross score that would produce a differential
// equal to `targetDiff` on the given tee (inverse of the differential formula).
export function scoreForDiff(targetDiff, cr, slope, pcc = 0) {
  return Math.floor(targetDiff * slope / 113 + cr + pcc);
}

// Default playing handicap allowances (WHS Appendix C recommendations)
export const FORMATS = {
  stroke:   { label: 'Stroke play',            allowance: 95, team: false },
  stableford:{ label: 'Stableford',            allowance: 95, team: false },
  bbstable: { label: 'Better-ball Stableford', allowance: 85, team: true },
  match:    { label: 'Match play (singles)',   allowance: 100, team: false },
  fourball: { label: 'Four-ball match play',   allowance: 90, team: true },
  skins:    { label: 'Skins',                  allowance: 100, team: false },
};
