// Tee times: plan the next round, see the forecast for it, book it, share it, add it to the calendar.
import { state, save, uid, player, course } from './store.js';
import { $, $$, esc, icon, avatar, toast, sheet, ask, fmtDate, today, shareText, download } from './ui.js';
import { fetchForecast, WMO, compass } from './geo.js';
import { prefillDraft } from './play.js';
import { go, render } from './app.js';

const at = (p) => new Date(`${p.date}T${p.time || '09:00'}:00`);

export function upcoming() {
  const now = Date.now() - 6 * 3600e3; // keep today's plan showing until the round is well under way
  return state.plans.filter((p) => at(p).getTime() > now).sort((a, b) => at(a) - at(b));
}

function countdown(p) {
  const ms = at(p) - Date.now();
  if (ms < 0) return 'today';
  const h = Math.round(ms / 3600e3);
  if (h < 1) return 'within the hour';
  if (h < 24) return `in ${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.round(h / 24);
  return `in ${d} day${d === 1 ? '' : 's'}`;
}

export function bookingLinks(c) {
  const q = encodeURIComponent(`${c?.name || ''} ${c?.town || ''} tee times`.trim());
  return `<div class="btns">
    ${c?.web ? `<a class="btn" href="${esc(c.web)}" target="_blank" rel="noopener">${icon('flag')} Book on the club website</a>` : ''}
    <a class="btn" href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener">${icon('search')} Find tee times online</a>
  </div>`;
}

// Home-screen card for the next planned round
export function nextPlanCard() {
  const p = upcoming()[0];
  if (!p) {
    return `<button class="card flat" id="plan-new" style="text-align:left;cursor:pointer;flex-direction:row;align-items:center">${icon('trip', 'width="26"')}<div class="grow"><b>Plan the next round</b><p class="small muted">Tee time, who's playing, the forecast and a calendar reminder.</p></div>${icon('plus', 'width="22"')}</button>`;
  }
  const c = course(p.courseId);
  const when = at(p);
  return `<section class="card" id="plan-card">
    <div class="row between" style="align-items:flex-start"><div><span class="eyebrow">Next tee time · ${countdown(p)}</span>
      <h2>${esc(when.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))}, ${esc(p.time || '')}</h2>
      <p class="small muted">${esc(c?.name || 'Course to be decided')}${p.ref ? ` · booking ${esc(p.ref)}` : ''}</p></div>
      <button class="btn sm ghost" id="plan-edit" aria-label="Edit tee time">${icon('edit')}</button></div>
    ${p.players?.length ? `<div class="row wrap" style="gap:6px">${p.players.map((id) => { const pl = player(id); return pl ? `<span class="chip" style="cursor:default">${avatar(pl, true)} ${esc(pl.name)}</span>` : ''; }).join('')}</div>` : ''}
    <div id="plan-wx" class="small muted">${c ? 'Loading the forecast…' : ''}</div>
    ${p.notes ? `<p class="small" style="white-space:pre-wrap">${esc(p.notes)}</p>` : ''}
    <div class="btns"><button class="btn primary" id="plan-start">${icon('flag')} Start this round</button><button class="btn" id="plan-share">${icon('share')} Tell the lads</button><button class="btn" id="plan-ics">${icon('download')} Add to calendar</button></div>
    ${bookingLinks(c)}
  </section>`;
}

export function mountPlanCard() {
  $('#plan-new')?.addEventListener('click', () => editPlan());
  const p = upcoming()[0];
  if (!p) return;
  const c = course(p.courseId);
  $('#plan-edit').onclick = () => editPlan(p);
  $('#plan-start').onclick = () => { prefillDraft({ courseId: p.courseId, playerIds: p.players }); go('#/new'); };
  $('#plan-share').onclick = () => shareText(planText(p));
  $('#plan-ics').onclick = () => download(`tee-time-${p.date}.ics`, ics(p), 'text/calendar');
  if (c && navigator.onLine) forecastInto($('#plan-wx'), p, c);
}

async function forecastInto(el, p, c) {
  const days = (at(p) - Date.now()) / 864e5;
  if (days > 15.5) { el.textContent = 'The forecast appears 16 days before the round.'; return; }
  try {
    const f = await fetchForecast([c.lat, c.lon], p.date);
    const H = f.hourly;
    const start = +(p.time || '09:00').slice(0, 2);
    const idx = H.time.map((t, i) => [+t.slice(11, 13), i]).filter(([hr]) => hr >= start && hr < start + 4).map(([, i]) => i);
    if (!idx.length) { el.textContent = ''; return; }
    const i0 = idx[0];
    const rain = Math.max(...idx.map((i) => H.precipitation_probability[i] ?? 0));
    const wind = Math.round(Math.max(...idx.map((i) => H.wind_speed_10m[i])));
    const gust = Math.round(Math.max(...idx.map((i) => H.wind_gusts_10m[i])));
    const tLo = Math.round(Math.min(...idx.map((i) => H.temperature_2m[i])));
    const tHi = Math.round(Math.max(...idx.map((i) => H.temperature_2m[i])));
    el.classList.remove('muted');
    el.innerHTML = `<div class="tiles">
      <div class="tile"><span class="k">At the tee</span><span class="v" style="font-size:1.3rem">${esc(WMO(H.weather_code[i0]))}</span></div>
      <div class="tile"><span class="k">Temperature</span><span class="v">${tLo === tHi ? tLo : `${tLo}–${tHi}`}<small>°C</small></span></div>
      <div class="tile"><span class="k">Chance of rain</span><span class="v">${rain}<small>%</small></span></div>
      <div class="tile"><span class="k">Wind</span><span class="v">${wind}<small>mph ${compass(H.wind_direction_10m[i0])}</small></span><span class="tiny muted">gusts ${gust}</span></div></div>
      <p class="tiny muted">Forecast for the four hours from your tee time, at the course.</p>`;
  } catch { el.textContent = 'Forecast unavailable offline.'; }
}

