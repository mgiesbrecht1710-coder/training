/* Training – Gym-App. Speicher: zuerst auf dem Handy (offline), dann Supabase (Sicherung).
   Gleiches Konto wie das Fahrtenbuch, aber eigene Tabellen (gym_*) und eigener Login-Speicher. */
'use strict';

const SUPA_URL = 'https://pzykoskxykhqshivdfgw.supabase.co';
const SUPA_KEY = 'sb_publishable_3IruEqVDmsWoMwfTOQbZnA_Vg-n5nIg';
const BUCKET = 'gym-photos';
const sb = supabase.createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'gym-auth' } });

const EX_COLS = ['id','name','muscle','illus','sets','reps','weight','rest_sec','setting','howto','photo_path','position','bodyweight','deleted','updated_at'];
const WO_COLS = ['id','started_at','ended_at','warmup_sec','entries','mood','note','body_weight','photo_path','deleted','updated_at'];
const MUSCLES = ['Rücken','Brust','Beine','Schulter','Arme','Bauch','Po','Cardio','Ganzkörper'];
const MOODS = ['😩','😕','🙂','😀','🔥'];

const $ = (id) => document.getElementById(id);
const h = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const num = (v) => { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; };
const fmt = (n, d = 1) => n == null ? '–' : Number(n).toLocaleString('de-DE', { maximumFractionDigits: d });
const kgStr = (n) => n == null ? '' : String(Math.round(n * 100) / 100).replace('.', ',');
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
}
const nowIso = () => new Date().toISOString();
const dayStr = (d) => new Date(d).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
const mmss = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const vib = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };

