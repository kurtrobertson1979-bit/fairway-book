// Local-first storage: the whole logbook lives in IndexedDB on the phone.
// Sharing between phones is done with share codes / backup files that merge by id.

const DB = 'fairway-book';
const STORE = 'kv';
let dbp = null;

function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

export async function kvGet(key) {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const t = d.transaction(STORE).objectStore(STORE).get(key);
      t.onsuccess = () => res(t.result);
      t.onerror = () => rej(t.error);
    });
  } catch {
    try { const v = localStorage.getItem(DB + ':' + key); return v ? JSON.parse(v) : undefined; } catch { return undefined; }
  }
}

export async function kvSet(key, val) {
  try {
    const d = await db();
    await new Promise((res, rej) => {
      const t = d.transaction(STORE, 'readwrite');
      t.objectStore(STORE).put(val, key);
      t.oncomplete = res; t.onerror = () => rej(t.error);
    });
  } catch {
    try { localStorage.setItem(DB + ':' + key, JSON.stringify(val)); } catch { /* full */ }
  }
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const state = {
  version: 1,
  settings: { units: 'yd', meId: null, autoAdvance: true, keepAwake: true, defaultFormat: 'stableford' },
  players: [],
  courses: [],
  rounds: [],
  trips: [],
  scores: [], // externally entered scores for handicap history: {id, playerId, date, course, cr, slope, ags, holes:18|9, par}
};

let saveTimer = null;
const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }

export async function load() {
  const s = await kvGet('state');
  if (s) Object.assign(state, s, { settings: { ...state.settings, ...(s.settings || {}) } });
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  return state;
}

export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => kvSet('state', JSON.parse(JSON.stringify(state))), 250);
  subs.forEach((f) => f());
}

export function saveNow() {
  clearTimeout(saveTimer);
  return kvSet('state', JSON.parse(JSON.stringify(state)));
}

export const byId = (arr, id) => arr.find((x) => x.id === id);
export const player = (id) => byId(state.players, id);
export const course = (id) => byId(state.courses, id);
export const round = (id) => byId(state.rounds, id);

/* ---------------- Merge (import from a mate's phone) ---------------- */

const stamp = (x) => x?.updated || x?.created || 0;

function mergeList(target, incoming) {
  let added = 0, updated = 0;
  for (const item of incoming || []) {
    const i = target.findIndex((x) => x.id === item.id);
    if (i < 0) { target.push(item); added++; }
    else if (stamp(item) > stamp(target[i])) { target[i] = item; updated++; }
  }
  return { added, updated };
}

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export function mergeIn(data) {
  const res = {};
  // Each phone may have added the same golfer separately: match players by name
  // and point the incoming rounds at the player already on this phone.
  const remap = {};
  for (const p of data.players || []) {
    if (state.players.some((x) => x.id === p.id)) continue;
    const same = state.players.find((x) => norm(x.name) === norm(p.name));
    if (same) remap[p.id] = same.id;
  }
  if (Object.keys(remap).length) {
    const fix = (id) => remap[id] || id;
    data = {
      ...data,
      players: data.players.filter((p) => !remap[p.id]),
      rounds: (data.rounds || []).map((r) => ({
        ...r,
        players: r.players.map((rp) => ({ ...rp, playerId: fix(rp.playerId) })),
        shots: (r.shots || []).map((s) => ({ ...s, pid: fix(s.pid) })),
      })),
      scores: (data.scores || []).map((s) => ({ ...s, playerId: fix(s.playerId) })),
    };
  }
  for (const k of ['players', 'courses', 'rounds', 'trips', 'scores']) {
    if (data[k]) res[k] = mergeList(state[k], data[k]);
  }
  save();
  return res;
}

// Bundle a round with everything needed to view it elsewhere
export function roundBundle(r) {
  const pids = r.players.map((p) => p.playerId);
  const c = course(r.courseId);
  return {
    kind: 'fairway-book', v: 1,
    rounds: [r],
    players: state.players.filter((p) => pids.includes(p.id)),
    courses: c ? [c] : [],
    trips: r.tripId ? state.trips.filter((t) => t.id === r.tripId) : [],
  };
}

export function fullBackup() {
  return { kind: 'fairway-book', v: 1, exported: new Date().toISOString(), ...JSON.parse(JSON.stringify(state)) };
}

/* ---------------- Share codes (paste into WhatsApp) ---------------- */

async function deflate(str) {
  if (!('CompressionStream' in window)) return null;
  const cs = new CompressionStream('deflate-raw');
  const buf = await new Response(new Blob([str]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(buf);
}
async function inflate(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  return new Response(new Blob([bytes]).stream().pipeThrough(ds)).text();
}
const b64 = (u8) => { let s = ''; u8.forEach((b) => (s += String.fromCharCode(b))); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64 = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(s); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); };

export async function toShareCode(obj) {
  const json = JSON.stringify(obj);
  const z = await deflate(json);
  if (z) return 'FWB1.' + b64(z);
  return 'FWB0.' + b64(new TextEncoder().encode(json));
}

export async function fromShareCode(code) {
  const m = code.trim().match(/FWB([01])\.([A-Za-z0-9_-]+)/);
  if (!m) throw new Error('That does not look like a Fairway Book share code.');
  const bytes = unb64(m[2]);
  const json = m[1] === '1' ? await inflate(bytes) : new TextDecoder().decode(bytes);
  return JSON.parse(json);
}
