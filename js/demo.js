// Made-up sample data so the stats and handicap screens can be explored before real rounds exist.

function rng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}

export function demoData() {
  const rand = rng(42);
  const pars = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5];
  const sis = [7, 15, 11, 1, 9, 3, 17, 13, 5, 8, 16, 2, 10, 4, 14, 18, 6, 12];
  const base = [51.75, -0.6];
  const holes = pars.map((par, i) => ({ n: i + 1, par, si: sis[i] }));
  const course = {
    id: 'demo_course', created: 1, name: 'Demo Park GC', lat: base[0], lon: base[1], osm: null, verified: true,
    holes, tees: [{ id: 'demo_yel', name: 'Yellow', colour: '#f2c94c', cr: 70.1, slope: 126, yards: pars.map((p) => (p === 3 ? 165 : p === 4 ? 385 : 505)) }],
  };
  const players = [
    { id: 'demo_p1', name: 'Demo Alex', colour: '#1d4f9c', officialIndex: 14.2, startIndex: 14.2, useOfficial: false, created: 1 },
    { id: 'demo_p2', name: 'Demo Sam', colour: '#c77700', officialIndex: 22.6, startIndex: 22.6, useOfficial: false, created: 1 },
    { id: 'demo_p3', name: 'Demo Jo', colour: '#5b3fa6', officialIndex: 8.9, startIndex: 8.9, useOfficial: false, created: 1 },
  ];
  const skill = { demo_p1: 0.85, demo_p2: 1.35, demo_p3: 0.55 };
  const rounds = [];
  const clubs = ['Dr', '3W', '5i', '7i', '9i', 'PW'];
  const carry = { Dr: 220, '3W': 195, '5i': 160, '7i': 138, '9i': 115, PW: 100 };
  const start = Date.now() - 120 * 864e5;
  for (let k = 0; k < 12; k++) {
    const date = new Date(start + k * 10 * 864e5).toISOString().slice(0, 10);
    const rps = players.map((p) => ({
      playerId: p.id, teeId: 'demo_yel', hi: p.officialIndex, team: 'A',
      scores: holes.map((h) => {
        const over = Math.max(-1, Math.round((rand() * 2.6 - 0.6) * skill[p.id] + (rand() < 0.07 ? 2 : 0)));
        const g = h.par + over;
        const putts = Math.max(1, Math.min(4, Math.round(1.25 + rand() * 1.2 + (over > 1 ? 0.3 : 0))));
        const fr = rand();
        return { g, putts: Math.min(putts, g - 1), fir: h.par >= 4 ? (fr < 0.48 ? 'hit' : fr < 0.8 ? 'right' : 'left') : null, sand: rand() < 0.12, pen: rand() < 0.05 ? 1 : 0 };
      }),
    }));
    const shots = [];
    holes.forEach((h, i) => {
      const cl = h.par === 3 ? clubs[3 + Math.floor(rand() * 3)] : 'Dr';
      const a = [base[0] + i * 0.004, base[1]];
      const m = carry[cl] * (0.85 + rand() * 0.25);
      const b = [a[0] + m / 111320, a[1]];
      shots.push({ pid: 'demo_p1', hole: i, ll: a, club: cl, t: 0 }, { pid: 'demo_p1', hole: i, ll: b, club: h.par === 3 ? null : clubs[2 + Math.floor(rand() * 4)], t: 1 });
    });
    rounds.push({
      id: 'demo_r' + k, created: start + k, updated: 1, date, courseId: 'demo_course', holesMode: '18', format: 'stableford', allowance: 95,
      countsForHandicap: true, pcc: 0, status: 'done', players: rps, shots, side: {}, notes: k === 11 ? 'Demo round — delete demo data from More.' : '',
    });
  }
  return { kind: 'fairway-book', v: 1, players, courses: [course], rounds, trips: [] };
}