/* ---------------- lokaler Speicher ---------------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem('gym.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('gym.' + k, JSON.stringify(v)); } catch {} },
  clearAll() { try { Object.keys(localStorage).filter(k => k.startsWith('gym.')).forEach(k => localStorage.removeItem(k)); } catch {} },
};
let EX = LS.get('ex', {});          // Übungen
let WO = LS.get('wo', {});          // Trainings
let SET = LS.get('set', { rest_sec: 90, warmup_min: 10, seeded: false, updated_at: null });
let Q = LS.get('q', { ex: [], wo: [], set: false });
let ACT = LS.get('active', null);   // laufendes Training
let user = null, tab = LS.get('tab', 'home');
const save = () => { LS.set('ex', EX); LS.set('wo', WO); LS.set('set', SET); LS.set('q', Q); };
const saveAct = () => LS.set('active', ACT);

function putEx(e) { e.updated_at = nowIso(); EX[e.id] = e; if (!Q.ex.includes(e.id)) Q.ex.push(e.id); save(); sync(); }
function putWo(w) { w.updated_at = nowIso(); WO[w.id] = w; if (!Q.wo.includes(w.id)) Q.wo.push(w.id); save(); sync(); }
function putSet() { SET.updated_at = nowIso(); Q.set = true; save(); sync(); }

const exercises = () => Object.values(EX).filter(e => !e.deleted).sort((a, b) => a.position - b.position);
const workouts = () => Object.values(WO).filter(w => !w.deleted && w.ended_at).sort((a, b) => b.started_at.localeCompare(a.started_at));

/* ---------------- Fotos: IndexedDB-Cache + Upload-Warteschlange ---------------- */
let idbP = null;
function idb() {
  if (!idbP) idbP = new Promise((res, rej) => {
    const r = indexedDB.open('gym', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('blobs');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return idbP;
}
async function idbDo(mode, fn) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('blobs', mode); const st = tx.objectStore('blobs'); const r = fn(st); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); }); }
const idbPut = (path, blob, pending) => idbDo('readwrite', st => st.put({ blob, pending }, path));
const idbGet = (path) => idbDo('readonly', st => st.get(path));
const idbDel = (path) => idbDo('readwrite', st => st.delete(path));
async function idbPending() {
  const db = await idb();
  return new Promise((res) => { const out = []; const tx = db.transaction('blobs', 'readonly'); tx.objectStore('blobs').openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { if (c.value.pending) out.push([c.key, c.value.blob]); c.continue(); } else res(out); }; tx.onerror = () => res(out); });
}
const urlMemo = {};
async function photoUrl(path) {
  if (!path) return null;
  if (urlMemo[path]) return urlMemo[path];
  try {
    let rec = await idbGet(path);
    if (!rec && user && navigator.onLine !== false) {
      const { data, error } = await sb.storage.from(BUCKET).download(path);
      if (error || !data) return null;
      await idbPut(path, data, false); rec = { blob: data };
    }
    if (!rec) return null;
    return (urlMemo[path] = URL.createObjectURL(rec.blob));
  } catch { return null; }
}
function hydrate(root) {
  (root || document).querySelectorAll('img[data-path]').forEach(async (img) => {
    const u = await photoUrl(img.dataset.path);
    if (u) { img.src = u; img.hidden = false; const fb = img.parentElement && img.parentElement.querySelector('.fallback'); if (fb) fb.remove(); }
  });
}
async function compress(file, max, q = 0.82, mirror = false) {
  const src = file instanceof HTMLCanvasElement ? file : await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const w0 = src.naturalWidth || src.width, h0 = src.naturalHeight || src.height, k = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement('canvas'); c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
  const x = c.getContext('2d'); if (mirror) { x.translate(c.width, 0); x.scale(-1, 1); }
  x.drawImage(src, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', q));
}
async function storePhoto(path, blob) { await idbPut(path, blob, true); delete urlMemo[path]; sync(); }
function pickFile(capture) {
  return new Promise((res) => {
    const f = $('fileIn'); f.value = '';
    if (capture) f.setAttribute('capture', capture); else f.removeAttribute('capture');
    f.onchange = () => res(f.files && f.files[0] || null);
    f.click();
  });
}

/* ---------------- Sync ---------------- */
let syncing = false, again = false, syncOk = null, lastSyncAt = null;
async function sync() {
  if (!user) return;
  if (syncing) { again = true; return; }
  syncing = true; again = false;
  try {
    for (const [path, blob] of await idbPending()) {
      const { error } = await sb.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
      if (error) throw error;
      await idbPut(path, blob, false);
    }
    const pick = (o, cols) => { const r = {}; cols.forEach(c => { if (o[c] !== undefined) r[c] = o[c]; }); return r; };
    for (const [key, table, cols, store] of [['ex', 'gym_exercises', EX_COLS, EX], ['wo', 'gym_workouts', WO_COLS, WO]]) {
      if (!Q[key].length) continue;
      const sent = Q[key].map(id => [id, store[id] && store[id].updated_at]);
      const rows = Q[key].map(id => store[id]).filter(Boolean).map(o => pick(o, cols));
      if (rows.length) { const { error } = await sb.from(table).upsert(rows); if (error) throw error; }
      Q[key] = Q[key].filter(id => !sent.some(([sid, st]) => sid === id && store[id] && store[id].updated_at === st));
      save();
    }
    if (Q.set) {
      const { error } = await sb.from('gym_settings').upsert({ user_id: user.id, rest_sec: SET.rest_sec, warmup_min: SET.warmup_min, seeded: SET.seeded, updated_at: SET.updated_at || nowIso() });
      if (error) throw error; Q.set = false; save();
    }
    const [ex, wo, st] = await Promise.all([
      sb.from('gym_exercises').select(EX_COLS.join(',')),
      sb.from('gym_workouts').select(WO_COLS.join(',')),
      sb.from('gym_settings').select('*').maybeSingle(),
    ]);
    if (ex.error) throw ex.error; if (wo.error) throw wo.error; if (st.error) throw st.error;
    let changed = false;
    const merge = (rows, store, q) => rows.forEach(r => {
      if (q.includes(r.id)) return;
      const l = store[r.id];
      if (!l || new Date(r.updated_at) > new Date(l.updated_at || 0)) { store[r.id] = r; changed = true; }
    });
    merge(ex.data, EX, Q.ex); merge(wo.data, WO, Q.wo);
    if (st.data && !Q.set && (!SET.updated_at || st.data.updated_at > SET.updated_at)) { SET = { rest_sec: st.data.rest_sec, warmup_min: st.data.warmup_min, seeded: st.data.seeded, updated_at: st.data.updated_at }; changed = true; }
    if (!SET.seeded && !ex.data.length && !Object.keys(EX).length) { seed(); changed = true; }
    else if (!SET.seeded && ex.data.length) { SET.seeded = true; }
    save(); syncOk = true; lastSyncAt = new Date();
    if (changed && !document.querySelector('dialog[open]') && $('run').hidden) render();
  } catch (e) { console.warn('Sync', e); syncOk = false; }
  finally { syncing = false; paintSync(); if (again) setTimeout(sync, 300); }
}
function paintSync() {
  const el = document.querySelector('.sync'); if (!el) return;
  const pending = Q.ex.length + Q.wo.length + (Q.set ? 1 : 0);
  const off = syncOk === false || pending > 0;
  el.innerHTML = `<span class="dot ${off ? 'off' : ''}"></span>${syncOk === null ? 'Verbinde…' : off ? 'Offline gespeichert' : 'Gesichert'}`;
}
window.addEventListener('online', sync);
setInterval(() => { if (Q.ex.length || Q.wo.length || Q.set) sync(); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { sync(); if (ACT) lockScreen(true); } });

/* ---------------- Startplan vom Zettel ---------------- */
function seed() {
  const base = [
    ['Latziehen', 'Rücken', 'latpull', false, 'Stange etwas breiter als schulterbreit greifen. Brust raus, Stange kontrolliert zur oberen Brust ziehen, langsam wieder nach oben lassen.'],
    ['Rudern', 'Rücken', 'row', false, 'Aufrecht sitzen, Griff zum Bauch ziehen und die Schulterblätter zusammendrücken. Langsam zurück, der Rücken bleibt gerade.'],
    ['Liegestütze', 'Brust', 'pushup', true, 'Hände etwas breiter als die Schultern, Körper gerade wie ein Brett. Brust bis kurz über den Boden, dann hochdrücken. Zu schwer? Knie auf den Boden.'],
    ['Butterfly', 'Brust', 'butterfly', false, 'Rücken fest an die Lehne. Arme vor der Brust zusammenführen, kurz halten, langsam wieder öffnen.'],
    ['Beinpresse', 'Beine', 'legpress', false, 'Füße schulterbreit auf die Platte. Knie bis etwa 90° beugen und wieder wegdrücken – die Knie nicht ganz durchstrecken.'],
    ['Beinstrecker', 'Beine', 'legext', false, 'Polster vorne am Schienbein, knapp über dem Fuß. Beine strecken, kurz halten, langsam absenken.'],
    ['Seitheben', 'Schulter', 'lateral', false, 'Kurzhanteln seitlich bis Schulterhöhe heben, Ellbogen leicht gebeugt. Langsam absenken, nicht schwingen.'],
  ];
  base.forEach(([name, muscle, illus, bw, howto], i) => {
    const e = { id: uuid(), name, muscle, illus, bodyweight: bw, sets: 3, reps: 15, weight: null, rest_sec: null, setting: '', howto, photo_path: null, position: i, deleted: false, updated_at: nowIso() };
    EX[e.id] = e; Q.ex.push(e.id);
  });
  SET.seeded = true; SET.updated_at = nowIso(); Q.set = true; save(); setTimeout(sync, 50);
}

/* ---------------- Auswertungs-Helfer ---------------- */
function lastSetsFor(exId, beforeIso) {
  for (const w of workouts()) {
    if (beforeIso && w.started_at >= beforeIso) continue;
    const en = (w.entries || []).find(x => x.exercise_id === exId);
    if (en && en.sets.some(s => s.done)) return { w, en };
  }
  return null;
}
function historyFor(exId) { // älteste zuerst
  const out = [];
  workouts().slice().reverse().forEach(w => {
    const en = (w.entries || []).find(x => x.exercise_id === exId); if (!en) return;
    const done = en.sets.filter(s => s.done); if (!done.length) return;
    const kgs = done.map(s => s.kg).filter(k => k != null && k > 0);
    out.push({ at: w.started_at, kg: kgs.length ? Math.max(...kgs) : null, reps: Math.max(...done.map(s => s.reps || 0)), totalReps: done.reduce((a, s) => a + (s.reps || 0), 0), sets: done.length });
  });
  return out;
}
function suggestion(ex) {
  const hist = [];
  for (const w of workouts()) { const en = (w.entries || []).find(x => x.exercise_id === ex.id); if (en && en.sets.some(s => s.done)) hist.push(en); if (hist.length === 2) break; }
  if (hist.length < 2) return null;
  const full = (en) => { const d = en.sets.filter(s => s.done); return d.length >= ex.sets && d.every(s => (s.reps || 0) >= ex.reps); };
  if (!hist.every(full)) return null;
  if (ex.bodyweight) return { text: 'Zweimal alle Wiederholungen geschafft – probier heute 2 mehr pro Satz.', kind: 'reps' };
  const kg = (en) => Math.max(...en.sets.filter(s => s.done).map(s => s.kg || 0));
  if (kg(hist[0]) > 0 && kg(hist[0]) >= kg(hist[1])) return { text: `Zweimal alle ${ex.sets}×${ex.reps} geschafft – heute +2,5 kg probieren?`, kind: 'kg' };
  return null;
}
const volume = (w) => (w.entries || []).reduce((a, en) => a + en.sets.filter(s => s.done && s.kg).reduce((b, s) => b + s.kg * (s.reps || 0), 0), 0);
const doneSets = (w) => (w.entries || []).reduce((a, en) => a + en.sets.filter(s => s.done).length, 0);
function weekKey(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toISOString().slice(0, 10); }
function weekStreak() {
  const weeks = new Set(workouts().map(w => weekKey(w.started_at)));
  let d = new Date(); let n = 0;
  if (!weeks.has(weekKey(d))) d.setDate(d.getDate() - 7);
  while (weeks.has(weekKey(d))) { n++; d.setDate(d.getDate() - 7); }
  return n;
}
function estMinutes() {
  const ex = exercises(); const rest = (e) => e.rest_sec || SET.rest_sec;
  return Math.round((SET.warmup_min * 60 + ex.reduce((a, e) => a + e.sets * (e.reps * 3 + rest(e)) + 60, 0)) / 60);
}
function ago(iso) {
  const d = Math.floor((Date.now() - new Date(iso)) / 86400000);
  return d <= 0 ? 'heute' : d === 1 ? 'gestern' : `vor ${d} Tagen`;
}
function picHtml(e, cls = 'thumb') {
  return `<span class="${cls}">${e.photo_path ? `<img data-path="${h(e.photo_path)}" alt="" hidden><span class="fallback">${ill(e.illus)}</span>` : ill(e.illus)}</span>`;
}

/* ---------------- Ansichten ---------------- */
function render() {
  document.querySelectorAll('nav.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  ({ home: renderHome, plan: renderPlan, progress: renderProgress, more: renderMore })[tab]();
  paintSync(); hydrate($('page'));
}
document.querySelectorAll('nav.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.tab; LS.set('tab', tab); render(); window.scrollTo(0, 0); });
const header = (title) => `<div class="top"><h1>${title}</h1><button class="sync" id="syncBtn" type="button"></button></div>`;
document.addEventListener('click', (e) => { if (e.target.closest('#syncBtn')) { sync(); toast(Q.ex.length + Q.wo.length ? 'Wird hochgeladen, sobald Netz da ist.' : 'Alles gesichert.'); } });

function renderHome() {
  const ex = exercises(), ws = workouts(), last = ws[0];
  const wk = weekKey(new Date()), thisWeek = ws.filter(w => weekKey(w.started_at) === wk).length, streak = weekStreak();
  let html = header('Training');
  if (ACT) {
    const doneEx = ACT.order.filter(id => ACT.entries[id] && ACT.entries[id].sets.some(s => s.done)).length;
    html += `<button class="hero" id="goRun"><b>▶ Training fortsetzen</b><span>Läuft seit ${mmss((Date.now() - new Date(ACT.started_at)) / 1000).replace(/:\d+$/, '')} Min · ${doneEx} von ${ACT.order.length} Übungen</span></button>`;
  } else {
    html += `<button class="hero" id="goRun" ${ex.length ? '' : 'disabled'}><b><svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>Training starten</b><span>${ex.length} Übungen · ca. ${estMinutes()} Min</span></button>`;
  }
  html += `<div class="stats">
    <div class="stat"><b>${thisWeek}</b><span>diese Woche</span></div>
    <div class="stat"><b>${streak}${streak >= 2 ? ' 🔥' : ''}</b><span>Wochen am Stück</span></div>
    <div class="stat"><b>${last ? ago(last.started_at) : '–'}</b><span>letztes Training</span></div></div>`;
  if (last) {
    html += `<div class="card"><div class="label">Letztes Training</div><div class="row" style="margin-top:6px;justify-content:space-between"><b>${dayStr(last.started_at)}</b><span class="muted small num">${Math.round((new Date(last.ended_at) - new Date(last.started_at)) / 60000)} Min · ${doneSets(last)} Sätze${volume(last) ? ' · ' + fmt(volume(last) / 1000, 2) + ' t' : ''}${last.mood ? ' · ' + MOODS[last.mood - 1] : ''}</span></div></div>`;
  }
  const needKg = ex.filter(e => !e.bodyweight && e.weight == null).length;
  if (needKg && !ACT) html += `<div class="notice">Bei ${needKg} Geräten ist noch kein Gewicht eingetragen. Trag es einfach beim Training im Satz ein – ab dann merkt sich die App das.</div>`;
  html += `<div class="row" style="justify-content:space-between"><h2>Heute dran</h2><button class="linkbtn" data-tab-go="plan">Plan bearbeiten</button></div><div class="exlist">`;
  ex.forEach((e, i) => { html += `<div class="ex"><span class="no">${i + 1}</span>${picHtml(e)}<span class="t"><b>${h(e.name)}</b><span>${h(e.muscle || '')} · ${e.sets}×${e.reps}${e.bodyweight ? '' : e.weight != null ? ' · ' + kgStr(e.weight) + ' kg' : ''}</span></span></div>`; });
  if (!ex.length) html += `<div class="empty">${syncOk === null ? 'Plan wird geladen…' : 'Noch keine Übungen. Leg unter „Plan“ deine Geräte an.'}</div>`;
  html += '</div>';
  $('page').innerHTML = html;
  $('goRun').onclick = () => { if (!ACT) startWorkout(); openRun(); };
  document.querySelectorAll('[data-tab-go]').forEach(b => b.onclick = () => { tab = b.dataset.tabGo; LS.set('tab', tab); render(); });
}

/* ---------- Plan bearbeiten ---------- */
function renderPlan() {
  const ex = exercises();
  let html = header('Plan') + `<p class="muted small" style="margin:-6px 0 0">Tippe auf ein Gerät zum Bearbeiten. Am Griff <b>⋮⋮</b> ziehen, um die Reihenfolge zu ändern.</p><div class="exlist" id="plist">`;
  ex.forEach((e, i) => {
    html += `<div class="ex" data-id="${e.id}"><button class="handle" aria-label="${h(e.name)} verschieben"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.8"/><circle cx="15" cy="6" r="1.8"/><circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/><circle cx="9" cy="18" r="1.8"/><circle cx="15" cy="18" r="1.8"/></svg></button>
      <button class="t" data-edit="${e.id}" style="background:none;padding:0;text-align:left;display:flex;align-items:center;gap:12px;font-weight:inherit;min-height:48px">${picHtml(e)}<span style="min-width:0"><b style="display:block">${h(e.name)}</b><span class="muted small">${h(e.muscle || '')} · ${e.sets}×${e.reps}${e.bodyweight ? ' · Körpergewicht' : e.weight != null ? ' · ' + kgStr(e.weight) + ' kg' : ''}</span></span></button></div>`;
  });
  html += `</div><button class="add" id="addEx">+ Gerät / Übung hinzufügen</button>`;
  $('page').innerHTML = html;
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editExercise(EX[b.dataset.edit]));
  $('addEx').onclick = () => editExercise(null);
  enableDrag($('plist'));
}
function enableDrag(list) {
  list.querySelectorAll('.handle').forEach(hd => {
    hd.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      const item = hd.closest('.ex'), items = [...list.children], startY = ev.clientY, hgt = item.getBoundingClientRect().height + 8;
      const from = items.indexOf(item); let to = from;
      item.classList.add('drag'); hd.setPointerCapture(ev.pointerId); vib(15);
      const move = (e) => {
        const dy = e.clientY - startY; item.style.transform = `translateY(${dy}px)`;
        to = Math.max(0, Math.min(items.length - 1, from + Math.round(dy / hgt)));
        items.forEach((it, i) => { if (it === item) return; let s = 0; if (from < to && i > from && i <= to) s = -hgt; if (from > to && i < from && i >= to) s = hgt; it.style.transition = 'transform .15s'; it.style.transform = s ? `translateY(${s}px)` : ''; });
      };
      const up = () => {
        hd.removeEventListener('pointermove', move); hd.removeEventListener('pointerup', up); hd.removeEventListener('pointercancel', up);
        items.forEach(it => { it.style.transform = ''; it.style.transition = ''; }); item.classList.remove('drag');
        if (to !== from) { const ids = items.map(i => i.dataset.id); ids.splice(to, 0, ids.splice(from, 1)[0]); reorder(ids); }
      };
      hd.addEventListener('pointermove', move); hd.addEventListener('pointerup', up); hd.addEventListener('pointercancel', up);
    });
  });
}
function reorder(ids) { ids.forEach((id, i) => { if (EX[id].position !== i) { EX[id].position = i; EX[id].updated_at = nowIso(); if (!Q.ex.includes(id)) Q.ex.push(id); } }); save(); sync(); render(); }

