// GPS, distance maths and OpenStreetMap course import.

const R = 6371008.8;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

export function dist(a, b) {
  if (!a || !b) return null;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function bearing(a, b) {
  const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]));
  const x = Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) - Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export const M_TO_YD = 1.0936133;
export function fmtDist(m, units = 'yd') {
  if (m == null || isNaN(m)) return '—';
  return String(Math.round(units === 'yd' ? m * M_TO_YD : m));
}

// Local flat projection around an origin (fine for a golf hole)
function proj(origin) {
  const k = Math.cos(toRad(origin[0]));
  return (p) => [toRad(p[1] - origin[1]) * R * k, toRad(p[0] - origin[0]) * R];
}

export function centroid(poly) {
  if (!poly || !poly.length) return null;
  const pr = proj(poly[0]);
  let a = 0, cx = 0, cy = 0;
  const pts = poly.map(pr);
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const lat = poly.reduce((s, p) => s + p[0], 0) / poly.length;
    const lon = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    return [lat, lon];
  }
  cx /= 3 * a; cy /= 3 * a;
  const k = Math.cos(toRad(poly[0][0]));
  return [poly[0][0] + toDeg(cy / R), poly[0][1] + toDeg(cx / (R * k))];
}

export function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if ((yi > pt[0]) !== (yj > pt[0]) && pt[1] < ((xj - xi) * (pt[0] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Front / back of green along the line of play from `from` through the green centre.
export function frontBack(from, green) {
  if (!from || !green?.poly?.length) return { front: null, back: null };
  const c = green.c || centroid(green.poly);
  const pr = proj(from);
  const P = [0, 0];
  const C = pr(c);
  const dx = C[0], dy = C[1];
  const L = Math.hypot(dx, dy);
  if (L < 1) return { front: 0, back: 0 };
  const ux = dx / L, uy = dy / L;
  const pts = green.poly.map(pr);
  const ts = [];
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    // Intersect ray P + t*u with segment A-B
    const ex = bx - ax, ey = by - ay;
    const den = ux * ey - uy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((ax - P[0]) * ey - (ay - P[1]) * ex) / den;
    const s = ((ax - P[0]) * uy - (ay - P[1]) * ux) / den;
    if (s >= 0 && s <= 1 && t >= 0) ts.push(t);
  }
  if (!ts.length) return { front: null, back: null };
  const inside = pointInPoly(from, green.poly);
  return { front: inside ? 0 : Math.min(...ts), back: Math.max(...ts) };
}

// Nearest and furthest edge of a hazard polygon from the player (reach / carry)
export function reachCarry(from, poly) {
  if (!from || !poly?.length) return null;
  const ds = poly.map((p) => dist(from, p));
  return { reach: Math.min(...ds), carry: Math.max(...ds) };
}

export function lineLength(line) {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += dist(line[i - 1], line[i]);
  return s;
}

// Distance from point p to segment a-b, in metres
function distToSeg(p, a, b) {
  const pr = proj(p);
  const A = pr(a), B = pr(b);
  const dx = B[0] - A[0], dy = B[1] - A[1];
  const L2 = dx * dx + dy * dy;
  let t = L2 ? (-(A[0] * dx + A[1] * dy)) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(A[0] + t * dx, A[1] + t * dy);
}

export function distToLine(p, line) {
  if (!line || line.length < 2) return Infinity;
  let m = Infinity;
  for (let i = 1; i < line.length; i++) m = Math.min(m, distToSeg(p, line[i - 1], line[i]));
  return m;
}

/* ---------------- GPS ---------------- */

let watchId = null;
const listeners = new Set();
export let lastFix = null;

export function onFix(fn) {
  listeners.add(fn);
  if (lastFix) fn(lastFix);
  return () => listeners.delete(fn);
}

export function startGps() {
  if (watchId != null || !('geolocation' in navigator)) return !!navigator.geolocation;
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      lastFix = { ll: [pos.coords.latitude, pos.coords.longitude], acc: pos.coords.accuracy, t: pos.timestamp };
      listeners.forEach((f) => f(lastFix));
    },
    (err) => {
      lastFix = lastFix ? { ...lastFix, error: err.message } : { error: err.message };
      listeners.forEach((f) => f(lastFix));
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
  );
  return true;
}

export function stopGps() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

export function getOnce() {
  return new Promise((res, rej) => {
    if (lastFix?.ll && Date.now() - lastFix.t < 15000) return res(lastFix);
    navigator.geolocation.getCurrentPosition(
      (pos) => res({ ll: [pos.coords.latitude, pos.coords.longitude], acc: pos.coords.accuracy, t: pos.timestamp }),
      (e) => rej(e),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 }
    );
  });
}