function planText(p) {
  const c = course(p.courseId);
  const names = (p.players || []).map((id) => player(id)?.name).filter(Boolean);
  return `⛳ Tee time: ${at(p).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} at ${p.time}\n${c?.name || ''}${names.length ? `\nPlaying: ${names.join(', ')}` : ''}${p.ref ? `\nBooking ref: ${p.ref}` : ''}${p.notes ? `\n${p.notes}` : ''}`;
}

function ics(p) {
  const c = course(p.courseId);
  const s = at(p);
  const e = new Date(s.getTime() + 4.5 * 3600e3);
  const f = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}00`;
  const esc2 = (t) => String(t || '').replace(/[,;\\]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Fairway Book//EN', 'BEGIN:VEVENT',
    `UID:${p.id}@fairwaybook`, `DTSTAMP:${f(new Date())}`, `DTSTART;TZID=Europe/London:${f(s)}`, `DTEND;TZID=Europe/London:${f(e)}`,
    `SUMMARY:${esc2('Golf: ' + (c?.name || 'tee time'))}`, `LOCATION:${esc2(c?.name || '')}`, `DESCRIPTION:${esc2(planText(p))}`,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Tee time in 2 hours', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

export function editPlan(p) {
  const isNew = !p;
  p = p ? { ...p, players: [...(p.players || [])] } : {
    id: uid(), created: Date.now(), courseId: state.courses[0]?.id || '', date: nextSaturday(), time: '09:00',
    players: state.players.slice(0, 4).map((x) => x.id), notes: '', ref: '',
  };
  sheet(`<h2>${isNew ? 'Plan a round' : 'Tee time'}</h2>
    <label class="field">Course<select id="pl-course">${state.courses.map((c) => `<option value="${c.id}"${c.id === p.courseId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}<option value=""${!p.courseId ? ' selected' : ''}>Not decided yet</option></select></label>
    <div class="grid2"><label class="field">Date<input type="date" id="pl-date" value="${esc(p.date)}"></label><label class="field">Tee time<input type="time" id="pl-time" value="${esc(p.time)}" step="300"></label></div>
    <div class="stack"><span class="eyebrow">Who's playing</span><div class="chips">${state.players.map((x) => `<button class="chip${p.players.includes(x.id) ? ' on' : ''}" data-plp="${x.id}">${esc(x.name)}</button>`).join('')}</div></div>
    <label class="field">Booking reference<input type="text" id="pl-ref" value="${esc(p.ref || '')}" placeholder="optional"></label>
    <label class="field">Notes<textarea id="pl-notes" placeholder="Meeting at the clubhouse 8:30, buggies booked…">${esc(p.notes || '')}</textarea></label>
    <div class="btns">${isNew ? '' : '<button class="btn danger" id="pl-del">Delete</button>'}<button class="btn primary" id="pl-save">Save</button></div>`,
  (el, close) => {
    $$('[data-plp]', el).forEach((b) => (b.onclick = () => {
      const id = b.dataset.plp;
      p.players = p.players.includes(id) ? p.players.filter((x) => x !== id) : [...p.players, id];
      b.classList.toggle('on');
    }));
    $('#pl-save', el).onclick = () => {
      p.courseId = $('#pl-course', el).value; p.date = $('#pl-date', el).value || today(); p.time = $('#pl-time', el).value || '09:00';
      p.ref = $('#pl-ref', el).value.trim(); p.notes = $('#pl-notes', el).value; p.updated = Date.now();
      const i = state.plans.findIndex((x) => x.id === p.id);
      if (i >= 0) state.plans[i] = p; else state.plans.push(p);
      save(); close(); toast('Tee time saved'); render();
    };
    $('#pl-del', el)?.addEventListener('click', async () => {
      if (!(await ask('Delete this tee time?', '', 'Delete', true))) return;
      state.plans = state.plans.filter((x) => x.id !== p.id); save(); close(); render();
    });
  });
}

function nextSaturday() {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return d.toISOString().slice(0, 10);
}