function stepper(id, label, val, mode, step) {
  return `<div class="stp"><span>${label}</span><div class="c"><button type="button" data-step="${id}" data-d="-${step}" aria-label="${label} weniger">−</button><input id="${id}" value="${h(val)}" placeholder="${mode === 'decimal' ? 'kg' : ''}" inputmode="${mode}" ${mode === 'numeric' ? 'pattern="[0-9]*"' : ''} autocomplete="off" enterkeyhint="done" aria-label="${label}"><button type="button" data-step="${id}" data-d="${step}" aria-label="${label} mehr">+</button></div></div>`;
}
function bindSteppers(root, onChange) {
  root.querySelectorAll('[data-step]').forEach(b => b.onclick = () => {
    const inp = root.querySelector('#' + b.dataset.step), d = parseFloat(b.dataset.d);
    let v = (num(inp.value) || 0) + d; v = Math.max(0, Math.round(v * 100) / 100);
    inp.value = inp.inputMode === 'decimal' ? kgStr(v) : String(Math.round(v)); vib(8);
    onChange && onChange(inp);
  });
  root.querySelectorAll('.stp input').forEach(inp => { inp.addEventListener('focus', () => inp.select()); inp.addEventListener('input', () => onChange && onChange(inp)); });
}

function editExercise(e) {
  const isNew = !e;
  const d = e ? { ...e } : { id: uuid(), name: '', muscle: 'Rücken', illus: 'generic', bodyweight: false, sets: 3, reps: 15, weight: null, rest_sec: null, setting: '', howto: '', photo_path: null, position: exercises().length, deleted: false };
  const list = exercises(), idx = list.findIndex(x => x.id === d.id);
  const dlg = $('dlg'); dlg.className = '';
  dlg.innerHTML = `<div class="dh"><button class="ghost" id="dClose">Abbrechen</button><b>${isNew ? 'Neues Gerät' : 'Bearbeiten'}</b><button class="primary" id="dSave">Sichern</button></div>
  <div class="db">
    <div class="field"><label for="fName">Name des Geräts / der Übung</label><input id="fName" value="${h(d.name)}" placeholder="z. B. Brustpresse" autocomplete="off"></div>
    <div class="field"><span class="label">Muskelgruppe</span><div class="chips" id="fMus">${MUSCLES.map(m => `<button type="button" class="chip" aria-pressed="${m === d.muscle}" data-m="${m}">${m}</button>`).join('')}</div></div>
    <div class="field"><span class="label">Foto vom echten Gerät</span>
      <div class="pic" id="fPic">${d.photo_path ? `<img data-path="${h(d.photo_path)}" alt="" hidden><span class="fallback">${ill(d.illus)}</span>` : ill(d.illus)}</div>
      <div class="row"><button type="button" class="grow" id="fCam">📷 Gerät fotografieren</button>${d.photo_path ? '<button type="button" class="ghost danger" id="fCamDel">Foto entfernen</button>' : ''}</div>
      <span class="small muted">Tipp: Fotografier das Gerät im Gym, dann erkennst du es sofort wieder.</span></div>
    <div class="field"><span class="label">Zeichnung</span><div class="illpick" id="fIll">${ILL_KEYS.map(k => `<button type="button" aria-pressed="${k === d.illus}" data-k="${k}" aria-label="${h(illLabel(k))}">${ill(k)}</button>`).join('')}</div></div>
    <div class="grid2">${stepper('fSets', 'Sätze', d.sets, 'numeric', 1)}${stepper('fReps', 'Wiederholungen', d.reps, 'numeric', 1)}</div>
    <label class="switch"><span><b>Mit Körpergewicht</b><br><span class="small muted">z. B. Liegestütze – kein kg-Feld</span></span><input type="checkbox" id="fBw" ${d.bodyweight ? 'checked' : ''}></label>
    <div id="fKgWrap" ${d.bodyweight ? 'hidden' : ''}>${stepper('fKg', 'Gewicht (kg)', kgStr(d.weight), 'decimal', 2.5)}</div>
    <div class="field"><label for="fSetting">Geräte-Einstellung</label><input id="fSetting" value="${h(d.setting)}" placeholder="z. B. Sitz Stufe 4, Polster Loch 6" autocomplete="off"></div>
    <div class="field"><label for="fHow">Kurze Anleitung</label><textarea id="fHow" placeholder="Worauf du achten willst">${h(d.howto)}</textarea></div>
    <div class="field"><label for="fRest">Pause nach jedem Satz</label><select id="fRest"><option value="">Standard (${SET.rest_sec} Sek.)</option>${[30, 45, 60, 75, 90, 120, 150, 180, 240].map(s => `<option value="${s}" ${d.rest_sec === s ? 'selected' : ''}>${s} Sek.</option>`).join('')}</select></div>
    ${isNew ? '' : `<div class="row"><button type="button" class="grow" id="fUp" ${idx <= 0 ? 'disabled' : ''}>↑ Nach vorne</button><button type="button" class="grow" id="fDown" ${idx >= list.length - 1 ? 'disabled' : ''}>↓ Nach hinten</button></div>
    <button type="button" class="ghost danger" id="fDel">Gerät aus dem Plan löschen</button>`}
  </div>`;
  dlg.showModal(); hydrate(dlg);
  const redrawPic = () => { $('fPic').innerHTML = d.photo_path ? `<img data-path="${h(d.photo_path)}" alt="" hidden><span class="fallback">${ill(d.illus)}</span>` : ill(d.illus); hydrate($('fPic')); };
  bindSteppers(dlg);
  $('fMus').onclick = (ev) => { const b = ev.target.closest('[data-m]'); if (!b) return; d.muscle = b.dataset.m; $('fMus').querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === b))); };
  $('fIll').onclick = (ev) => { const b = ev.target.closest('[data-k]'); if (!b) return; d.illus = b.dataset.k; $('fIll').querySelectorAll('button').forEach(c => c.setAttribute('aria-pressed', String(c === b))); if (d.illus === 'pushup' && !d.bodyweight) { $('fBw').checked = true; $('fBw').onchange(); } redrawPic(); };
  $('fBw').onchange = () => { $('fKgWrap').hidden = $('fBw').checked; };
  $('fCam').onclick = async () => {
    const f = await pickFile('environment'); if (!f || !user) return;
    const blob = await compress(f, 1000, 0.8); const path = `${user.id}/ex/${d.id}-${Date.now()}.jpg`;
    await storePhoto(path, blob); d.photo_path = path; redrawPic(); toast('Foto gespeichert');
  };
  if ($('fCamDel')) $('fCamDel').onclick = () => { d.photo_path = null; redrawPic(); $('fCamDel').remove(); };
  $('dClose').onclick = () => dlg.close();
  $('dSave').onclick = () => {
    const name = $('fName').value.trim(); if (!name) { $('fName').focus(); toast('Bitte einen Namen eingeben'); return; }
    Object.assign(d, { name, sets: Math.max(1, Math.round(num($('fSets').value) || 3)), reps: Math.max(1, Math.round(num($('fReps').value) || 10)), bodyweight: $('fBw').checked, weight: $('fBw').checked ? null : num($('fKg').value), setting: $('fSetting').value.trim(), howto: $('fHow').value.trim(), rest_sec: num($('fRest').value) });
    putEx(d); dlg.close(); render(); toast(isNew ? 'Gerät hinzugefügt' : 'Gespeichert');
  };
  if (!isNew) {
    const mv = (dir) => { const ids = list.map(x => x.id); const j = idx + dir; ids.splice(j, 0, ids.splice(idx, 1)[0]); dlg.close(); reorder(ids); };
    $('fUp').onclick = () => mv(-1); $('fDown').onclick = () => mv(1);
    $('fDel').onclick = () => { if (!confirmTap($('fDel'), 'Wirklich löschen? Nochmal tippen')) return; d.deleted = true; putEx(d); dlg.close(); render(); toast('Gelöscht – deine alten Trainings bleiben erhalten'); };
  }
}
function confirmTap(btn, text) {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = '1'; const old = btn.textContent; btn.textContent = text;
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = old; } }, 3500);
  return false;
}