/* ---------------- Screen wake lock ---------------- */
let wakeLock = null;
export async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    } else if (!on && wakeLock) {
      await wakeLock.release(); wakeLock = null;
    }
  } catch { /* not supported or refused */ }
}
document.addEventListener('visibilitychange', () => {
  if (wakeLock && document.visibilityState === 'visible') keepAwake(true);
});

/* ---------------- OpenStreetMap / Overpass ---------------- */

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function overpass(query) {
  let lastErr;
  // Busy servers answer 429/504: back off and try again, rotating through mirrors
  const tries = [...OVERPASS, ...OVERPASS];
  for (const [k, ep] of tries.entries()) {
    if (k === OVERPASS.length) await sleep(3000);
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 30000);
      const r = await fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent(query), signal: ctl.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.remark && /error|timeout/i.test(j.remark) && !j.elements?.length) throw new Error(j.remark);
      return j;
    } catch (e) { lastErr = e; }
  }
  throw new Error('OpenStreetMap servers are busy or unreachable (' + (lastErr?.message || 'unknown') + '). Try again in a minute.');
}

// Courses within radius (m) of a point
export async function findCoursesNear(ll, radius = 25000) {
  const q = `[out:json][timeout:40];(way["leisure"="golf_course"](around:${radius},${ll[0]},${ll[1]});relation["leisure"="golf_course"](around:${radius},${ll[0]},${ll[1]}););out center tags;`;
  const j = await overpass(q);
  return j.elements.filter((e) => e.tags?.name).map((e) => ({
    osm: e.type[0] + e.id, name: e.tags.name, lat: e.center.lat, lon: e.center.lon,
    holes: +e.tags.holes || null, web: e.tags.website || e.tags['contact:website'] || null,
  }));
}

// Pull every hole / green / tee / hazard for a course.
export async function fetchCourseLayout(course) {
  const [type, id] = [course.osm?.[0], course.osm?.slice(1)];
  const feats = '(way["golf"](area.a);node["golf"](area.a);relation["golf"](area.a);way["natural"="water"](area.a););out geom;';
  let j = null;
  try {
    if (type && id) {
      const sel = type === 'r' ? `relation(${id})` : `way(${id})`;
      const areaId = (type === 'r' ? 3600000000 : 2400000000) + Number(id);
      j = await overpass(`[out:json][timeout:60];area(${areaId})->.a;${feats}`);
      if (!j.elements.length) j = await overpass(`[out:json][timeout:60];${sel};map_to_area->.a;${feats}`);
    }
    if (!j || !j.elements.some((e) => e.tags?.golf === 'hole')) {
      const a = `1300,${course.lat},${course.lon}`;
      const k = await overpass(`[out:json][timeout:60];(way["golf"](around:${a});node["golf"](around:${a});way["natural"="water"](around:${a}););out geom;`);
      if (!j || k.elements.length > j.elements.length) j = k;
    }
  } catch (e) {
    // Overpass down: fall back to the main OpenStreetMap API for the area around the course
    j = await osmApiArea(course);
  }
  return parseLayout(j.elements);
}

