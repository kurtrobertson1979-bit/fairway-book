// Live group: positions and scores shared between the lads' phones during a round.
// Messages go through the free ntfy.sh relay, encrypted on the phone with AES-GCM using a key
// derived from the group code, so the relay only ever sees scrambled data.
// The topic name is also derived from the code, so nobody can find the group without it.
import { state, save, saveNow, uid, course, mergeIn } from './store.js';

const RELAY = 'https://ntfy.sh/';
const POS_MIN_MS = 60_000; // ntfy.sh allows ~250 messages a day per phone, so positions are rationed
const POS_IDLE_MS = 150_000;
const STALE_MS = 15 * 60_000;

let group = null; // { topic, key }
let es = null;
let status = 'off'; // off | connecting | live | error
export const peers = new Map(); // playerId -> { name, colour, ll, acc, hole, roundId, ts }
const subs = new Set();
const emit = (what) => subs.forEach((f) => f(what));
export const onLive = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const liveStatus = () => status;
export const inGroup = () => !!state.settings.live?.code;
export const sharing = () => inGroup() && state.settings.live.share !== false;

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64u = (u8) => { let s = ''; u8.forEach((b) => (s += String.fromCharCode(b))); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export function newCode() {
  return b64u(crypto.getRandomValues(new Uint8Array(15)));
}

export function inviteLink(code = state.settings.live?.code) {
  return `${location.origin}${location.pathname}#/join/${code}`;
}

async function derive(code) {
  const t = await crypto.subtle.digest('SHA-256', enc.encode('fwb-topic:' + code));
  const k = await crypto.subtle.digest('SHA-256', enc.encode('fwb-key:' + code));
  return {
    topic: 'fwb' + hex(t).slice(0, 40),
    key: await crypto.subtle.importKey('raw', k, 'AES-GCM', false, ['encrypt', 'decrypt']),
  };
}

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

async function seal(obj) {
  let data = enc.encode(JSON.stringify(obj));
  const z = 'CompressionStream' in window;
  if (z) data = await pipe(data, new CompressionStream('deflate-raw'));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, group.key, data));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return (z ? 'z' : 'p') + b64u(out);
}

async function unseal(str) {
  const raw = unb64u(str.slice(1));
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, group.key, raw.slice(12)));
  const data = str[0] === 'z' ? await pipe(pt, new DecompressionStream('deflate-raw')) : pt;
  return JSON.parse(new TextDecoder().decode(data));
}

function deviceId() {
  if (!state.settings.deviceId) { state.settings.deviceId = uid(); save(); }
  return state.settings.deviceId;
}

/* ---------------- connection ---------------- */

export async function connect() {
  disconnect();
  const code = state.settings.live?.code;
  if (!code || !window.crypto?.subtle || !window.EventSource) return;
  status = 'connecting'; emit('status');
  group = await derive(code);
  es = new EventSource(`${RELAY}${group.topic}/sse?since=12h`);
  es.onopen = () => { status = 'live'; emit('status'); };
  es.onerror = () => { status = navigator.onLine ? 'connecting' : 'error'; emit('status'); };
  es.onmessage = async (ev) => {
    try {
      const m = JSON.parse(ev.data);
      if (m.event && m.event !== 'message') return;
      let body = m.message;
      if (m.attachment?.url) body = await (await fetch(m.attachment.url)).text();
      if (!body || !/^[zp]/.test(body)) return;
      await handle(await unseal(body));
    } catch { /* not ours, or tampered: ignore */ }
  };
}

export function disconnect() {
  es?.close(); es = null; group = null; status = 'off'; emit('status');
}

export async function join(code) {
  state.settings.live = { code, share: true, joined: Date.now() };
  await saveNow();
  await connect();
}

export function leave() {
  delete state.settings.live;
  peers.clear();
  save();
  disconnect();
}

async function send(obj) {
  if (!group) return false;
  const body = await seal({ ...obj, from: deviceId(), ts: Date.now() });
  try {
    const r = await fetch(RELAY + group.topic, { method: 'POST', body });
    return r.ok;
  } catch { return false; }
}

/* ---------------- incoming ---------------- */

async function handle(msg) {
  if (!msg || msg.from === deviceId()) return;
  if (msg.t === 'pos') {
    if (Date.now() - msg.ts > STALE_MS) return;
    const prev = peers.get(msg.pid);
    if (prev && prev.ts > msg.ts) return;
    peers.set(msg.pid, { name: msg.name, colour: msg.colour, ll: msg.ll, acc: msg.acc, hole: msg.hole, roundId: msg.rid, ts: msg.ts });
    emit('pos');
  } else if (msg.t === 'round' && msg.round) {
    // A built-in course the receiver hasn't added yet: add it now
    if (!course(msg.round.courseId)) {
      if (msg.courseOsm) {
        const { installPack } = await import('./courses.js');
        await installPack(msg.courseOsm);
      }
      if (!course(msg.round.courseId) && msg.courseStub) mergeIn({ courses: [msg.courseStub] });
    }
    mergeIn({ players: msg.players || [], rounds: [msg.round], trips: msg.trips || [] });
    emit('round');
  }
}

/* ---------------- outgoing ---------------- */

let lastPos = null;
export function sharePosition(fix, r, holeNo) {
  if (!sharing() || !fix?.ll || !group) return;
  const me = state.players.find((p) => p.id === state.settings.meId);
  if (!me) return;
  const now = Date.now();
  if (lastPos) {
    const moved = Math.hypot((fix.ll[0] - lastPos.ll[0]) * 111320, (fix.ll[1] - lastPos.ll[1]) * 69000);
    const age = now - lastPos.t;
    if (age < POS_MIN_MS || (moved < 25 && age < POS_IDLE_MS)) return;
  }
  lastPos = { ll: fix.ll, t: now };
  send({ t: 'pos', pid: me.id, name: me.name, colour: me.colour, ll: fix.ll.map((x) => +x.toFixed(6)), acc: Math.round(fix.acc || 0), hole: holeNo ?? null, rid: r?.id || null });
}

const roundTimers = {};
export function shareRound(r) {
  if (!inGroup() || !group || !r) return;
  clearTimeout(roundTimers[r.id]);
  roundTimers[r.id] = setTimeout(() => sendRound(r), 4000);
}

async function sendRound(r) {
  const c = course(r.courseId);
  const slim = { ...JSON.parse(JSON.stringify(r)), shots: [] };
  delete slim.currentHole; // each phone keeps its own hole
  const players = state.players.filter((p) => r.players.some((rp) => rp.playerId === p.id))
    .map(({ id, name, colour, officialIndex, created, updated }) => ({ id, name, colour, officialIndex, created, updated }));
  const msg = { t: 'round', round: slim, players };
  if (c?.pack) msg.courseOsm = c.osm;
  else if (c) {
    // Scorecard only (no maps) so the leaderboard works on phones without the course
    msg.courseStub = {
      id: c.id, name: c.name, lat: c.lat, lon: c.lon, osm: c.osm, stub: true, updated: 0, created: 0,
      tees: c.tees.map(({ id, name, colour, cr, slope, cr9f, cr9b, slope9f, slope9b }) => ({ id, name, colour, cr, slope, cr9f, cr9b, slope9f, slope9b })),
      holes: c.holes.map(({ n, par, si }) => ({ n, par, si })),
    };
  }
  await send(msg);
}

export function peerList() {
  const now = Date.now();
  return [...peers.entries()].filter(([, p]) => now - p.ts < STALE_MS).map(([pid, p]) => ({ pid, ...p }));
}