/* ---------------- Trainingsmodus ---------------- */
function startWorkout() {
  const ex = exercises();
  const entries = {};
  ex.forEach(e => {
    const last = lastSetsFor(e.id);
    const sets = [];
    for (let i = 0; i < e.sets; i++) {
      const ls = last && last.en.sets.filter(s => s.done)[i];
      sets.push({ reps: e.reps, kg: e.bodyweight ? null : (ls && ls.kg != null ? ls.kg : e.weight), done: false });
    }
    entries[e.id] = { exercise_id: e.id, name: e.name, muscle: e.muscle, bodyweight: !!e.bodyweight, sets, cur: 0 };
  });
  ACT = { id: uuid(), started_at: nowIso(), step: SET.warmup_min > 0 ? 'warmup' : 'ex', warmupEnd: null, warmupSec: 0, order: ex.map(e => e.id), idx: 0, entries, rest: null, mood: null, note: '', body_weight: null, photo_path: null };
  saveAct();
}
let wakeLock = null;
async function lockScreen(on) {
  try {
    if (on && 'wakeLock' in navigator && !document.hidden) { if (!wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } }
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch {}
}
function openRun() { $('run').hidden = false; $('vMain').hidden = true; lockScreen(true); renderRun(); }
function closeRun() { $('run').hidden = true; $('vMain').hidden = false; lockScreen(false); render(); }

let audio = null;
function beep() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.22, 0.44].forEach((t, i) => { const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = i === 2 ? 1100 : 880; g.gain.setValueAtTime(0.0001, audio.currentTime + t); g.gain.exponentialRampToValueAtTime(0.35, audio.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + 0.18); o.connect(g).connect(audio.destination); o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.2); });
  } catch {}
}
const unlockAudio = () => { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch {} };