async function osmApiArea(c) {
  const dLat = 0.011, dLon = 0.018; // roughly 2.4 x 2.4 km
  const u = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${(c.lon - dLon).toFixed(5)},${(c.lat - dLat).toFixed(5)},${(c.lon + dLon).toFixed(5)},${(c.lat + dLat).toFixed(5)}`;
  const r = await fetch(u);
  if (!r.ok) throw new Error('OpenStreetMap is not responding (HTTP ' + r.status + '). Try again later or map the greens yourself.');
  const data = await r.json();
  const nodes = new Map();
  for (const e of data.elements) if (e.type === 'node') nodes.set(e.id, e);
  const elements = [];
  for (const e of data.elements) {
    const t = e.tags || {};
    if (!t.golf && t.natural !== 'water') continue;
    if (e.type === 'node') elements.push(e);
    else if (e.type === 'way') {
      const geometry = e.nodes.map((id) => nodes.get(id)).filter(Boolean).map((n) => ({ lat: n.lat, lon: n.lon }));
      if (geometry.length) elements.push({ type: 'way', id: e.id, tags: t, geometry });
    }
  }
  return { elements };
}

const ll = (g) => g.map((p) => [p.lat, p.lon]);

export function parseLayout(elements) {
  const holes = [], greens = [], tees = [], hazards = [], pins = [];
  for (const e of elements) {
    const t = e.tags || {};
    const g = t.golf;
    let geom = e.geometry ? ll(e.geometry) : e.lat != null ? [[e.lat, e.lon]] : null;
    if (!geom && e.members) {
      const outer = e.members.find((m) => m.role === 'outer' && m.geometry);
      if (outer) geom = ll(outer.geometry);
    }
    if (!geom) continue;
    if (g === 'hole') holes.push({ ref: parseInt(t.ref, 10), par: +t.par || null, si: +t.handicap || +t.stroke_index || null, line: geom, name: t.name, dist: t.dist ? +t.dist : null });
    else if (g === 'green') greens.push({ poly: geom, c: centroid(geom) });
    else if (g === 'tee') tees.push({ poly: geom, c: geom.length > 1 ? centroid(geom) : geom[0], colour: t['tee'] || t.colour || null });
    else if (g === 'pin') pins.push({ ll: geom[0], ref: parseInt(t.ref, 10) });
    else if (g === 'bunker' || g === 'water_hazard' || g === 'lateral_water_hazard' || t.natural === 'water') {
      if (geom.length > 2) hazards.push({ type: g === 'bunker' ? 'bunker' : 'water', poly: geom, c: centroid(geom) });
    }
  }
  const layouts = splitLayouts(holes.filter((h) => !isNaN(h.ref) && h.ref > 0))
    .map((usable) => usable.map((h) => buildHole(h, greens, pins, hazards)));
  return {
    layouts, holes: layouts[0] || [],
    // loose features, used when holes have to be mapped by hand
    greens: greens.map((gr) => ({ poly: simplify(gr.poly, 40), c: gr.c })),
    hazards: hazards.map((z) => ({ type: z.type, poly: simplify(z.poly, 30), c: z.c })),
    counts: { holes: holes.length, greens: greens.length, hazards: hazards.length },
  };
}

// Clubs with several courses (e.g. three 18s) number every course 1-18. Chain holes into
// routings: each next hole is the one whose tee is nearest the previous green.
function splitLayouts(holes) {
  const byRef = {};
  for (const h of holes) (byRef[h.ref] ||= []).push(h);
  const refs = Object.keys(byRef).map(Number).sort((a, b) => a - b);
  if (!refs.length) return [];
  if (refs.every((r) => byRef[r].length === 1)) return [refs.map((r) => byRef[r][0])];
  const starts = byRef[refs[0]];
  const used = new Set();
  const chains = starts.map((s) => {
    const chain = [s];
    used.add(s);
    for (const r of refs.slice(1)) {
      const prev = chain[chain.length - 1];
      const end = prev.line[prev.line.length - 1];
      let best = null, bd = Infinity;
      for (const c of byRef[r]) {
        const d = dist(end, c.line[0]) + (used.has(c) ? 400 : 0);
        if (d < bd) { bd = d; best = c; }
      }
      if (!best || bd > 900) continue;
      chain.push(best); used.add(best);
    }
    return chain;
  });
  // Drop chains that borrow holes from a better one (e.g. a par-3 nine joined onto the main back nine)
  const out = [];
  const taken = new Set();
  for (const c of chains.filter((x) => x.length >= 6).sort((a, b) => b.length - a.length)) {
    const own = c.filter((h) => !taken.has(h));
    if (own.length < c.length - 2) {
      if (own.length >= 6) out.push(own);
    } else out.push(c);
    c.forEach((h) => taken.add(h));
  }
  return out;
}

function buildHole(h, greens, pins, hazards) {
  const end = h.line[h.line.length - 1];
  const start = h.line[0];
  // green: one containing or nearest to the end of the hole line
  let green = null, best = Infinity;
  for (const gr of greens) {
    const d = pointInPoly(end, gr.poly) ? 0 : dist(end, gr.c);
    if (d < best) { best = d; green = gr; }
  }
  if (best > 60) green = null;
  const pin = pins.find((p) => p.ref === h.ref && dist(p.ll, end) < 60);
  const len = lineLength(h.line);
  let par = h.par;
  if (!par) par = len < 230 ? 3 : len < 430 ? 4 : 5;
  // hazards near this hole's line of play
  const hz = hazards.filter((z) => distToLine(z.c, h.line) < 45).map((z) => ({ type: z.type, poly: simplify(z.poly, 40) }));
  return {
    n: h.ref, par, si: h.si, parFromOsm: !!h.par, siFromOsm: !!h.si,
    tee: start, line: h.line,
    green: green ? { poly: simplify(green.poly, 40), c: pin?.ll || green.c } : { poly: null, c: end },
    lengthM: Math.round(len),
    hazards: hz,
  };
}

// Hazards along a hand-mapped hole (straight line tee to green)
export function hazardsForLine(all, line) {
  return (all || []).filter((z) => distToLine(z.c, line) < 45).map((z) => ({ type: z.type, poly: z.poly }));
}

// Keep polygons small for storage: take at most `max` evenly spaced vertices
function simplify(poly, max) {
  if (poly.length <= max) return poly.map((p) => [+p[0].toFixed(6), +p[1].toFixed(6)]);
  const step = poly.length / max;
  const out = [];
  for (let i = 0; i < max; i++) { const p = poly[Math.floor(i * step)]; out.push([+p[0].toFixed(6), +p[1].toFixed(6)]); }
  return out;
}

// Work out which hole the player is most likely on
export function nearestHole(holes, here) {
  let best = null, bd = Infinity;
  for (const h of holes) {
    if (!h.line) continue;
    const d = distToLine(here, h.line);
    if (d < bd) { bd = d; best = h; }
  }
  return bd < 120 ? best : null;
}

/* ---------------- Weather (Open-Meteo, no key needed) ---------------- */
export async function fetchWeather(ll) {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${ll[0].toFixed(3)}&longitude=${ll[1].toFixed(3)}&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,weather_code&hourly=temperature_2m,precipitation_probability,wind_speed_10m,weather_code&forecast_days=3&wind_speed_unit=mph&timezone=Europe%2FLondon`;
  const r = await fetch(u);
  if (!r.ok) throw new Error('Weather unavailable');
  return r.json();
}

export const WMO = (c) => (c === 0 ? 'Clear' : c <= 2 ? 'Partly cloudy' : c === 3 ? 'Overcast' : c <= 48 ? 'Fog' : c <= 57 ? 'Drizzle' : c <= 67 ? 'Rain' : c <= 77 ? 'Snow' : c <= 82 ? 'Showers' : c <= 86 ? 'Snow showers' : 'Thunderstorm');

export function compass(deg) {
  return ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(deg / 22.5) % 16];
}