function progressBar() {
  return `<div class="bar">${ACT.order.map((id, i) => { const en = ACT.entries[id]; const d = en && en.sets.length && en.sets.every(s => s.done); return `<i class="${ACT.step === 'ex' && i === ACT.idx ? 'c' : d ? 'd' : ''}"></i>`; }).join('')}</div>`;
}
function renderRun() {
  if (!ACT) return closeRun();
  const R = $('run');
  const head = (title, right = '') => `<div class="rhead"><button class="x" id="rX" aria-label="Training pausieren oder beenden"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button><button class="prog" id="rList"><span><b>${title}</b><span class="num" data-elapsed>${right}</span></span>${progressBar()}</button></div>`;
  const el = mmss((Date.now() - new Date(ACT.started_at)) / 1000);

  if (ACT.step === 'warmup') {
    const left = ACT.warmupEnd ? (ACT.warmupEnd - Date.now()) / 1000 : SET.warmup_min * 60;
    R.innerHTML = head('Aufwärmen', el) + `<div class="rbody"><div class="in warm">
      <div class="label">Schritt 1 · Aufwärmen</div>
      <div class="clock" data-warm>${mmss(left)}</div>
      <p class="muted" style="margin:0;max-width:320px">${SET.warmup_min} Minuten locker auf dem Laufband, Rad oder Crosstrainer. Puls langsam hoch, nicht auspowern.</p>
      ${ACT.warmupEnd ? '' : `<button class="primary" id="wGo" style="min-height:60px;width:100%;font-size:19px">▶ Timer starten</button>`}
    </div></div><div class="rfoot"><div class="in"><button class="grow ${ACT.warmupEnd ? 'primary' : ''}" id="wDone">${ACT.warmupEnd ? 'Fertig – zur 1. Übung →' : 'Überspringen →'}</button></div></div>`;
    bindRunHead();
    if ($('wGo')) $('wGo').onclick = () => { unlockAudio(); ACT.warmupEnd = Date.now() + SET.warmup_min * 60000; ACT.warmStart = Date.now(); saveAct(); renderRun(); };
    $('wDone').onclick = () => { ACT.warmupSec = ACT.warmStart ? Math.round((Date.now() - ACT.warmStart) / 1000) : 0; ACT.step = 'ex'; ACT.idx = 0; saveAct(); renderRun(); };
    return;
  }

  if (ACT.step === 'finish') return renderFinish();

  const id = ACT.order[ACT.idx], e = EX[id] || {}, en = ACT.entries[id];
  if (!en) { ACT.step = 'finish'; saveAct(); return renderRun(); }
  const last = lastSetsFor(id, ACT.started_at), sug = suggestion(e);
  const restSec = e.rest_sec || SET.rest_sec;
  let cur = en.sets.findIndex(s => !s.done); if (en.edit != null) cur = en.edit;
  let sets = '';
  en.sets.forEach((s, i) => {
    if (i === cur) {
      sets += `<div class="set cur"><div class="hd"><span>Satz ${i + 1} von ${en.sets.length}</span>${s.done ? '<span class="tag ok">erledigt</span>' : ''}</div>
        <div class="steppers ${en.bodyweight ? 'one' : ''}">${stepper('sReps', 'Wdh.', s.reps ?? '', 'numeric', 1)}${en.bodyweight ? '' : stepper('sKg', 'kg', kgStr(s.kg), 'decimal', 2.5)}</div>
        <button class="big-done" id="sDone">${s.done ? '✓ Übernehmen' : '✓ Satz geschafft'}</button></div>`;
    } else {
      const v = `${s.reps ?? '–'} Wdh.${en.bodyweight ? '' : ' × ' + (s.kg != null ? kgStr(s.kg) + ' kg' : '? kg')}`;
      sets += `<button class="set compact ${s.done ? 'done' : ''}" data-set="${i}"><span class="ck">${s.done ? '✓' : i + 1}</span><span>Satz ${i + 1}</span><span class="v">${v}</span></button>`;
    }
  });
  const allDone = en.sets.every(s => s.done), isLast = ACT.idx === ACT.order.length - 1;
  const lastTxt = last ? last.en.sets.filter(s => s.done).map(s => `${s.reps}${en.bodyweight || s.kg == null ? '' : '×' + kgStr(s.kg)}`).join(' · ') + (en.bodyweight ? ' Wdh.' : ' kg') : null;
  const hasPhoto = !!e.photo_path;
  R.innerHTML = head(`Übung ${ACT.idx + 1} von ${ACT.order.length}`, el) + `<div class="rbody"><div class="in">
    <div class="pic">${hasPhoto ? `<img data-path="${h(e.photo_path)}" alt="${h(e.name)}" hidden><span class="fallback">${ill(e.illus)}</span><span class="mini">${ill(e.illus)}</span>` : ill(e.illus)}</div>
    <div><div class="row" style="gap:6px;margin-bottom:6px"><span class="tag acc">${h(en.muscle || '')}</span><span class="tag">${en.sets.length}×${e.reps || ''}</span><span class="tag">Pause ${restSec} s</span></div><h2 class="exname">${h(en.name)}</h2></div>
    ${e.setting ? `<div class="setting">⚙︎ ${h(e.setting)}</div>` : ''}
    ${e.howto ? `<details class="how"><summary>So geht’s</summary><p>${h(e.howto)}</p></details>` : ''}
    ${lastTxt ? `<div class="small muted">Letztes Mal (${dayStr(last.w.started_at)}): <b class="num" style="color:var(--ink)">${h(lastTxt)}</b></div>` : `<div class="small muted">${en.bodyweight ? 'Erstes Mal – zähl einfach mit.' : 'Erstes Mal – trag beim 1. Satz dein Gewicht ein, die App merkt es sich.'}</div>`}
    ${sug && !en.sugUsed ? `<div class="tip"><span style="font-size:22px">💡</span><p>${h(sug.text)}</p><button id="sugGo">Ja</button></div>` : ''}
    <div class="sets">${sets}</div>
    <div class="row" style="justify-content:center;gap:4px"><button class="linkbtn" id="sAdd">+ Satz</button>${en.sets.length > 1 ? '<button class="linkbtn" id="sRem">− Satz</button>' : ''}</div>
  </div></div>
  <div class="rfoot"><div class="in">
    ${isLast || allDone ? '' : `<button class="ghost" id="rLater" style="flex:0 0 auto;font-size:15px">Besetzt → später</button>`}
    <button class="grow ${allDone ? 'primary' : ''}" id="rNext">${isLast ? 'Abschließen →' : allDone ? 'Nächste Übung →' : 'Weiter →'}</button>
  </div></div>
  ${ACT.rest ? restSheet() : ''}`;
  bindRunHead(); hydrate(R);

  bindSteppers(R, (inp) => {
    const s = en.sets[cur]; if (!s) return;
    if (inp.id === 'sReps') s.reps = num(inp.value) == null ? null : Math.round(num(inp.value));
    if (inp.id === 'sKg') { s.kg = num(inp.value); en.sets.forEach((o, j) => { if (j > cur && !o.done) o.kg = s.kg; }); }
    saveAct();
  });
  R.querySelectorAll('.stp input').forEach(i => i.addEventListener('keydown', ev => { if (ev.key === 'Enter') i.blur(); }));
  if ($('sDone')) $('sDone').onclick = () => {
    unlockAudio();
    const s = en.sets[cur]; s.done = true; delete en.edit; vib(30);
    const more = en.sets.some(x => !x.done);
    if (more || !isLast) ACT.rest = { until: Date.now() + restSec * 1000, total: restSec };
    saveAct(); renderRun();
    if (!more) toast(isLast ? 'Letzte Übung geschafft! 💪' : 'Übung geschafft 💪');
  };
  R.querySelectorAll('[data-set]').forEach(b => b.onclick = () => { en.edit = +b.dataset.set; saveAct(); renderRun(); });
  $('sAdd').onclick = () => { const l = en.sets[en.sets.length - 1]; en.sets.push({ reps: l ? l.reps : e.reps, kg: l ? l.kg : null, done: false }); saveAct(); renderRun(); };
  if ($('sRem')) $('sRem').onclick = () => { en.sets.pop(); delete en.edit; saveAct(); renderRun(); };
  if ($('sugGo')) $('sugGo').onclick = () => { en.sugUsed = true; en.sets.forEach(s => { if (s.done) return; if (sug.kind === 'kg') s.kg = Math.round(((s.kg || 0) + 2.5) * 100) / 100; else s.reps = (s.reps || 0) + 2; }); saveAct(); renderRun(); toast(sug.kind === 'kg' ? '+2,5 kg eingetragen' : '+2 Wdh. eingetragen'); };
  if ($('rLater')) $('rLater').onclick = () => { ACT.order.push(ACT.order.splice(ACT.idx, 1)[0]); ACT.rest = null; saveAct(); renderRun(); toast(`${en.name} kommt am Ende nochmal`); };
  $('rNext').onclick = () => {
    delete en.edit; ACT.rest = null;
    if (isLast) { ACT.step = 'finish'; ACT.ended_at = nowIso(); } else ACT.idx++;
    saveAct(); renderRun(); $('run').querySelector('.rbody').scrollTop = 0;
  };
  if (ACT.rest) bindRest();
}
function restSheet() {
  const left = (ACT.rest.until - Date.now()) / 1000;
  return `<div class="rest ${left <= 0 ? 'over' : ''}" id="restSheet"><div class="in">
    <div class="label" data-rest-label>${left <= 0 ? 'Los geht’s!' : 'Pause'}</div>
    <div class="clock" data-rest>${mmss(Math.abs(left))}</div>
    <div class="ring"><i data-rest-bar style="width:${Math.max(0, Math.min(100, left / ACT.rest.total * 100))}%"></i></div>
    <div class="row"><button class="grow" id="rMinus">−15 s</button><button class="grow" id="rPlus">+15 s</button><button class="grow primary" id="rSkip">Weiter</button></div>
  </div></div>`;
}
function bindRest() {
  $('rMinus').onclick = () => { ACT.rest.until -= 15000; saveAct(); tick(); };
  $('rPlus').onclick = () => { ACT.rest.until += 15000; ACT.rest.total += 15; ACT.rest.alerted = false; saveAct(); tick(); };
  $('rSkip').onclick = () => { ACT.rest = null; saveAct(); renderRun(); };
}
function bindRunHead() {
  $('rX').onclick = () => {
    const dlg = $('dlg'); dlg.className = 'sheet';
    dlg.innerHTML = `<div class="db"><h2>Training unterbrechen?</h2>
      <button class="primary" id="xPause" style="min-height:54px">Pausieren – später weitermachen</button>
      <button id="xEnd" style="min-height:54px">Jetzt beenden & speichern</button>
      <button class="ghost danger" id="xDrop">Training verwerfen</button>
      <button class="ghost" id="xBack">Zurück zum Training</button></div>`;
    dlg.showModal();
    $('xBack').onclick = () => dlg.close();
    $('xPause').onclick = () => { dlg.close(); closeRun(); };
    $('xEnd').onclick = () => { dlg.close(); ACT.step = 'finish'; ACT.rest = null; ACT.ended_at = nowIso(); saveAct(); renderRun(); };
    $('xDrop').onclick = () => { if (!confirmTap($('xDrop'), 'Sicher? Alles von heute weg – nochmal tippen')) return; dlg.close(); ACT = null; saveAct(); closeRun(); };
  };
  $('rList').onclick = () => {
    if (ACT.step === 'finish') return;
    const dlg = $('dlg'); dlg.className = 'sheet';
    dlg.innerHTML = `<div class="db"><h2>Zu Übung springen</h2><div class="exlist">${ACT.order.map((id, i) => { const en = ACT.entries[id], e = EX[id] || {}, d = en.sets.filter(s => s.done).length; return `<button class="ex" data-j="${i}">${picHtml({ ...e, illus: e.illus })}<span class="t"><b>${h(en.name)}</b><span>${d}/${en.sets.length} Sätze</span></span>${d === en.sets.length ? '<span class="tag ok">✓</span>' : ACT.step === 'ex' && i === ACT.idx ? '<span class="tag acc">jetzt</span>' : ''}</button>`; }).join('')}</div><button class="ghost" id="jBack">Schließen</button></div>`;
    dlg.showModal(); hydrate(dlg);
    $('jBack').onclick = () => dlg.close();
    dlg.querySelectorAll('[data-j]').forEach(b => b.onclick = () => { ACT.idx = +b.dataset.j; ACT.step = 'ex'; ACT.rest = null; saveAct(); dlg.close(); renderRun(); });
  };
}
function tick() {
  if (!ACT || $('run').hidden) return;
  const el = document.querySelector('[data-elapsed]'); if (el && ACT.step !== 'finish') el.textContent = mmss((Date.now() - new Date(ACT.started_at)) / 1000);
  const w = document.querySelector('[data-warm]');
  if (w && ACT.warmupEnd) { const left = (ACT.warmupEnd - Date.now()) / 1000; w.textContent = mmss(left); if (left <= 0 && !ACT.warmAlerted) { ACT.warmAlerted = true; saveAct(); vib([300, 120, 300]); beep(); toast('Aufwärmen fertig – los geht’s!'); } }
  if (ACT.rest) {
    const left = (ACT.rest.until - Date.now()) / 1000, c = document.querySelector('[data-rest]');
    if (c) { c.textContent = mmss(Math.abs(left)); document.querySelector('[data-rest-bar]').style.width = Math.max(0, Math.min(100, left / ACT.rest.total * 100)) + '%'; const sh = $('restSheet'); sh.classList.toggle('over', left <= 0); document.querySelector('[data-rest-label]').textContent = left <= 0 ? 'Los geht’s – nächster Satz!' : 'Pause'; }
    if (left <= 0 && !ACT.rest.alerted) { ACT.rest.alerted = true; saveAct(); vib([250, 100, 250, 100, 250]); beep(); }
    if (left < -45) { ACT.rest = null; saveAct(); renderRun(); }
  }
}
setInterval(tick, 250);

/* ---------- Abschluss ---------- */
function workoutFromAct() {
  return {
    id: ACT.id, started_at: ACT.started_at, ended_at: ACT.ended_at || nowIso(), warmup_sec: ACT.warmupSec || 0,
    entries: ACT.order.map(id => { const en = ACT.entries[id]; return { exercise_id: id, name: en.name, muscle: en.muscle, bodyweight: en.bodyweight, sets: en.sets.map(s => ({ reps: s.reps, kg: s.kg, done: !!s.done })) }; }),
    mood: ACT.mood, note: ACT.note || null, body_weight: ACT.body_weight, photo_path: ACT.photo_path, deleted: false,
  };
}
function prsOf(w) {
  const out = [];
  w.entries.forEach(en => {
    const d = en.sets.filter(s => s.done); if (!d.length) return;
    const prev = historyFor(en.exercise_id).filter(x => x.at < w.started_at);
    if (!prev.length) return;
    if (!en.bodyweight) { const kg = Math.max(...d.map(s => s.kg || 0)), pk = Math.max(...prev.map(x => x.kg || 0)); if (kg > pk && pk > 0) out.push(`${en.name}: ${kgStr(kg)} kg (vorher ${kgStr(pk)})`); }
    else { const r = Math.max(...d.map(s => s.reps || 0)), pr = Math.max(...prev.map(x => x.reps)); if (r > pr) out.push(`${en.name}: ${r} Wdh. (vorher ${pr})`); }
  });
  return out;
}
function renderFinish() {
  const w = workoutFromAct(), mins = Math.round((new Date(w.ended_at) - new Date(w.started_at)) / 60000), vol = volume(w), prs = prsOf(w);
  const R = $('run');
  R.innerHTML = `<div class="rhead"><button class="x" id="fBack" aria-label="Zurück zum Training"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg></button><div class="prog"><span><b>Geschafft! 💪</b></span>${progressBar()}</div></div>
  <div class="rbody"><div class="in">
    <div class="stats"><div class="stat"><b>${mins}</b><span>Minuten</span></div><div class="stat"><b>${doneSets(w)}</b><span>Sätze</span></div><div class="stat"><b>${vol ? fmt(vol / 1000, 2) : '–'}</b><span>Tonnen bewegt</span></div></div>
    ${prs.map(p => `<div class="pr">🏆 <span>Neuer Bestwert – ${h(p)}</span></div>`).join('')}
    <div class="field"><span class="label">Wie war’s?</span><div class="mood" id="fMood">${MOODS.map((m, i) => `<button aria-pressed="${ACT.mood === i + 1}" data-v="${i + 1}" aria-label="Stimmung ${i + 1} von 5">${m}</button>`).join('')}</div></div>
    <div class="card" style="display:flex;flex-direction:column;gap:12px">
      <div><div class="label">Fortschritts-Foto</div><p class="small muted" style="margin:4px 0 0">Gleicher Ort, gleiches Licht, gleiche Haltung – dann siehst du die Veränderung am besten. Das letzte Foto wird zum Ausrichten eingeblendet.</p></div>
      ${ACT.photo_path ? `<div class="photoprev"><img data-path="${h(ACT.photo_path)}" alt="Fortschritts-Foto von heute" hidden></div>` : ''}
      <div class="row"><button class="grow ${ACT.photo_path ? '' : 'primary'}" id="fPhoto">📸 ${ACT.photo_path ? 'Neu aufnehmen' : 'Foto aufnehmen'}</button><button class="ghost" id="fGal">Aus Galerie</button></div>
    </div>
    <div class="field"><label for="fBody">Körpergewicht heute (optional)</label><div style="position:relative"><input id="fBody" inputmode="decimal" autocomplete="off" placeholder="z. B. 82,5" value="${h(kgStr(ACT.body_weight))}" style="padding-right:44px"><span class="muted" style="position:absolute;right:14px;top:50%;transform:translateY(-50%)">kg</span></div></div>
    <div class="field"><label for="fNote">Notiz (optional)</label><textarea id="fNote" placeholder="z. B. Schulter gezwickt, Beinpresse war voll">${h(ACT.note)}</textarea></div>
  </div></div>
  <div class="rfoot"><div class="in"><button class="primary grow" id="fSave">Training speichern</button></div></div>`;
  hydrate(R);
  $('fBack').onclick = () => { ACT.step = 'ex'; ACT.idx = Math.min(ACT.idx, ACT.order.length - 1); delete ACT.ended_at; saveAct(); renderRun(); };
  $('fMood').onclick = (ev) => { const b = ev.target.closest('[data-v]'); if (!b) return; ACT.mood = +b.dataset.v; saveAct(); $('fMood').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); vib(10); };
  $('fBody').oninput = () => { ACT.body_weight = num($('fBody').value); saveAct(); };
  $('fNote').oninput = () => { ACT.note = $('fNote').value; saveAct(); };
  const setPhoto = async (blob) => { if (!blob || !user) return; const path = `${user.id}/body/${ACT.id}.jpg`; await storePhoto(path, blob); ACT.photo_path = path; saveAct(); renderFinish(); };
  $('fPhoto').onclick = async () => setPhoto(await camera());
  $('fGal').onclick = async () => { const f = await pickFile(null); if (f) setPhoto(await compress(f, 1400)); };
  $('fSave').onclick = () => {
    const wo = workoutFromAct();
    wo.entries.forEach(en => { // Plan merkt sich das zuletzt genutzte Gewicht
      const e = EX[en.exercise_id]; if (!e || en.bodyweight) return;
      const d = en.sets.filter(s => s.done && s.kg != null); if (!d.length) return;
      const kg = d[d.length - 1].kg; if (e.weight !== kg) { e.weight = kg; putEx(e); }
    });
    putWo(wo); ACT = null; saveAct(); closeRun(); tab = 'home'; render(); toast('Stark! Training gespeichert 💪');
  };
}

/* ---------- Kamera mit Ausrichtungshilfe ---------- */
function camera() {
  return new Promise(async (resolve) => {
    const C = $('cam'); let stream = null, facing = 'user', timer = 0;
    const ghostPath = (workouts().find(w => w.photo_path) || {}).photo_path;
    const ghost = ghostPath ? await photoUrl(ghostPath) : null;
    const stop = () => { if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; };
    const done = (v) => { stop(); C.hidden = true; C.innerHTML = ''; resolve(v); };
    async function start() {
      stop();
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1440 }, height: { ideal: 1920 } }, audio: false }); }
      catch { done(null); const f = await pickFile('user'); resolve(f ? await compress(f, 1400) : null); return; }
      const v = C.querySelector('video'); v.srcObject = stream; v.classList.toggle('mirror', facing === 'user'); C.querySelector('.ghost') && C.querySelector('.ghost').classList.toggle('mir', false);
    }
    C.innerHTML = `<div class="view"><video playsinline autoplay muted></video>${ghost ? `<img class="ghost" src="${ghost}" alt="">` : ''}<div class="hint">${ghost ? 'Stell dich so hin, dass du mit dem letzten Foto übereinstimmst.' : 'Oberkörper mittig, gerade Haltung, gutes Licht.'}</div><div class="count" id="camCount"></div></div>
      <div class="ctl"><button id="camX">Abbrechen</button><button class="shutter" id="camShot" aria-label="Foto aufnehmen"></button><button id="camT" aria-pressed="false">Timer 5 s</button></div>
      <div class="ctl" style="padding-top:0"><button id="camFlip" style="flex:1">↺ Kamera wechseln</button></div>`;
    C.hidden = false;
    $('camX').onclick = () => done(null);
    $('camT').onclick = () => { timer = timer ? 0 : 5; $('camT').setAttribute('aria-pressed', String(!!timer)); };
    $('camFlip').onclick = () => { facing = facing === 'user' ? 'environment' : 'user'; start(); };
    $('camShot').onclick = async () => {
      const v = C.querySelector('video'); if (!v.videoWidth) return;
      for (let i = timer; i > 0; i--) { $('camCount').textContent = i; vib(20); await new Promise(r => setTimeout(r, 1000)); }
      $('camCount').textContent = '';
      // Ausschnitt wie auf dem Bildschirm (object-fit: cover)
      const vw = v.videoWidth, vh = v.videoHeight, box = v.getBoundingClientRect(), ar = box.width / box.height;
      let sw = vw, sh = vh; if (vw / vh > ar) sw = vh * ar; else sh = vw / ar;
      const c = document.createElement('canvas'); c.width = Math.round(sw); c.height = Math.round(sh);
      c.getContext('2d').drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, sw, sh);
      vib(40); done(await compress(c, 1400, 0.82, facing === 'user'));
    };
    start();
  });
}

/* ---------------- Fortschritt ---------------- */
let month = (() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; })();
let chartEx = LS.get('chartEx', null);
function renderProgress() {
  const all = workouts();
  const inMonth = (w, y, m) => { const d = new Date(w.started_at); return d.getFullYear() === y && d.getMonth() === m; };
  const pm = month.m === 0 ? { y: month.y - 1, m: 11 } : { y: month.y, m: month.m - 1 };
  const ws = all.filter(w => inMonth(w, month.y, month.m)), prev = all.filter(w => inMonth(w, pm.y, pm.m));
  const title = new Date(month.y, month.m, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const isNow = month.y === new Date().getFullYear() && month.m === new Date().getMonth();
  const dlt = (a, b, unit = '') => b ? `<em class="${a >= b ? 'up' : 'down'}" style="display:block;margin-top:2px">${a >= b ? '▲' : '▼'} ${fmt(Math.abs(a - b), 1)}${unit}</em>` : '';
  const sets = ws.reduce((a, w) => a + doneSets(w), 0), vol = ws.reduce((a, w) => a + volume(w), 0);
  let html = header('Fortschritt') + `<div class="month"><button id="mPrev" aria-label="Vormonat">‹</button><b>${title}</b><button id="mNext" aria-label="Nächster Monat" ${isNow ? 'disabled' : ''}>›</button></div>`;
  html += `<div class="stats"><div class="stat"><b>${ws.length}</b><span>Trainings</span>${dlt(ws.length, prev.length)}</div><div class="stat"><b>${sets}</b><span>Sätze</span>${dlt(sets, prev.reduce((a, w) => a + doneSets(w), 0))}</div><div class="stat"><b>${fmt(vol / 1000, 1)}</b><span>Tonnen</span>${dlt(vol / 1000, prev.reduce((a, w) => a + volume(w), 0) / 1000, ' t')}</div></div>${prev.length ? '<p class="small faint" style="margin:-6px 0 0">▲▼ im Vergleich zum Vormonat</p>' : ''}`;

  // Kalender
  const first = new Date(month.y, month.m, 1), days = new Date(month.y, month.m + 1, 0).getDate(), off = (first.getDay() + 6) % 7;
  const on = new Set(ws.map(w => new Date(w.started_at).getDate())), today = new Date();
  html += `<div class="card"><div class="cal">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => `<div class="h">${d}</div>`).join('')}${'<div class="d e"></div>'.repeat(off)}${Array.from({ length: days }, (_, i) => `<div class="d ${on.has(i + 1) ? 'on' : ''} ${isNow && today.getDate() === i + 1 ? 'today' : ''}">${i + 1}</div>`).join('')}</div></div>`;

  // Gewicht je Übung
  const ex = exercises();
  if (!chartEx || !EX[chartEx] || EX[chartEx].deleted) chartEx = ex[0] && ex[0].id;
  const end = new Date(month.y, month.m + 1, 1).toISOString(), start = new Date(month.y, month.m, 1).toISOString();
  html += `<div class="card" style="display:flex;flex-direction:column;gap:12px"><h2>Kraft-Entwicklung</h2>`;
  const deltas = ex.map(e => {
    const hist = historyFor(e.id).filter(x => x.at < end), inm = hist.filter(x => x.at >= start), before = hist.filter(x => x.at < start);
    if (!inm.length) return null;
    const val = (x) => e.bodyweight ? x.reps : x.kg;
    const a = before.length ? val(before[before.length - 1]) : val(inm[0]), b = val(inm[inm.length - 1]);
    return { e, a, b };
  }).filter(Boolean);
  if (deltas.length) {
    html += `<div>${deltas.map(({ e, a, b }) => { const u = e.bodyweight ? ' Wdh.' : ' kg', d = (b || 0) - (a || 0); return `<div class="delta"><span>${h(e.name)}</span><span class="num"><span class="muted">${a == null ? '–' : kgStr(a)} → </span><b>${b == null ? '–' : kgStr(b) + u}</b> ${d > 0 ? `<span class="tag ok">+${kgStr(d)}</span>` : d < 0 ? `<span class="tag warn">${kgStr(d)}</span>` : '<span class="tag">±0</span>'}</span></div>`; }).join('')}</div>`;
  } else html += `<div class="empty">In diesem Monat noch keine Übung mit Werten.</div>`;
  if (ex.length) {
    html += `<div class="chips" id="cEx">${ex.map(e => `<button class="chip" aria-pressed="${e.id === chartEx}" data-c="${e.id}">${h(e.name)}</button>`).join('')}</div><div id="cBox"></div>`;
  }
  html += `</div>`;

  // Körpergewicht
  const bw = all.filter(w => w.body_weight).slice().reverse().map(w => ({ at: w.started_at, v: w.body_weight }));
  if (bw.length >= 2) html += `<div class="card" style="display:flex;flex-direction:column;gap:10px"><h2>Körpergewicht</h2><div id="bwBox"></div></div>`;

  // Fotos
  const photosAll = all.filter(w => w.photo_path).slice().reverse();
  const photosM = photosAll.filter(w => w.started_at < end);
  html += `<div class="card" style="display:flex;flex-direction:column;gap:12px"><h2>Vorher / Nachher</h2>`;
  if (photosM.length >= 2) {
    const a = photosM[0], b = photosM[photosM.length - 1];
    html += `<p class="small muted" style="margin:0">Schieb den Regler, um dein erstes Foto mit dem neuesten zu vergleichen.</p>
      <div class="cmp" id="cmp"><img data-path="${h(a.photo_path)}" alt="Foto vom ${dayStr(a.started_at)}" hidden><img class="after" data-path="${h(b.photo_path)}" alt="Foto vom ${dayStr(b.started_at)}" hidden><div class="line"></div><span class="lb" style="left:10px">${dayStr(a.started_at)}</span><span class="lb" style="right:10px">${dayStr(b.started_at)}</span></div>`;
  } else html += `<div class="empty">${photosM.length ? 'Ab dem 2. Foto siehst du hier den Vergleich.' : 'Nach dem Training ein Foto machen – hier siehst du dann die Veränderung.'}</div>`;
  const pInMonth = photosAll.filter(w => w.started_at >= start && w.started_at < end);
  if (pInMonth.length) html += `<div class="photos">${pInMonth.map(w => `<button data-ph="${h(w.photo_path)}" data-dt="${h(dayStr(w.started_at))}"><img data-path="${h(w.photo_path)}" alt="Foto vom ${dayStr(w.started_at)}" hidden><span>${new Date(w.started_at).getDate()}.</span></button>`).join('')}</div>`;
  html += `</div>`;

  // Verlauf
  html += `<div class="card"><h2 style="margin-bottom:4px">Verlauf</h2>${ws.length ? ws.map(w => `<button class="hist" data-w="${w.id}"><span><b>${dayStr(w.started_at)}</b><br><span class="small muted">${Math.round((new Date(w.ended_at) - new Date(w.started_at)) / 60000)} Min · ${doneSets(w)} Sätze${volume(w) ? ' · ' + fmt(volume(w) / 1000, 2) + ' t' : ''}</span></span><span style="font-size:22px">${w.mood ? MOODS[w.mood - 1] : '›'}</span></button>`).join('') : '<div class="empty">Kein Training in diesem Monat.</div>'}</div>`;

  $('page').innerHTML = html;
  $('mPrev').onclick = () => { month = pm; render(); };
  $('mNext').onclick = () => { month = month.m === 11 ? { y: month.y + 1, m: 0 } : { y: month.y, m: month.m + 1 }; render(); };
  if ($('cEx')) {
    const draw = () => { const e = EX[chartEx]; const hist = historyFor(chartEx).filter(x => x.at < end); lineChart($('cBox'), hist.map(x => ({ at: x.at, v: e.bodyweight ? x.reps : x.kg })).filter(p => p.v != null), e.bodyweight ? 'Wdh.' : 'kg'); };
    $('cEx').onclick = (ev) => { const b = ev.target.closest('[data-c]'); if (!b) return; chartEx = b.dataset.c; LS.set('chartEx', chartEx); $('cEx').querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === b))); draw(); };
    draw();
  }
  if ($('bwBox')) lineChart($('bwBox'), bw, 'kg');
  if ($('cmp')) compareSlider($('cmp'));
  document.querySelectorAll('[data-ph]').forEach(b => b.onclick = async () => {
    const dlg = $('dlg'); dlg.className = '';
    dlg.innerHTML = `<div class="dh"><b>${h(b.dataset.dt)}</b><button class="ghost" id="pClose">Schließen</button></div><div class="db"><img src="${await photoUrl(b.dataset.ph) || ''}" alt="" style="width:100%;border-radius:14px"></div>`;
    dlg.showModal(); $('pClose').onclick = () => dlg.close();
  });
  document.querySelectorAll('[data-w]').forEach(b => b.onclick = () => workoutDetail(WO[b.dataset.w]));
}
function lineChart(box, pts, unit) {
  if (pts.length < 2) { box.innerHTML = `<div class="empty">${pts.length ? 'Ab dem 2. Training siehst du hier die Kurve.' : 'Noch keine Werte für diese Übung.'}</div>`; return; }
  const W = 340, H = 170, L = 34, Rr = 10, T = 26, B = 24;
  const vs = pts.map(p => p.v), lo0 = Math.min(...vs), hi0 = Math.max(...vs), pad = Math.max(1, (hi0 - lo0) * 0.15);
  const lo = Math.max(0, Math.floor(lo0 - pad)), hi = Math.ceil(hi0 + pad);
  const t0 = new Date(pts[0].at).getTime(), t1 = new Date(pts[pts.length - 1].at).getTime();
  const X = (p) => L + (t1 === t0 ? 0.5 : (new Date(p.at).getTime() - t0) / (t1 - t0)) * (W - L - Rr);
  const Y = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const ticks = [lo, (lo + hi) / 2, hi];
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  const d = (iso) => new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' });
  const lastP = pts[pts.length - 1];
  box.innerHTML = `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Verlauf in ${unit}: von ${kgStr(pts[0].v)} auf ${kgStr(lastP.v)}">
    ${ticks.map(t => `<line x1="${L}" x2="${W - Rr}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="var(--faint)">${fmt(t, 1)}</text>`).join('')}
    <text x="${L}" y="${H - 6}" font-size="11" fill="var(--faint)">${d(pts[0].at)}</text><text x="${W - Rr}" y="${H - 6}" font-size="11" fill="var(--faint)" text-anchor="end">${d(lastP.at)}</text>
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${pts.map(p => `<circle cx="${X(p).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>`).join('')}
    <text x="${X(lastP)}" y="${Y(lastP.v) - 10}" text-anchor="end" font-size="12" font-weight="700" fill="var(--ink)">${kgStr(lastP.v)} ${unit}</text>
    <line id="xh" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--muted)" stroke-width="1" visibility="hidden"/>
  </svg><div class="tt" hidden></div></div>`;
  const svg = box.querySelector('svg'), tt = box.querySelector('.tt'), xh = box.querySelector('#xh');
  const show = (ev) => {
    const r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width * W;
    let best = pts[0]; pts.forEach(p => { if (Math.abs(X(p) - x) < Math.abs(X(best) - x)) best = p; });
    xh.setAttribute('x1', X(best)); xh.setAttribute('x2', X(best)); xh.setAttribute('visibility', 'visible');
    tt.hidden = false; tt.textContent = `${d(best.at)} · ${kgStr(best.v)} ${unit}`; tt.style.left = Math.max(50, Math.min(r.width - 50, X(best) / W * r.width)) + 'px';
  };
  svg.addEventListener('pointerdown', show); svg.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) show(e); });
  svg.addEventListener('pointerleave', () => { tt.hidden = true; xh.setAttribute('visibility', 'hidden'); });
}
function compareSlider(box) {
  const after = box.querySelector('.after'), line = box.querySelector('.line');
  const set = (ev) => { const r = box.getBoundingClientRect(); const p = Math.max(0, Math.min(100, (ev.clientX - r.left) / r.width * 100)); after.style.clipPath = `inset(0 0 0 ${p}%)`; line.style.left = p + '%'; };
  box.addEventListener('pointerdown', (e) => { box.setPointerCapture(e.pointerId); set(e); });
  box.addEventListener('pointermove', (e) => { if (e.buttons) set(e); });
}
function workoutDetail(w) {
  const c = JSON.parse(JSON.stringify(w));
  const dlg = $('dlg'); dlg.className = '';
  dlg.innerHTML = `<div class="dh"><button class="ghost" id="wClose">Schließen</button><b>${dayStr(w.started_at)}</b><button class="primary" id="wSave">Sichern</button></div><div class="db">
    <div class="small muted">${new Date(w.started_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}–${new Date(w.ended_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr · ${doneSets(w)} Sätze${w.body_weight ? ' · ' + kgStr(w.body_weight) + ' kg Körpergewicht' : ''}${w.mood ? ' · ' + MOODS[w.mood - 1] : ''}</div>
    ${w.note ? `<div class="card small">${h(w.note)}</div>` : ''}
    ${w.photo_path ? `<div class="photoprev"><img data-path="${h(w.photo_path)}" alt="" hidden></div>` : ''}
    ${c.entries.map((en, i) => `<div class="card" style="display:flex;flex-direction:column;gap:8px"><b>${h(en.name)}</b>${en.sets.map((s, j) => `<div class="row" style="flex-wrap:nowrap;gap:8px"><label class="switch" style="padding:0;gap:6px;flex:none"><input type="checkbox" data-dn="${i}.${j}" ${s.done ? 'checked' : ''} aria-label="Satz ${j + 1} erledigt"></label><span class="small muted" style="flex:none;width:44px">Satz ${j + 1}</span><input data-r="${i}.${j}" inputmode="numeric" pattern="[0-9]*" value="${s.reps ?? ''}" aria-label="Wiederholungen" style="text-align:center"><span class="small muted">Wdh.</span>${en.bodyweight ? '' : `<input data-k="${i}.${j}" inputmode="decimal" value="${kgStr(s.kg)}" aria-label="kg" style="text-align:center"><span class="small muted">kg</span>`}</div>`).join('')}</div>`).join('')}
    <button class="ghost danger" id="wDel">Training löschen</button></div>`;
  dlg.showModal(); hydrate(dlg);
  const at = (k) => { const [i, j] = k.split('.').map(Number); return c.entries[i].sets[j]; };
  dlg.querySelectorAll('[data-r]').forEach(i => i.oninput = () => { at(i.dataset.r).reps = num(i.value) == null ? null : Math.round(num(i.value)); });
  dlg.querySelectorAll('[data-k]').forEach(i => i.oninput = () => { at(i.dataset.k).kg = num(i.value); });
  dlg.querySelectorAll('[data-dn]').forEach(i => i.onchange = () => { at(i.dataset.dn).done = i.checked; });
  $('wClose').onclick = () => dlg.close();
  $('wSave').onclick = () => { putWo(c); dlg.close(); render(); toast('Gespeichert'); };
  $('wDel').onclick = () => { if (!confirmTap($('wDel'), 'Wirklich löschen? Nochmal tippen')) return; c.deleted = true; putWo(c); dlg.close(); render(); toast('Training gelöscht'); };
}

/* ---------------- Mehr ---------------- */
function renderMore() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let html = header('Mehr') + `<div class="card" style="display:flex;flex-direction:column;gap:16px">
    <h2>Einstellungen</h2>
    <div class="grid2">${stepper('oRest', 'Pause (Sek.)', SET.rest_sec, 'numeric', 15)}${stepper('oWarm', 'Aufwärmen (Min.)', SET.warmup_min, 'numeric', 1)}</div>
    <p class="small muted" style="margin:-4px 0 0">Die Pause gilt für alle Geräte. Pro Gerät kannst du sie im Plan einzeln ändern.</p></div>`;
  if (!standalone) html += `<div class="card"><h2>Als App aufs Handy</h2><p class="muted small" style="margin:6px 0 0"><b>iPhone:</b> In Safari unten auf „Teilen“ <span aria-hidden="true">⬆︎</span> → „Zum Home-Bildschirm“. <b>Android:</b> Chrome-Menü ⋮ → „App installieren“. Danach hast du ein eigenes „Training“-Symbol – getrennt vom Fahrtenbuch.</p></div>`;
  html += `<div class="card" style="display:flex;flex-direction:column;gap:10px"><h2>Konto & Sicherung</h2>
    <div class="small muted">Angemeldet als <b style="color:var(--ink)">${h(user && user.email)}</b> (gleiches Konto wie das Fahrtenbuch)</div>
    <div class="small muted">${Q.ex.length + Q.wo.length ? `${Q.ex.length + Q.wo.length} Änderungen warten aufs Hochladen.` : lastSyncAt ? `Zuletzt gesichert um ${lastSyncAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr.` : 'Noch nicht gesichert.'} Fotos sind privat – nur du siehst sie.</div>
    <div class="row"><button class="grow" id="oSync">Jetzt sichern</button><button class="ghost grow" id="oOut">Abmelden</button></div></div>
    <p class="small faint" style="text-align:center">Training · ${exercises().length} Geräte · ${workouts().length} Trainings</p>`;
  $('page').innerHTML = html;
  bindSteppers($('page'), () => {
    const r = Math.max(15, Math.min(600, Math.round(num($('oRest').value) || 90))), w = Math.max(0, Math.min(60, Math.round(num($('oWarm').value) ?? 10)));
    if (r !== SET.rest_sec || w !== SET.warmup_min) { SET.rest_sec = r; SET.warmup_min = w; clearTimeout(renderMore.t); renderMore.t = setTimeout(putSet, 600); }
  });
  $('oSync').onclick = async () => { await sync(); toast(syncOk ? 'Alles gesichert' : 'Gerade kein Netz – wird später nachgeholt'); render(); };
  $('oOut').onclick = async () => {
    if (Q.ex.length || Q.wo.length) { if (!confirmTap($('oOut'), 'Noch nicht alles gesichert! Trotzdem? Tippen')) return; }
    else if (!confirmTap($('oOut'), 'Sicher? Nochmal tippen')) return;
    await sb.auth.signOut(); LS.clearAll(); location.reload();
  };
}

/* ---------------- Toast ---------------- */
let toastT;
function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; el.style.bottom = $('run').hidden ? '' : 'calc(100px + env(safe-area-inset-bottom,0px))'; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 2600); }

/* ---------------- Login ---------------- */
$('loginForm').onsubmit = async (ev) => {
  ev.preventDefault(); $('btnLogin').disabled = true; $('loginMsg').textContent = 'Melde an…';
  const { error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('pw').value });
  $('btnLogin').disabled = false;
  $('loginMsg').textContent = error ? (error.message.includes('Invalid') ? 'E-Mail oder Passwort stimmt nicht.' : 'Anmelden ging nicht: ' + error.message) : '';
};
function onAuth(session) {
  const u = session && session.user;
  if (u && user && u.id === user.id) return;
  if (u && LS.get('uid', null) && LS.get('uid', null) !== u.id) { LS.clearAll(); EX = {}; WO = {}; Q = { ex: [], wo: [], set: false }; ACT = null; SET = { rest_sec: 90, warmup_min: 10, seeded: false, updated_at: null }; }
  user = u || null;
  if (user) { LS.set('uid', user.id); }
  $('vLogin').hidden = !!user; $('vMain').hidden = !user;
  if (user) { render(); sync(); if (ACT) openRun(); }
}
sb.auth.onAuthStateChange((_e, s) => onAuth(s));
sb.auth.getSession().then(({ data }) => onAuth(data.session));

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
