'use strict';
/* global Keys, AudioEngine, EZ */
// `api` is the global that preload.js exposes (window.api) - don't redeclare it.
const engine = new AudioEngine();

/* ============================== icons ============================== */
const I = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  wave: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0"/>',
  loop: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  head: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
  broadcast: '<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
  key: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  headphoneOnly: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  muteMic: '<path d="M3 3l18 18"/><path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.9-.8"/><path d="M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3"/>'
};
const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24">${I[n] || ''}</svg>`;

/* ============================== helpers ============================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => Math.random().toString(36).slice(2, 10);
const fmtTime = (s) => {
  if (!isFinite(s)) return '–';
  if (s < 10) return s.toFixed(1) + 's';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return m ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`;
};
const toDb = (g) => (g <= 0.0001 ? '-∞' : (20 * Math.log10(g)).toFixed(1));

const PALETTE = ['#b4ff39', '#39ffd2', '#3dafff', '#8b7bff', '#ff5fd2', '#ff5470', '#ff9f43', '#ffe14d', '#e6e8ee'];
const ACCENTS = ['#ffd21f', '#b4ff39', '#39ffd2', '#3dafff', '#8b7bff', '#ff5fd2', '#ff5470', '#ff9f43'];

/* ============================== state ============================== */
const DEFAULT_SETTINGS = {
  monitorDevice: '',
  micOutDevice: '',
  micInDevice: 'default',
  passthrough: true,
  noiseSuppression: false,
  voiceVolume: 1,
  monitorVolume: 0.7,
  micOutVolume: 1,
  soundsToMic: true,
  limiter: true,
  duck: false,
  duckLevel: 0.35,
  playMode: 'overlap',
  ptt: { enabled: false, key: '', preDelay: 90, release: 250 },
  hotkeys: { stopAll: '', toggleMic: '', togglePassthrough: '' },
  accent: '#ffd21f',
  padSize: 'm',
  layout: 'grid',         // 'grid' (pads) | 'list' (table)
  memory: 'balanced',     // audio cache size: 'low' | 'balanced' | 'fast'
  sort: 'manual',
  closeToTray: true,
  setupSeen: false,
  micMode: '',            // 'direct' (built-in plugin, no cable) | 'cable' (VB-CABLE)
  starterImported: false,
  checkMicOnStartup: true,
  powerSave: true,         // put the audio engine to sleep while nothing is playing
  tts: { voice: '', rate: 1, volume: 1, recent: [] }
};

let lib = null;
let view = { section: 'all', search: '' };
let editingId = null;
let hotkeyBackend = 'globalShortcut';
let hwAccel = true;
let devices = { inputs: [], outputs: [] };
let routeOk = { monitor: true, mic: false };
let micInputOk = true;
let apoAvail = false;              // plugin files shipped with this build (Windows)
let apoInfo = { ok: false, devices: [] };
let apoStatus = { mapped: false, apoAgeMs: -1 };
const isDirect = () => S().micMode === 'direct';

function defaultLib() {
  return {
    version: 1,
    settings: structuredClone(DEFAULT_SETTINGS),
    categories: [
      { id: uid(), name: 'Memes', color: '#ff5fd2' },
      { id: uid(), name: 'Game', color: '#39ffd2' },
      { id: uid(), name: 'Music', color: '#3dafff' }
    ],
    sounds: [],
    recent: []
  };
}

function mergeDeep(def, val) {
  if (typeof def !== 'object' || def === null || Array.isArray(def)) return val === undefined ? def : val;
  const out = { ...def };
  for (const k of Object.keys(val || {})) out[k] = k in def ? mergeDeep(def[k], val[k]) : val[k];
  return out;
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api.saveLib(lib), 350);
  api.sb.pushSettings();
  pushLibraryToRemote();
  pushPlayingToRemote();
}

const S = () => lib.settings;
const findSound = (id) => lib.sounds.find((s) => s.id === id);
const findCat = (id) => lib.categories.find((c) => c.id === id);
const soundColor = (s) => s.color || findCat(s.category)?.color || '#e6e8ee';

/* ============================== toasts / modals / menu ============================== */
function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.innerHTML = (kind === 'err' ? icon('warn') : kind === 'ok' ? icon('check') : icon('bolt')) + `<span>${esc(msg)}</span>`;
  $('#toasts').appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, 3200);
}

function modal(html, { wide = false, onClose } = {}) {
  const root = $('#modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-back';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}">${html}</div>`;
  root.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('in'));
  const close = () => {
    wrap.classList.remove('in');
    setTimeout(() => wrap.remove(), 180);
    document.removeEventListener('keydown', onKey, true);
    onClose && onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape' && !recording) { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  $$('[data-close]', wrap).forEach((b) => b.addEventListener('click', close));
  return { el: wrap.firstElementChild, close };
}

function askText(title, value = '', placeholder = '') {
  return new Promise((resolve) => {
    let done = false;
    const m = modal(`
      <h3>${esc(title)}</h3>
      <input class="input" id="ask-in" value="${esc(value)}" placeholder="${esc(placeholder)}" spellcheck="false" />
      <div class="modal-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="ask-ok">OK</button></div>`,
    { onClose: () => { if (!done) resolve(null); } });
    const inp = $('#ask-in', m.el);
    inp.focus();
    inp.select();
    const ok = () => { done = true; resolve(inp.value.trim()); m.close(); };
    $('#ask-ok', m.el).onclick = ok;
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
  });
}

function confirmBox(title, msg, okLabel = 'Delete') {
  return new Promise((resolve) => {
    let done = false;
    const m = modal(`
      <h3>${esc(title)}</h3><p class="muted">${esc(msg)}</p>
      <div class="modal-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn danger" id="cf-ok">${esc(okLabel)}</button></div>`,
    { onClose: () => { if (!done) resolve(false); } });
    $('#cf-ok', m.el).onclick = () => { done = true; resolve(true); m.close(); };
  });
}

function showMenu(x, y, items) {
  const menu = $('#menu');
  menu.innerHTML = items.map((it, i) => {
    if (it === '-') return '<div class="menu-sep"></div>';
    if (it.swatches) {
      return `<div class="menu-swatches">${it.swatches.map((c) => `<button data-sw="${c}" style="--c:${c}" class="${c === it.current ? 'on' : ''}"></button>`).join('')}</div>`;
    }
    return `<button class="menu-item ${it.danger ? 'danger' : ''}" data-i="${i}" ${it.disabled ? 'disabled' : ''}>${it.icon ? icon(it.icon) : '<span class="i"></span>'}<span>${esc(it.label)}</span>${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ''}</button>`;
  }).join('');
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = clamp(x, 8, innerWidth - r.width - 8) + 'px';
  menu.style.top = clamp(y, 8, innerHeight - r.height - 8) + 'px';
  menu.onclick = (e) => {
    const sw = e.target.closest('[data-sw]');
    if (sw) {
      const it = items.find((i) => i.swatches);
      it.onPick(sw.dataset.sw);
      hideMenu();
      return;
    }
    const b = e.target.closest('[data-i]');
    if (!b) return;
    hideMenu();
    items[Number(b.dataset.i)].action();
  };
}
function hideMenu() { $('#menu').hidden = true; }
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#menu')) hideMenu(); });
window.addEventListener('blur', hideMenu);

/* ============================== hotkey recorder ============================== */
let recording = false;
/**
 * Opens a capture overlay. Resolves to a combo string, '' (cleared) or null (cancelled).
 * mode 'combo' = modifiers + key (sound hotkeys); mode 'single' = one raw key (push-to-talk).
 */
function recordHotkey({ title = 'Press a key', mode = 'combo', current = '' } = {}) {
  return new Promise((resolve) => {
    recording = true;
    api.suspendHotkeys(true);
    const allowMouse = mode === 'single' || hotkeyBackend !== 'globalShortcut';
    const m = modal(`
      <div class="rec">
        <div class="rec-ring">${icon('key')}</div>
        <h3>${esc(title)}</h3>
        <div class="rec-preview" id="rec-preview">${current ? esc(Keys.label(current)) : 'Waiting…'}</div>
        <p class="muted small">${mode === 'combo' ? 'Use a combo or a free key (Numpad works great).' : 'Pick the exact key you use for voice in game / Discord.'}
        ${allowMouse ? ' Mouse 4 / Mouse 5 work too.' : ''}</p>
        <div class="rec-keys"><span><kbd>Esc</kbd> cancel</span><span><kbd>Backspace</kbd> clear</span></div>
      </div>`, { onClose: finish });
    let result = null;
    const preview = $('#rec-preview', m.el);
    function finish() {
      document.removeEventListener('keydown', onDown, true);
      document.removeEventListener('keyup', onUp, true);
      document.removeEventListener('mousedown', onMouse, true);
      document.removeEventListener('mouseup', swallow, true);
      document.removeEventListener('auxclick', swallow, true);
      setTimeout(() => { recording = false; api.suspendHotkeys(false); }, 120);
      resolve(result);
    }
    const commit = (v) => { result = v; preview.textContent = v ? Keys.label(v) : 'Cleared'; preview.classList.add('got'); setTimeout(m.close, 260); };
    function onDown(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (e.code === 'Escape') { result = null; m.close(); return; }
      if ((e.code === 'Backspace' || e.code === 'Delete') && !e.ctrlKey && !e.altKey && !e.shiftKey) { commit(''); return; }
      if (mode === 'single') { commit(e.code); return; }
      if (Keys.MOD_CODES.has(e.code)) { preview.textContent = Keys.mods(e).join(' + ') + ' + …'; return; }
      commit([...Keys.mods(e), e.code].join('+'));
    }
    function onUp(e) { e.preventDefault(); e.stopPropagation(); }
    function onMouse(e) {
      const n = Keys.mouseName(e.button);
      if (!n || !allowMouse) return;
      e.preventDefault();
      e.stopPropagation();
      commit(mode === 'single' ? n : [...Keys.mods(e), n].join('+'));
    }
    function swallow(e) { if (e.button >= 3) { e.preventDefault(); e.stopPropagation(); } }
    document.addEventListener('keydown', onDown, true);
    document.addEventListener('keyup', onUp, true);
    document.addEventListener('mousedown', onMouse, true);
    document.addEventListener('mouseup', swallow, true);
    document.addEventListener('auxclick', swallow, true);
  });
}

async function setSoundHotkey(id) {
  const s = findSound(id);
  if (!s) return;
  const combo = await recordHotkey({ title: `Hotkey for “${s.name}”`, current: s.hotkey });
  if (combo === null) return;
  if (combo) {
    const clash = lib.sounds.find((o) => o.id !== id && o.hotkey === combo);
    if (clash) { clash.hotkey = ''; toast(`Moved ${Keys.label(combo)} from “${clash.name}”`); }
  }
  s.hotkey = combo;
  save();
  syncHotkeys();
  renderGrid();
  if (editingId === id) renderInspector();
}

/* ============================== hotkeys ============================== */
async function syncHotkeys() {
  applyMemory();
  const b = [];
  for (const s of lib.sounds) if (s.hotkey) b.push({ combo: s.hotkey, action: 'play:' + s.id });
  const hk = S().hotkeys;
  if (hk.stopAll) b.push({ combo: hk.stopAll, action: 'stopAll' });
  if (hk.toggleMic) b.push({ combo: hk.toggleMic, action: 'toggleMic' });
  if (hk.togglePassthrough) b.push({ combo: hk.togglePassthrough, action: 'togglePassthrough' });
  try {
    const r = await api.setHotkeys(b);
    hotkeyBackend = r.backend;
    if (r.failed.length) toast(`Couldn't register: ${r.failed.map(Keys.label).join(', ')}`, 'err');
  } catch (e) {
    console.error(e);
  }
}

api.onHotkey((action) => {
  if (recording) return;
  // Don't fire bare-key sound hotkeys while you're typing in EZ Soundboard itself.
  const ae = document.activeElement;
  const typing = document.hasFocus() && ae && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && ['text', 'number', 'search', ''].includes(ae.type)));
  if (typing && action.startsWith('play:')) return;
  if (action.startsWith('play:')) trigger(action.slice(5));
  else if (action === 'stopAll') engine.stopAll();
  else if (action === 'toggleMic') {
    S().soundsToMic = !S().soundsToMic;
    applyMixer();
    toast(S().soundsToMic ? 'Sounds → mic ON' : 'Sounds → mic OFF (only you hear)');
  } else if (action === 'togglePassthrough') {
    if (isDirect()) { toast('Direct mode never mutes your mic - use the Discord / game mute instead'); return; }
    S().passthrough = !S().passthrough;
    applyMicInput();
    toast(isDirect() ? (S().passthrough ? 'Your voice is ON' : 'Your voice is MUTED (sounds still play)') : (S().passthrough ? 'Mic passthrough ON' : 'Mic passthrough OFF'));
  }
  save();
});

/* ============================== playback / push-to-talk ============================== */
let pttHeld = false;
let pttTimer = null;

// Push-to-talk, play modes and counting plays all happen in the backend (so they also work
// from hotkeys and the Stream Deck with the window closed). The page just shows the state.
function pttPress() { return 0; }
function pttMaybeRelease() {}
void pttTimer;

async function trigger(id, { monitorOnly = false } = {}) {
  const s = findSound(id);
  if (!s) return;
  try {
    await api.sb.trigger(id, monitorOnly, s);
  } catch (e) {
    console.error(e);
    toast(`Couldn't play “${s.name}”`, 'err');
  }
}

function onPlayed({ id }) {
  const s = findSound(id);
  if (!s) return;
  s.plays = (s.plays || 0) + 1;
  lib.recent = [id, ...lib.recent.filter((r) => r !== id)].slice(0, 40);
  save();
}

engine.onChange = () => {
  engine.updateDuck();
  sendVoice();
  pttMaybeRelease();
  renderNowbar();
  pushPlayingToRemote();
  wakeUi();
};

/* ============================== import ============================== */
async function importPaths(paths, { category, quiet = false } = {}) {
  if (!paths || !paths.length) return 0;
  const res = await api.importPaths(paths);
  if (!res.length) { if (!quiet) toast('No supported audio files found', 'err'); return 0; }
  return addImported(res, { category, quiet });
}

/** Adds files already copied into the library folder ([{ id, file, name }]) as sounds. */
async function addImported(res, { category, quiet = false, normalize = false } = {}) {
  const cat = category !== undefined ? category : (findCat(view.section) ? view.section : null);
  let ok = 0;
  for (const r of res) {
    const s = {
      id: r.id, name: r.name, file: r.file, category: cat, volume: 1, speed: 1,
      trimStart: 0, trimEnd: null, loop: false, normalize, hotkey: '', color: null,
      fav: false, plays: 0, added: Date.now(), duration: 0, peaks: [], rms: 0
    };
    try {
      Object.assign(s, await engine.analyse(s.file));
      lib.sounds.push(s);
      ok++;
    } catch (e) {
      console.warn('decode failed', r, e);
      api.deleteSound(r.file);
    }
    if (ok % 8 === 0) renderGrid();
  }
  save();
  renderAll();
  if (!quiet) toast(`Added ${ok} sound${ok === 1 ? '' : 's'}${res.length - ok ? ` · ${res.length - ok} couldn't be decoded` : ''}`, ok ? 'ok' : 'err');
  return ok;
}

/** Imports the sounds bundled with the app (assets/starter-sounds). Subfolders become boards. */
async function importStarterPack({ onlyIfNew = false } = {}) {
  let list = [];
  try { list = await api.starterSounds(); } catch { list = []; }
  if (!list.length) { if (!onlyIfNew) toast('No starter sounds in this build', 'err'); return; }
  const byBoard = new Map();
  for (const f of list) {
    if (!byBoard.has(f.board)) byBoard.set(f.board, []);
    byBoard.get(f.board).push(f.path);
  }
  let total = 0;
  for (const [board, paths] of byBoard) {
    let catId = null;
    if (board) {
      let c = lib.categories.find((x) => x.name.toLowerCase() === board.toLowerCase());
      if (!c) {
        c = { id: uid(), name: board, color: PALETTE[lib.categories.length % PALETTE.length] };
        lib.categories.push(c);
      }
      catId = c.id;
    }
    total += await importPaths(paths, { category: catId, quiet: true });
  }
  for (const snd of lib.sounds) if (/\(loop\)/i.test(snd.name) && snd.plays === 0) snd.loop = true;
  S().starterImported = true;
  save();
  renderAll();
  if (total) toast(`Added ${total} starter sound${total === 1 ? '' : 's'}`, 'ok');
}

async function deleteSounds(ids) {
  const list = ids.map(findSound).filter(Boolean);
  if (!list.length) return;
  const ok = await confirmBox(list.length === 1 ? `Delete “${list[0].name}”?` : `Delete ${list.length} sounds?`, 'The audio file is removed from your library.');
  if (!ok) return;
  for (const s of list) {
    engine.stopSound(s.id);
    engine.forget(s.file);
    api.deleteSound(s.file);
  }
  const set = new Set(ids);
  lib.sounds = lib.sounds.filter((s) => !set.has(s.id));
  lib.recent = lib.recent.filter((r) => !set.has(r));
  if (set.has(editingId)) closeInspector();
  save();
  syncHotkeys();
  renderAll();
}

/* ============================== rendering: sidebar ============================== */
function renderNav() {
  const counts = {
    all: lib.sounds.length,
    fav: lib.sounds.filter((s) => s.fav).length,
    recent: lib.recent.filter(findSound).length
  };
  $('#nav').innerHTML = [
    ['all', 'grid', 'All sounds'],
    ['fav', 'star', 'Favorites'],
    ['recent', 'clock', 'Recent']
  ].map(([id, ic, label]) => `<button class="nav-item ${view.section === id ? 'on' : ''}" data-sec="${id}">${icon(ic)}<span>${label}</span><em>${counts[id]}</em></button>`).join('');
}

function renderCats() {
  $('#cats').innerHTML = lib.categories.map((c) => {
    const n = lib.sounds.filter((s) => s.category === c.id).length;
    return `<button class="cat ${view.section === c.id ? 'on' : ''}" data-cat="${c.id}" style="--c:${c.color}"><i></i><span>${esc(c.name)}</span><em>${n}</em></button>`;
  }).join('') || '<p class="muted small pad-x">No boards yet.</p>';
}

function renderMixer() {
  for (const k of Object.keys(meterShown)) delete meterShown[k]; // meters are rebuilt below
  const st = S();
  $('#mixer').innerHTML = `
    <div class="mix-row">
      <div class="mix-label">${icon('head')}<span>You hear</span><b id="mv-monitor">${Math.round(st.monitorVolume * 100)}%</b></div>
      <div class="meter"><i id="m-mon"></i></div>
      <input type="range" class="range" min="0" max="1.5" step="0.01" value="${st.monitorVolume}" data-mix="monitorVolume" />
    </div>
    <div class="mix-row">
      <div class="mix-label">${icon('broadcast')}<span>${isDirect() ? 'Sounds → mic' : 'They hear'}</span><b id="mv-micOut">${Math.round(st.micOutVolume * 100)}%</b></div>
      <div class="meter"><i id="m-mic"></i></div>
      <input type="range" class="range" min="0" max="2" step="0.01" value="${st.micOutVolume}" data-mix="micOutVolume" />
    </div>
    <div class="mix-row">
      <div class="mix-label">${icon('mic')}<span>${isDirect() ? 'Your mic' : 'Your voice'}</span><b id="mv-voice">${isDirect() ? 'untouched' : (st.passthrough ? Math.round(st.voiceVolume * 100) + '%' : 'off')}</b></div>
      <div class="meter voice"><i id="m-voice"></i></div>
      ${isDirect() ? '' : `<input type="range" class="range" min="0" max="2" step="0.01" value="${st.voiceVolume}" data-mix="voiceVolume" ${st.passthrough ? '' : 'disabled'} />`}
    </div>
    <div class="mix-toggles">
      <button class="chip-toggle ${st.soundsToMic ? 'on' : ''}" data-tog="soundsToMic" title="Send sounds into the mic">${icon('broadcast')}<span>To mic</span></button>
      ${isDirect() ? '' : `<button class="chip-toggle ${st.passthrough ? 'on' : ''}" data-tog="passthrough" title="Pass your real mic through">${icon('mic')}<span>Voice</span></button>`}
      <button class="chip-toggle ${st.ptt.enabled ? 'on' : ''}" data-tog="ptt" title="Auto push-to-talk">${icon('key')}<span>PTT</span></button>
    </div>`;
}

function apoDiagText() {
  const st = apoStatus || {};
  const parts = [];
  parts.push(st.mapped ? 'buffer ok' : `buffer not open${st.openErr ? ' (error ' + st.openErr + ')' : ''}`);
  parts.push(st.loadAgeMs >= 0 ? 'plugin loaded' : 'plugin not seen yet');
  parts.push(st.apoAgeMs >= 0 && st.apoAgeMs < 1500 ? `processing in ${st.instances || 1} app(s) @ ${st.rate} Hz / ${st.channels} ch` : 'not processing');
  if (st.locks) parts.push(`locks ${st.locks}`);
  if (st.lastHr) parts.push(`last result 0x${(st.lastHr >>> 0).toString(16)}`);
  parts.push(`sent ${Math.round((st.framesIn || 0) / 48000)} s of audio`);
  return parts.join(' · ');
}

// Only touches the page when something actually changed: rewriting the pill restarts its
// animation and repaints the window, and the mic plugin reports its status twice a second.
let routeShown = '';
let diagShown = '';
function renderRoute() {
  const diag = document.getElementById('apo-diag');
  if (diag) {
    const t = 'Diagnostics: ' + apoDiagText();
    if (t !== diagShown || diag.textContent !== t) { diag.textContent = t; diagShown = t; }
  }
  let cls;
  let html;
  if (isDirect()) {
    const mics = defaultMics();
    const on = mics.filter((d) => d.installed);
    const name = shortName((on[0] || mics[0] || {}).name || 'your mic');
    if (on.length && apoLive()) {
      cls = 'live';
      html = `<i></i><span>LIVE</span><small>in ${esc(name)}</small>`;
    } else if (on.length) {
      cls = 'ready';
      html = `<i></i><span>Ready</span><small>${esc(name)}</small>`;
    } else {
      cls = 'off';
      html = `${icon('warn')}<span>Mic not enabled</span><small>Enable</small>`;
    }
  } else {
    const out = devices.outputs.find((d) => d.deviceId === S().micOutDevice);
    if (S().micOutDevice && routeOk.mic && out) {
      cls = 'live';
      html = `<i></i><span>LIVE</span><small>→ ${esc(shortName(out.label))}</small>`;
    } else {
      cls = 'off';
      html = `${icon('warn')}<span>Mic not routed</span><small>Set up</small>`;
    }
  }
  const key = cls + '|' + html;
  if (key === routeShown) return;
  routeShown = key;
  const pill = $('#route-pill');
  pill.className = 'route-pill no-drag ' + cls;
  pill.innerHTML = html;
}
const shortName = (l) => String(l || '').replace(/\s*\(.*?\)\s*/g, ' ').trim() || 'Device';

/* ============================== rendering: grid ============================== */
function visibleSounds() {
  let list;
  if (view.section === 'fav') list = lib.sounds.filter((s) => s.fav);
  else if (view.section === 'recent') list = lib.recent.map(findSound).filter(Boolean);
  else if (findCat(view.section)) list = lib.sounds.filter((s) => s.category === view.section);
  else list = lib.sounds.slice();

  const q = view.search.trim().toLowerCase();
  if (q) {
    const terms = q.split(/\s+/);
    list = list.filter((s) => {
      const hay = (s.name + ' ' + (findCat(s.category)?.name || '') + ' ' + Keys.label(s.hotkey)).toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }
  if (view.section !== 'recent') {
    const sort = S().sort;
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    else if (sort === 'plays') list.sort((a, b) => (b.plays || 0) - (a.plays || 0));
    else if (sort === 'duration') list.sort((a, b) => (a.duration || 0) - (b.duration || 0));
  }
  return list;
}

function renderBoardHead() {
  const c = findCat(view.section);
  const title = c ? c.name : { all: 'All sounds', fav: 'Favorites', recent: 'Recently played' }[view.section];
  const n = visibleSounds().length;
  $('#board-head').innerHTML = `
    <h1 ${c ? `style="--c:${c.color}"` : ''}>${c ? '<i></i>' : ''}${esc(title)}</h1>
    <span class="muted">${n} sound${n === 1 ? '' : 's'}</span>
    <div class="flex"></div>
    <span class="muted small hint">Click to play · <b>Shift</b>+click to preview (only you) · Right-click for more</span>`;
}

function soundDuration(s) {
  const d = s.trimEnd != null ? s.trimEnd - (s.trimStart || 0) : (s.duration || 0) - (s.trimStart || 0);
  return d / (s.speed || 1);
}

function padHTML(s) {
  return `
    <div class="pad ${editingId === s.id ? 'editing' : ''}" data-id="${s.id}" draggable="true" style="--c:${soundColor(s)}">
      <canvas class="wave"></canvas>
      <div class="pad-fill"></div>
      <div class="pad-top">
        ${s.hotkey ? `<kbd class="hk">${esc(Keys.label(s.hotkey))}</kbd>` : '<span class="hk empty" data-act="hotkey">+ key</span>'}
        <button class="fav ${s.fav ? 'on' : ''}" data-act="fav" title="Favorite">${icon('star')}</button>
      </div>
      <div class="pad-name" title="${esc(s.name)}">${esc(s.name)}</div>
      <div class="pad-meta">
        <span>${fmtTime(soundDuration(s))}</span>
        ${s.loop ? `<span class="tag">${icon('loop')}</span>` : ''}
        ${s.speed && s.speed !== 1 ? `<span class="tag">${s.speed}×</span>` : ''}
        ${s.volume !== 1 ? `<span class="tag">${Math.round(s.volume * 100)}%</span>` : ''}
        <span class="flex"></span>
        <button class="pad-edit" data-act="edit" title="Edit">${icon('edit')}</button>
      </div>
    </div>`;
}

function rowHTML(s, i) {
  const c = findCat(s.category);
  return `
    <div class="pad row ${editingId === s.id ? 'editing' : ''}" data-id="${s.id}" draggable="true" style="--c:${soundColor(s)}">
      <div class="pad-fill"></div>
      <span class="c-num">${i + 1}</span>
      <span class="c-play">${icon('play')}</span>
      <span class="c-name" title="${esc(s.name)}">${esc(s.name)}${s.loop ? `<em class="tag">${icon('loop')}</em>` : ''}</span>
      <span class="c-board">${c ? `<span class="board-chip" style="--b:${c.color}"><i></i>${esc(c.name)}</span>` : '<span class="muted">—</span>'}</span>
      <span class="c-key">${s.hotkey ? `<kbd class="hk">${esc(Keys.label(s.hotkey))}</kbd>` : '<span class="hk empty" data-act="hotkey">+ key</span>'}</span>
      <span class="c-dur">${fmtTime(soundDuration(s))}</span>
      <span class="c-vol">${Math.round((s.volume ?? 1) * 100)}%</span>
      <span class="c-plays">${s.plays || 0}</span>
      <span class="c-wave"><canvas class="wave"></canvas></span>
      <span class="c-act">
        <button class="fav ${s.fav ? 'on' : ''}" data-act="fav" title="Favorite">${icon('star')}</button>
        <button class="pad-edit" data-act="edit" title="Edit">${icon('edit')}</button>
      </span>
    </div>`;
}

function renderGrid() {
  const grid = $('#grid');
  const list = visibleSounds();
  const asList = S().layout === 'list';
  grid.className = asList ? 'list' : 'size-' + S().padSize;
  if (asList) {
    const sort = S().sort;
    const th = (key, label, cls) => `<span class="${cls} ${key ? 'sortable' : ''} ${key && sort === key ? 'sorted' : ''}" ${key ? `data-sort="${key}"` : ''}>${label}</span>`;
    grid.innerHTML = list.length
      ? `<div class="row head">${th('manual', '#', 'c-num')}<span class="c-play"></span>${th('name', 'Name', 'c-name')}<span class="c-board">Board</span><span class="c-key">Hotkey</span>${th('duration', 'Length', 'c-dur')}<span class="c-vol">Volume</span>${th('plays', 'Plays', 'c-plays')}<span class="c-wave">Waveform</span><span class="c-act"></span></div>` +
        list.map(rowHTML).join('')
      : '';
  } else {
    grid.innerHTML = list.map(padHTML).join('');
  }

  const empty = $('#empty');
  if (!list.length) {
    empty.hidden = false;
    empty.innerHTML = view.search
      ? `<div class="empty-card">${icon('search')}<h2>No matches</h2><p class="muted">Nothing matches “${esc(view.search)}”.</p></div>`
      : `<div class="empty-card">${icon('wave')}<h2>${lib.sounds.length ? 'This board is empty' : 'Your soundboard is empty'}</h2>
         <p class="muted">Drag audio files or folders anywhere in the window, or</p>
         <div class="row-gap"><button class="btn primary" data-empty="files">${icon('file')}Add files</button><button class="btn" data-empty="folder">${icon('folder')}Import folder</button></div></div>`;
  } else {
    empty.hidden = true;
  }
  requestAnimationFrame(drawWaves);
  renderBoardHead();
}

function drawWaves() {
  const dpr = devicePixelRatio || 1;
  for (const pad of $$('#grid .pad')) {
    const s = findSound(pad.dataset.id);
    const cv = $('canvas', pad);
    if (!s || !cv) continue;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (!w || !h) continue;
    cv.width = w * dpr;
    cv.height = h * dpr;
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    drawPeaks(g, s.peaks || [], w, h, soundColor(s), s);
  }
}

function drawPeaks(g, peaks, w, h, color, s, { alpha = 0.55, gap = 1.5 } = {}) {
  g.clearRect(0, 0, w, h);
  if (!peaks.length) return;
  const n = peaks.length;
  const bw = w / n;
  gap = Math.min(gap, bw * 0.35);
  const mid = h / 2;
  const d = s.duration || 1;
  const a = (s.trimStart || 0) / d;
  const b = (s.trimEnd != null ? s.trimEnd : d) / d;
  for (let i = 0; i < n; i++) {
    const v = Math.max(0.04, peaks[i]);
    const bh = v * h * 0.9;
    const t = (i + 0.5) / n;
    g.globalAlpha = t < a || t > b ? 0.12 : alpha;
    g.fillStyle = color;
    const x = i * bw;
    roundRect(g, x + gap / 2, mid - bh / 2, Math.max(0.5, bw - gap), bh, Math.max(0, Math.min(2, (bw - gap) / 2)));
  }
  g.globalAlpha = 1;
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
  g.fill();
}

/* ============================== now playing ============================== */
function renderNowbar() {
  const bar = $('#nowbar');
  const voices = [...engine.voices.values()].filter((v) => !v.stopping);
  bar.classList.toggle('active', voices.length > 0);
  const chips = voices.slice(-6).map((v) => {
    const s = findSound(v.soundId);
    return `<div class="np" data-voice="${v.id}" style="--c:${s ? soundColor(s) : '#fff'}">
      <div class="np-fill"></div>
      <span class="np-ico">${v.toMic ? icon('broadcast') : icon('head')}</span>
      <span class="np-name">${esc(v.name)}</span>
      <button data-stopvoice="${v.id}" title="Stop">${icon('x')}</button>
    </div>`;
  }).join('');
  const hk = S().hotkeys.stopAll;
  bar.innerHTML = `
    <div class="np-list">${chips || `<span class="muted small idle">${icon('wave')} Nothing playing</span>`}</div>
    ${S().ptt.enabled ? `<span class="ptt-ind ${pttHeld ? 'on' : ''}" title="Auto push-to-talk">${icon('key')} PTT ${esc(Keys.label(S().ptt.key) || '—')}</span>` : ''}
    <button class="btn stop-all ${voices.length ? '' : 'dim'}" id="stop-all">${icon('stop')}Stop all${hk ? `<kbd>${esc(Keys.label(hk))}</kbd>` : ''}</button>`;
}

/* ============================== inspector ============================== */
let fineWave = null; // high-res peaks for the open sound

function openInspector(id) {
  editingId = id;
  fineWave = null;
  renderInspector();
  $('#inspector').classList.add('open');
  $('#inspector').setAttribute('aria-hidden', 'false');
  $$('#grid .pad').forEach((p) => p.classList.toggle('editing', p.dataset.id === id));
  const s = findSound(id);
  if (s) {
    engine.analyse(s.file, 150).then((r) => {
      if (editingId !== id) return;
      fineWave = r.peaks;
      drawTrim();
    }).catch(() => {});
  }
}
function closeInspector() {
  editingId = null;
  $('#inspector').classList.remove('open');
  $('#inspector').setAttribute('aria-hidden', 'true');
  $$('#grid .pad.editing').forEach((p) => p.classList.remove('editing'));
}

function numField(key, label, { min, max, step, value, fmt, unit = '' }) {
  return `<div class="field">
    <div class="field-top"><label>${label}</label>
      <span class="num-wrap"><input type="number" class="num" data-num="${key}" min="${min}" max="${max}" step="${step}" value="${fmt ? fmt(value) : value}" />${unit ? `<em>${unit}</em>` : ''}</span>
    </div>
    <input type="range" class="range" data-rng="${key}" min="${min}" max="${max}" step="${step}" value="${value}" />
  </div>`;
}

function renderInspector() {
  const s = findSound(editingId);
  const el = $('#inspector');
  if (!s) { el.innerHTML = ''; return; }
  const d = s.duration || 0;
  el.innerHTML = `
    <div class="insp-head">
      <span class="dot" style="--c:${soundColor(s)}"></span>
      <h2>Edit sound</h2>
      <button class="icon-btn sm" id="insp-close" title="Close">${icon('x')}</button>
    </div>
    <div class="insp-body">
      <div class="field"><label>Name</label><input class="input" id="f-name" value="${esc(s.name)}" spellcheck="false" /></div>

      <div class="trim">
        <div class="trim-head"><label>Trim</label><span class="muted small">${fmtTime(d)} total · drag the handles</span></div>
        <canvas id="trim-cv"></canvas>
        <div class="trim-nums">
          <span class="num-wrap"><em>Start</em><input type="number" class="num" id="f-ts" min="0" max="${d.toFixed(2)}" step="0.01" value="${(s.trimStart || 0).toFixed(2)}" /><em>s</em></span>
          <button class="btn ghost sm" id="f-trim-reset">Reset</button>
          <span class="num-wrap"><em>End</em><input type="number" class="num" id="f-te" min="0" max="${d.toFixed(2)}" step="0.01" value="${(s.trimEnd != null ? s.trimEnd : d).toFixed(2)}" /><em>s</em></span>
        </div>
      </div>

      <div class="row-gap">
        <button class="btn primary grow" id="f-play">${icon('play')}Play</button>
        <button class="btn grow" id="f-preview" title="Only you hear it">${icon('head')}Preview</button>
        <button class="btn icon" id="f-stop" title="Stop">${icon('stop')}</button>
      </div>

      <div class="field">
        <label>Hotkey</label>
        <button class="hk-btn" id="f-hotkey">${s.hotkey ? `<kbd>${esc(Keys.label(s.hotkey))}</kbd>` : '<span class="muted">Click to bind…</span>'}</button>
      </div>

      ${numField('volume', 'Volume', { min: 0, max: 3, step: 0.01, value: s.volume, unit: '%', fmt: (v) => Math.round(v * 100) })}
      ${numField('speed', 'Speed / pitch', { min: 0.25, max: 3, step: 0.01, value: s.speed || 1, unit: '×', fmt: (v) => Number(v).toFixed(2) })}

      <div class="toggles">
        <label class="switch"><input type="checkbox" id="f-loop" ${s.loop ? 'checked' : ''}/><span></span>Loop</label>
        <label class="switch" title="Match loudness to other sounds"><input type="checkbox" id="f-norm" ${s.normalize ? 'checked' : ''}/><span></span>Normalize loudness</label>
      </div>

      <div class="field">
        <label>Board</label>
        <select class="select full" id="f-cat">
          <option value="">— None —</option>
          ${lib.categories.map((c) => `<option value="${c.id}" ${s.category === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </div>

      <div class="field">
        <label>Color</label>
        <div class="swatches" id="f-color">
          <button data-c="" class="auto ${!s.color ? 'on' : ''}" title="Use board color">A</button>
          ${PALETTE.map((c) => `<button data-c="${c}" style="--c:${c}" class="${s.color === c ? 'on' : ''}"></button>`).join('')}
        </div>
      </div>

      <div class="stats muted small">Played ${s.plays || 0}× · added ${new Date(s.added || Date.now()).toLocaleDateString()}</div>
      <div class="row-gap">
        <button class="btn ghost grow" id="f-reveal">${icon('folder')}Show file</button>
        <button class="btn danger grow" id="f-delete">${icon('trash')}Delete</button>
      </div>
    </div>`;
  bindInspector(s);
  requestAnimationFrame(drawTrim);
}

function bindInspector(s) {
  const el = $('#inspector');
  const update = (patch, { grid = true } = {}) => {
    Object.assign(s, patch);
    save();
    if (grid) renderGrid();
  };
  $('#insp-close').onclick = closeInspector;
  $('#f-name').addEventListener('input', (e) => update({ name: e.target.value || 'Untitled' }));
  $('#f-play').onclick = () => trigger(s.id);
  $('#f-preview').onclick = () => trigger(s.id, { monitorOnly: true });
  $('#f-stop').onclick = () => engine.stopSound(s.id);
  $('#f-hotkey').onclick = () => setSoundHotkey(s.id);
  $('#f-loop').onchange = (e) => update({ loop: e.target.checked });
  $('#f-norm').onchange = (e) => {
    update({ normalize: e.target.checked });
    engine.setVoiceVolume(s.id, s.volume * (s.normalize ? AudioEngine.normGain(s.rms) : 1));
  };
  $('#f-cat').onchange = (e) => { update({ category: e.target.value || null }); renderCats(); renderInspector(); };
  $('#f-color').onclick = (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    update({ color: b.dataset.c || null });
    renderInspector();
  };
  $('#f-reveal').onclick = () => api.revealSound(s.file);
  $('#f-delete').onclick = () => deleteSounds([s.id]);

  // number + range pairs
  const conv = {
    volume: { toVal: (n) => n / 100, toNum: (v) => Math.round(v * 100) },
    speed: { toVal: (n) => n, toNum: (v) => Number(v).toFixed(2) }
  };
  $$('[data-rng]', el).forEach((r) => {
    r.addEventListener('input', () => {
      const k = r.dataset.rng;
      const v = Number(r.value);
      $(`[data-num="${k}"]`, el).value = conv[k].toNum(v);
      applyField(s, k, v);
    });
  });
  $$('[data-num]', el).forEach((n) => {
    n.addEventListener('change', () => {
      const k = n.dataset.num;
      let v = conv[k].toVal(Number(n.value));
      const r = $(`[data-rng="${k}"]`, el);
      v = clamp(isFinite(v) ? v : 1, Number(r.min), Number(r.max));
      r.value = v;
      n.value = conv[k].toNum(v);
      applyField(s, k, v);
    });
  });

  // trim numbers
  const d = s.duration || 0;
  $('#f-ts').addEventListener('change', (e) => {
    const end = s.trimEnd != null ? s.trimEnd : d;
    update({ trimStart: clamp(Number(e.target.value) || 0, 0, end - 0.01) });
    e.target.value = s.trimStart.toFixed(2);
    drawTrim();
  });
  $('#f-te').addEventListener('change', (e) => {
    let v = clamp(Number(e.target.value) || d, (s.trimStart || 0) + 0.01, d);
    update({ trimEnd: v >= d - 0.005 ? null : v });
    e.target.value = (s.trimEnd != null ? s.trimEnd : d).toFixed(2);
    drawTrim();
  });
  $('#f-trim-reset').onclick = () => {
    update({ trimStart: 0, trimEnd: null });
    $('#f-ts').value = '0.00';
    $('#f-te').value = d.toFixed(2);
    drawTrim();
  };
  bindTrimDrag(s);
}

let fieldSaveTimer = null;
function applyField(s, k, v) {
  s[k] = v;
  if (k === 'volume') engine.setVoiceVolume(s.id, v * (s.normalize ? AudioEngine.normGain(s.rms) : 1));
  save();
  clearTimeout(fieldSaveTimer);
  fieldSaveTimer = setTimeout(renderGrid, 250);
}

function trimGeom() {
  const cv = $('#trim-cv');
  if (!cv) return null;
  return { cv, w: cv.clientWidth, h: cv.clientHeight };
}

function drawTrim() {
  const s = findSound(editingId);
  const geo = trimGeom();
  if (!s || !geo || !geo.w) return;
  const { cv, w, h } = geo;
  const dpr = devicePixelRatio || 1;
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const color = soundColor(s);
  drawPeaks(g, fineWave || s.peaks || [], w, h, color, s, { alpha: 0.85, gap: 1 });
  const d = s.duration || 1;
  const xa = ((s.trimStart || 0) / d) * w;
  const xb = ((s.trimEnd != null ? s.trimEnd : d) / d) * w;
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(0, 0, xa, h);
  g.fillRect(xb, 0, w - xb, h);
  for (const x of [xa, xb]) {
    g.fillStyle = color;
    g.fillRect(x - 1, 0, 2, h);
    roundRectFill(g, x - 5, h / 2 - 14, 10, 28, 4, color);
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(x - 1.5, h / 2 - 6, 1, 12);
    g.fillRect(x + 0.5, h / 2 - 6, 1, 12);
  }
  // playheads
  for (const v of engine.voicesFor(s.id)) {
    const p = engine.progress(v);
    const t = (s.trimStart || 0) + p * ((s.trimEnd != null ? s.trimEnd : d) - (s.trimStart || 0));
    const x = (t / d) * w;
    g.fillStyle = '#fff';
    g.fillRect(x - 0.75, 0, 1.5, h);
  }
}
function roundRectFill(g, x, y, w, h, r, c) { g.fillStyle = c; roundRect(g, x, y, w, h, r); }

function bindTrimDrag(s) {
  const cv = $('#trim-cv');
  if (!cv) return;
  let which = null;
  const d = () => s.duration || 1;
  const tAt = (e) => clamp(((e.clientX - cv.getBoundingClientRect().left) / cv.clientWidth) * d(), 0, d());
  cv.addEventListener('pointerdown', (e) => {
    const t = tAt(e);
    const a = s.trimStart || 0;
    const b = s.trimEnd != null ? s.trimEnd : d();
    which = Math.abs(t - a) <= Math.abs(t - b) ? 'a' : 'b';
    cv.setPointerCapture(e.pointerId);
    move(e);
  });
  const move = (e) => {
    if (!which) return;
    const t = tAt(e);
    if (which === 'a') s.trimStart = clamp(t, 0, (s.trimEnd != null ? s.trimEnd : d()) - 0.02);
    else {
      const v = clamp(t, (s.trimStart || 0) + 0.02, d());
      s.trimEnd = v >= d() - 0.005 ? null : v;
    }
    $('#f-ts').value = (s.trimStart || 0).toFixed(2);
    $('#f-te').value = (s.trimEnd != null ? s.trimEnd : d()).toFixed(2);
    drawTrim();
  };
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', () => {
    if (!which) return;
    which = null;
    save();
    renderGrid();
  });
}

/* ============================== settings ============================== */
async function refreshDevices() {
  try {
    const d = await api.sb.devices();
    devices.inputs = d.inputs || [];
    devices.outputs = d.outputs || [];
  } catch (e) {
    console.warn('devices', e);
  }
}

function findCable() {
  const pats = [/cable input/i, /vb-audio/i, /voicemeeter input/i, /virtual/i];
  for (const p of pats) {
    const d = devices.outputs.find((o) => p.test(o.label) && o.deviceId !== 'default');
    if (d) return d;
  }
  return null;
}
function findRealMic() {
  return devices.inputs.find((d) => d.deviceId === 'default' && !/cable output|vb-audio|voicemeeter/i.test(d.label))
    || devices.inputs.find((d) => !/cable output|vb-audio|voicemeeter/i.test(d.label));
}

async function applyRouting() {
  routeOk.monitor = await engine.setMonitorSink(S().monitorDevice);
  if (!routeOk.monitor) toast('Headphone device unavailable — using system default', 'err');
  if (isDirect()) {
    try {
      await engine.setDirect(true, (buf) => api.apo.push(buf));
      await api.apo.start();
      routeOk.mic = true;
    } catch (e) {
      console.error(e);
      routeOk.mic = false;
      toast("Couldn't start direct-to-mic audio", 'err');
    }
    sendVoice();
  } else {
    if (engine.tap) await engine.setDirect(false);
    api.apo.stop();
    routeOk.mic = S().micOutDevice ? await engine.setMicSink(S().micOutDevice) : (await engine.setMicSink(''), false);
    if (S().micOutDevice && !routeOk.mic) toast('Mic output device unavailable', 'err');
  }
  renderRoute();
}
async function applyMicInput() {
  // Direct mode: your voice reaches games natively; we only open the mic to show its level.
  const dev = isDirect() ? 'default' : S().micInDevice;
  const open = isDirect() ? true : S().passthrough;
  micInputOk = await engine.setMicInput(dev, open, { noiseSuppression: !isDirect() && S().noiseSuppression });
  if (open && !micInputOk && !isDirect()) toast("Couldn't open your microphone", 'err');
  sendVoice();
  renderMixer();
}
/** Direct mode: tell the plugin how loud your real voice should be (mute / duck / boost). */
let lastVoiceSent = null;
function sendVoice() {
  if (!isDirect() || !api.apo) return;
  const st = S();
  // Direct mode: EZ Soundboard only ADDS sounds. Your voice is never changed, except by the
  // optional "lower my voice while a sound plays" setting, and only while one plays.
  let g = 1;
  if (engine.isDucking()) g *= st.duckLevel;
  g = Math.round(g * 1000) / 1000;
  if (g === lastVoiceSent) return;
  lastVoiceSent = g;
  api.apo.setVoice(g);
}
async function refreshApo() {
  if (!apoAvail) return apoInfo;
  try { apoInfo = await api.apo.list(); } catch (e) { apoInfo = { ok: false, devices: [], error: String(e) }; }
  if (!apoInfo || !Array.isArray(apoInfo.devices)) apoInfo = { ok: false, devices: [] };
  renderRoute();
  return apoInfo;
}
const defaultMics = () => apoInfo.devices.filter((d) => d.default || d.defaultComm);
const apoLive = () => apoStatus.mapped && apoStatus.apoAgeMs >= 0 && apoStatus.apoAgeMs < 1500;

/** One UAC prompt, then Windows Audio restarts (~2 s) and the mic is ready. */
async function applyApo(enable, disable) {
  toast('Approve the Windows prompt to update your mic…');
  const r = await api.apo.apply(enable, disable);
  if (!r.ok) {
    toast("Mic wasn't changed (permission declined or failed)", 'err');
  } else {
    toast(enable.length ? 'EZ Soundboard is now in your mic' : 'Mic restored', 'ok');
  }
  // Windows Audio restarted: reopen our audio devices.
  await new Promise((res) => setTimeout(res, 1500));
  await refreshDevices();
  await applyRouting();
  await applyMicInput();
  await refreshApo();
  return r.ok;
}

async function startupMicCheck() {
  if (!isDirect() || !S().checkMicOnStartup) return;
  await refreshApo();
  const missing = defaultMics().filter((d) => !d.installed);
  if (!missing.length) return;
  const names = [...new Set(missing.map((d) => d.name))].join(' and ');
  let done = false;
  const m = modal(`
    <div class="mic-ask">
      <div class="rec-ring">${icon('mic')}</div>
      <h3>Turn on EZ Soundboard for your mic?</h3>
      <p class="muted">Sounds will play through <b>${esc(names)}</b> in CS2, Discord and every other app — your voice keeps working normally. No extra software needed.</p>
      <label class="switch small"><input type="checkbox" id="ask-again"/><span></span>Don't ask again</label>
      <div class="modal-actions"><button class="btn ghost" data-close>Not now</button><button class="btn primary" id="mic-enable">${icon('check')}Enable</button></div>
    </div>`, { onClose: () => { if ($('#ask-again')?.checked) { S().checkMicOnStartup = false; save(); } } });
  $('#mic-enable', m.el).onclick = async () => {
    if (done) return;
    done = true;
    m.close();
    await applyApo(missing.map((d) => d.guid), []);
  };
}

function renderRoutingPane(pane) {
  if (!pane) return;
  const st = S();
  const direct = isDirect();
  const cable = findCable();
  const modeCards = `
    <div class="mode-cards">
      <button data-micmode="direct" class="${direct ? 'on' : ''}" ${apoAvail ? '' : 'disabled'}>
        ${icon('mic')}<b>Direct to mic</b><small>${apoAvail ? 'Built in · nothing else to install · recommended' : 'Not included in this build'}</small>
      </button>
      <button data-micmode="cable" class="${!direct ? 'on' : ''}">
        ${icon('broadcast')}<b>Virtual cable</b><small>Uses VB-CABLE · for setups where direct mode can't be used</small>
      </button>
    </div>`;

  let body = '';
  if (direct) {
    const rows = apoInfo.devices.map((d) => {
      const status = d.installed
        ? (d.default || d.defaultComm) && apoLive() ? '<span class="st good">Good</span>' : '<span class="st ok">Ready</span>'
        : '<span class="st off">Off</span>';
      return `<label class="mic-row ${d.installed ? 'on' : ''}">
        <input type="checkbox" data-guid="${esc(d.guid)}" ${d.installed ? 'checked' : ''}/>
        <span class="box">${icon('check')}</span>
        <span class="mic-name">${esc(d.name || 'Microphone')}
          ${d.default ? '<em class="badge">Default</em>' : ''}${d.defaultComm && !d.default ? '<em class="badge">Default comms</em>' : ''}</span>
        ${status}
      </label>`;
    }).join('') || `<p class="muted small">${apoInfo.error ? 'Could not read microphones: ' + esc(apoInfo.error) : 'No microphones found.'}</p>`;
    body = `
      <div class="flow">
        <div class="flow-node">${icon('mic')}<span>Your mic</span></div><i></i>
        <div class="flow-node accent">${icon('wave')}<span>+ EZ Soundboard</span></div><i></i>
        <div class="flow-node">${icon('bolt')}<span>CS2 · Discord · OBS<br><small>no settings to change</small></span></div>
      </div>
      <div class="form">
        <label>Play sounds through these microphones</label>
        <div class="mic-list" id="mic-list">${rows}</div>
        <div class="row-gap"><button class="btn primary" id="mic-apply" disabled>${icon('check')}Apply</button>
          <button class="btn ghost" id="mic-refresh">Refresh</button>
          <span class="muted small">Changing mics asks for permission once and briefly restarts Windows audio.</span></div>
        <div class="toggles col">
          <label class="switch"><input type="checkbox" id="s-check" ${st.checkMicOnStartup ? 'checked' : ''}/><span></span>Check my default mic on startup</label>
          <label class="switch"><input type="checkbox" id="s-duck" ${st.duck ? 'checked' : ''}/><span></span>Lower my voice only while a sound plays (optional - set the level in Playback, 0% = block)</label>
        </div>
        <p class="muted small">Discord: if sounds get cut off, turn off <b>Krisp / noise suppression</b> in Voice &amp; Video. Most games and apps already use your default mic, so nothing else changes.</p>
        <p class="diag small" id="apo-diag">Diagnostics: ${esc(apoDiagText())}</p>
      </div>`;
  } else {
    body = `
      <div class="guide ${cable ? 'ok' : ''}">
        <div class="guide-ico">${cable ? icon('check') : icon('warn')}</div>
        <div>
          <b>${cable ? `Virtual cable found: ${esc(shortName(cable.label))}` : 'Install a virtual audio cable'}</b>
          <p class="muted small">${cable
            ? 'Set <b>Sounds → Mic output</b> to it below, then pick <b>CABLE Output</b> as your microphone in CS2 / Discord / OBS.'
            : 'This mode plays into a virtual microphone. Install the free <b>VB-Audio Virtual Cable</b> and restart EZ Soundboard.'}</p>
          ${cable ? '' : '<button class="btn sm primary" id="get-cable">Get VB-CABLE (free)' + icon('ext') + '</button>'}
        </div>
      </div>
      <div class="form">
        <label>Sounds → Mic output <small class="muted">(what others hear)</small></label>
        <select class="select full" id="s-micout">${deviceOptions(devices.outputs, st.micOutDevice, { none: true, noneLabel: 'Not routed (only you hear)' })}</select>
        <label>Your real microphone</label>
        <select class="select full" id="s-micin">${deviceOptions(devices.inputs, st.micInDevice)}</select>
        <div class="toggles col">
          <label class="switch"><input type="checkbox" id="s-pass" ${st.passthrough ? 'checked' : ''}/><span></span>Mic passthrough — mix my voice into the virtual mic</label>
          <label class="switch"><input type="checkbox" id="s-ns" ${st.noiseSuppression ? 'checked' : ''}/><span></span>Noise suppression on my voice</label>
          <label class="switch"><input type="checkbox" id="s-duck" ${st.duck ? 'checked' : ''}/><span></span>Duck my voice while a sound plays</label>
        </div>
        <p class="muted small">CS2 uses the Windows <b>default</b> recording device — set <b>CABLE Output</b> as default in Windows Sound settings → Recording.</p>
      </div>`;
  }

  pane.innerHTML = `${modeCards}${body}
    <div class="form">
      <label>Your headphones <small class="muted">(what you hear)</small></label>
      <select class="select full" id="s-monitor"><option value="">System default</option>${deviceOptions(devices.outputs.filter((d) => d.deviceId !== 'default'), st.monitorDevice)}</select>
    </div>`;

  // ---- bindings
  $$('[data-micmode]', pane).forEach((b) => (b.onclick = async () => {
    if (b.dataset.micmode === st.micMode) return;
    st.micMode = b.dataset.micmode;
    save();
    await applyRouting();
    await applyMicInput();
    if (isDirect()) await refreshApo();
    renderRoutingPane(pane);
    renderMixer();
  }));
  const on = (id, ev, fn) => { const e = $(id, pane); if (e) e[ev] = fn; };
  on('#s-monitor', 'onchange', async (e) => { st.monitorDevice = e.target.value; save(); await applyRouting(); });
  on('#s-duck', 'onchange', (e) => { st.duck = e.target.checked; save(); applyMixer(); });
  on('#get-cable', 'onclick', () => api.openExternal('https://vb-audio.com/Cable/'));
  on('#s-micout', 'onchange', async (e) => { st.micOutDevice = e.target.value; save(); await applyRouting(); });
  on('#s-micin', 'onchange', async (e) => { st.micInDevice = e.target.value; save(); await applyMicInput(); });
  on('#s-pass', 'onchange', async (e) => { st.passthrough = e.target.checked; save(); await applyMicInput(); });
  on('#s-ns', 'onchange', async (e) => { st.noiseSuppression = e.target.checked; save(); await applyMicInput(); });
  on('#s-check', 'onchange', (e) => { st.checkMicOnStartup = e.target.checked; save(); });
  on('#mic-refresh', 'onclick', async () => { await refreshApo(); renderRoutingPane(pane); });
  const list = $('#mic-list', pane);
  if (list) {
    const diff = () => {
      const enable = [], disable = [];
      $$('input[data-guid]', list).forEach((c) => {
        const d = apoInfo.devices.find((x) => x.guid === c.dataset.guid);
        if (!d) return;
        if (c.checked && !d.installed) enable.push(d.guid);
        if (!c.checked && d.installed) disable.push(d.guid);
        c.closest('.mic-row').classList.toggle('on', c.checked);
      });
      return { enable, disable };
    };
    list.onchange = () => { const d = diff(); $('#mic-apply', pane).disabled = !(d.enable.length || d.disable.length); };
    on('#mic-apply', 'onclick', async () => {
      const d = diff();
      $('#mic-apply', pane).disabled = true;
      await applyApo(d.enable, d.disable);
      renderRoutingPane(pane);
    });
  }
}

function applyMixer() {
  const st = S();
  engine.setVolumes({ monitor: st.monitorVolume, micOut: st.micOutVolume, voice: st.voiceVolume });
  engine.setSoundsToMic(st.soundsToMic);
  engine.setLimiter(st.limiter);
  engine.setDuck(st.duck, st.duckLevel);
  renderMixer();
}
function applyAccent() {
  document.documentElement.style.setProperty('--accent', S().accent);
}

function deviceOptions(list, selected, { none = false, noneLabel = 'None' } = {}) {
  let html = none ? `<option value="">${noneLabel}</option>` : '';
  html += list.map((d) => `<option value="${esc(d.deviceId)}" ${d.deviceId === selected ? 'selected' : ''}>${esc(d.deviceId === 'default' ? 'System default — ' + shortName(d.label.replace(/^Default - /, '')) : d.label || 'Unnamed device')}</option>`).join('');
  return html;
}

async function openSettings(tab = 'routing') {
  await refreshDevices();
  const st = S();
  if (apoAvail) await refreshApo();
  await refreshRemoteStatus();
  const tabs = [['routing', 'mic', 'Microphone'], ['ptt', 'key', 'Push-to-talk'], ['hotkeys', 'bolt', 'Hotkeys'], ['playback', 'play', 'Playback'], ['look', 'grid', 'Appearance'], ['streamdeck', 'deck', 'Stream Deck'], ['updates', 'refresh', 'Updates']];
  const m = modal(`
    <div class="set-head"><h3>Settings</h3><button class="icon-btn sm" data-close>${icon('x')}</button></div>
    <div class="set">
      <nav class="set-nav">${tabs.map(([id, ic, l]) => `<button data-tab="${id}" class="${tab === id ? 'on' : ''}">${icon(ic)}${l}</button>`).join('')}</nav>
      <div class="set-body">

        <section data-pane="routing" id="routing-pane"></section>

        <section data-pane="ptt">
          <p class="muted">Holds your voice key automatically while a sound is playing into the mic — so teammates hear it even with push-to-talk.</p>
          <div class="toggles col"><label class="switch"><input type="checkbox" id="s-ptt" ${st.ptt.enabled ? 'checked' : ''}/><span></span>Enable auto push-to-talk</label></div>
          <div class="form">
            <label>Voice key (same as in game)</label>
            <button class="hk-btn" id="s-pttkey">${st.ptt.key ? `<kbd>${esc(Keys.label(st.ptt.key))}</kbd>` : '<span class="muted">Click to bind…</span>'}</button>
            <div class="two">
              <div><label>Press before sound</label><span class="num-wrap"><input type="number" class="num" id="s-pre" min="0" max="1000" step="10" value="${st.ptt.preDelay}"/><em>ms</em></span></div>
              <div><label>Release after sound</label><span class="num-wrap"><input type="number" class="num" id="s-rel" min="0" max="3000" step="10" value="${st.ptt.release}"/><em>ms</em></span></div>
            </div>
            <p class="muted small">Games often need ~50–120 ms after the key goes down before transmitting. If the start of sounds gets cut off, raise “Press before sound”.</p>
          </div>
        </section>

        <section data-pane="hotkeys">
          <div class="backend ${hotkeyBackend !== 'globalShortcut' ? 'ok' : ''}">
            ${hotkeyBackend !== 'globalShortcut'
              ? `${icon('check')}<span><b>Pass-through hotkeys active.</b> Keys still reach your game and Mouse 4/5 can be bound.${hotkeyBackend === 'native' ? ' Built for zero input lag: your mouse is only watched while Mouse 4/5 is bound, and mouse movement is never touched.' : ''}</span>`
              : `${icon('warn')}<span><b>Basic hotkeys.</b> Bound keys are captured by EZ Soundboard and Mouse 4/5 can't be bound. Reinstall EZ Soundboard to get pass-through hotkeys back.</span>`}
          </div>
          <div class="hk-list">
            ${[['stopAll', 'Stop all sounds'], ['toggleMic', 'Toggle sounds → mic'], ['togglePassthrough', 'Mute / unmute my voice']].map(([k, l]) => `
              <div class="hk-row"><span>${l}</span><button class="hk-btn" data-ghk="${k}">${st.hotkeys[k] ? `<kbd>${esc(Keys.label(st.hotkeys[k]))}</kbd>` : '<span class="muted">Not set</span>'}</button></div>`).join('')}
          </div>
          <p class="muted small">Per-sound hotkeys: right-click a pad → Set hotkey, or click “+ key” on the pad.</p>
        </section>

        <section data-pane="playback">
          <div class="form">
            <label>When a sound is triggered</label>
            <div class="radios" id="s-mode">
              ${[['overlap', 'Overlap', 'Layer sounds freely'], ['restart', 'Restart', 'Same sound restarts'], ['toggle', 'Toggle', 'Press again to stop'], ['exclusive', 'Exclusive', 'One sound at a time']].map(([v, l, d]) => `
                <button data-mode="${v}" class="${st.playMode === v ? 'on' : ''}"><b>${l}</b><small>${d}</small></button>`).join('')}
            </div>
            <div class="toggles col">
              <label class="switch"><input type="checkbox" id="s-lim" ${st.limiter ? 'checked' : ''}/><span></span>Limiter on mic output (prevents clipping / distortion)</label>
              <label class="switch"><input type="checkbox" id="s-tray" ${st.closeToTray ? 'checked' : ''}/><span></span>Close button minimizes to tray (hotkeys keep working)</label>
              <label class="switch"><input type="checkbox" id="s-power" ${st.powerSave ? 'checked' : ''}/><span></span>Save CPU when nothing is playing (the first sound after a pause may start a few milliseconds later)</label>
            </div>
            <label>Memory use <small class="muted">(how much decoded audio stays ready in RAM)</small></label>
            <div class="radios three" id="s-mem">
              ${[['low', 'Low', '48 MB · tiny footprint'], ['balanced', 'Balanced', '128 MB · recommended'], ['fast', 'Fast', '512 MB · big libraries']].map(([v, l, d]) => `
                <button data-mem="${v}" class="${st.memory === v ? 'on' : ''}"><b>${l}</b><small>${d}</small></button>`).join('')}
            </div>
            <p class="muted small">Hotkey and favorite sounds always stay ready. Others load in a few milliseconds the first time you play them.</p>
            <div class="toggles col">
              <label class="switch"><input type="checkbox" id="s-hwaccel" ${hwAccel ? 'checked' : ''}/><span></span>Hardware acceleration (turn off to save ~50–100 MB on some PCs · restart required)</label>
            </div>
            <label>Ducking level <small class="muted">(voice volume while sounds play)</small></label>
            <span class="num-wrap"><input type="number" class="num" id="s-ducklvl" min="0" max="100" step="5" value="${Math.round(st.duckLevel * 100)}"/><em>%</em></span>
          </div>
        </section>

        <section data-pane="streamdeck" id="deck-pane"></section>

        <section data-pane="updates" id="update-pane"></section>

        <section data-pane="look">
          <label>Accent color</label>
          <div class="swatches big" id="s-accent">${ACCENTS.map((c) => `<button data-c="${c}" style="--c:${c}" class="${st.accent === c ? 'on' : ''}"></button>`).join('')}
            <label class="custom-color" title="Custom"><input type="color" id="s-accent-custom" value="${st.accent}"/></label></div>
        </section>
      </div>
    </div>`, { wide: true, onClose: () => { renderAll(); } });

  const el = m.el;
  const show = (t) => {
    $$('.set-nav button', el).forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    $$('[data-pane]', el).forEach((p) => { p.hidden = p.dataset.pane !== t; });
  };
  show(tab);
  $$('.set-nav button', el).forEach((b) => (b.onclick = () => show(b.dataset.tab)));
  renderRoutingPane($('#routing-pane', el));
  renderDeckPane($('#deck-pane', el));
  renderUpdatePane($('#update-pane', el));

  $('#s-ptt', el).onchange = (e) => { st.ptt.enabled = e.target.checked; save(); renderMixer(); renderNowbar(); };
  $('#s-pttkey', el).onclick = async () => {
    const k = await recordHotkey({ title: 'Your push-to-talk key', mode: 'single', current: st.ptt.key });
    if (k === null) return;
    st.ptt.key = k;
    if (k) st.ptt.enabled = true;
    save();
    $('#s-pttkey', el).innerHTML = k ? `<kbd>${esc(Keys.label(k))}</kbd>` : '<span class="muted">Click to bind…</span>';
    $('#s-ptt', el).checked = st.ptt.enabled;
  };
  $('#s-pre', el).onchange = (e) => { st.ptt.preDelay = clamp(Number(e.target.value) || 0, 0, 1000); e.target.value = st.ptt.preDelay; save(); };
  $('#s-rel', el).onchange = (e) => { st.ptt.release = clamp(Number(e.target.value) || 0, 0, 3000); e.target.value = st.ptt.release; save(); };

  $$('[data-ghk]', el).forEach((b) => (b.onclick = async () => {
    const k = b.dataset.ghk;
    const v = await recordHotkey({ title: b.parentElement.firstElementChild.textContent, current: st.hotkeys[k] });
    if (v === null) return;
    st.hotkeys[k] = v;
    save();
    syncHotkeys();
    b.innerHTML = v ? `<kbd>${esc(Keys.label(v))}</kbd>` : '<span class="muted">Not set</span>';
  }));

  $('#s-mode', el).onclick = (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    st.playMode = b.dataset.mode;
    save();
    $$('#s-mode button', el).forEach((x) => x.classList.toggle('on', x === b));
    renderModeSeg();
  };
  $('#s-mem', el).onclick = (e) => {
    const b = e.target.closest('[data-mem]');
    if (!b) return;
    st.memory = b.dataset.mem;
    save();
    applyMemory();
    $$('#s-mem button', el).forEach((x) => x.classList.toggle('on', x === b));
  };
  $('#s-hwaccel', el).onchange = async (e) => {
    hwAccel = e.target.checked;
    await api.setHardwareAcceleration(hwAccel);
    toast('Restart EZ Soundboard to apply (tray icon → Quit, then open it again)');
  };
  $('#s-lim', el).onchange = (e) => { st.limiter = e.target.checked; save(); applyMixer(); };
  $('#s-power', el).onchange = (e) => { st.powerSave = e.target.checked; save(); if (!st.powerSave) engine.wake(); };
  $('#s-tray', el).onchange = (e) => { st.closeToTray = e.target.checked; api.win.setCloseToTray(st.closeToTray); save(); };
  $('#s-ducklvl', el).onchange = (e) => { st.duckLevel = clamp(Number(e.target.value) || 0, 0, 100) / 100; e.target.value = Math.round(st.duckLevel * 100); save(); applyMixer(); };

  const setAccent = (c) => { st.accent = c; applyAccent(); save(); $$('#s-accent [data-c]', el).forEach((b) => b.classList.toggle('on', b.dataset.c === c)); };
  $('#s-accent', el).onclick = (e) => { const b = e.target.closest('[data-c]'); if (b) setAccent(b.dataset.c); };
  $('#s-accent-custom', el).oninput = (e) => setAccent(e.target.value);
}

/* ============================== toolbar ============================== */
function renderModeSeg() {
  const modes = [['overlap', 'Overlap'], ['restart', 'Restart'], ['toggle', 'Toggle'], ['exclusive', 'Solo']];
  $('#mode-seg').innerHTML = modes.map(([v, l]) => `<button data-mode="${v}" class="${S().playMode === v ? 'on' : ''}">${l}</button>`).join('');
}
function renderLayoutSeg() {
  $('#layout-seg').innerHTML = [['grid', 'grid', 'Pads'], ['list', 'list', 'List']].map(([v, ic, t]) =>
    `<button data-layout="${v}" class="${S().layout === v ? 'on' : ''}" title="${t} view">${icon(ic)}</button>`).join('');
  $('#size-seg').hidden = S().layout === 'list';
}
function renderSizeSeg() {
  $('#size-seg').innerHTML = [['s', 'S'], ['m', 'M'], ['l', 'L']].map(([v, l]) => `<button data-size="${v}" class="${S().padSize === v ? 'on' : ''}" title="Pad size">${l}</button>`).join('');
}

function renderAll() {
  renderNav();
  renderCats();
  renderMixer();
  renderRoute();
  renderModeSeg();
  renderSizeSeg();
  renderLayoutSeg();
  $('#sort').value = S().sort;
  renderGrid();
  renderNowbar();
  if (editingId) renderInspector();
}

/* ============================== events ============================== */
function bindEvents() {
  $('#win-min').onclick = api.win.min;
  $('#win-max').onclick = api.win.max;
  $('#win-close').onclick = api.win.close;
  api.win.onMaximized((v) => document.body.classList.toggle('maximized', v));
  $('#route-pill').onclick = async () => {
    if (isDirect() && !defaultMics().some((d) => d.installed)) {
      const missing = defaultMics();
      if (missing.length) { await applyApo(missing.map((d) => d.guid), []); return; }
    }
    openSettings('routing');
  };
  $('#settings-btn').innerHTML = icon('gear');
  $('#settings-btn').onclick = () => openSettings();
  $('#add-cat').innerHTML = icon('plus');
  $('#add-cat').onclick = async () => {
    const name = await askText('New board', '', 'e.g. Clutch moments');
    if (!name) return;
    const c = { id: uid(), name, color: PALETTE[lib.categories.length % PALETTE.length] };
    lib.categories.push(c);
    view.section = c.id;
    save();
    renderAll();
  };
  $$('[data-icon]').forEach((e) => { e.outerHTML = icon(e.dataset.icon); });

  $('#import-btn').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.left, r.bottom + 6, [
      { label: 'Add files…', icon: 'file', action: async () => importPaths(await api.pickFiles()) },
      { label: 'Import folder…', icon: 'folder', action: async () => importPaths(await api.pickFolder()) },
      { label: 'Add from link…', icon: 'link', hint: 'Ctrl+V', action: () => openLinkDialog() },
      { label: 'Text to speech…', icon: 'speak', action: () => openTts() },
      '-',
      { label: 'Add starter sounds', icon: 'star', action: () => importStarterPack() }
    ]);
  };

  $('#search').addEventListener('input', (e) => { view.search = e.target.value; renderGrid(); });
  $('#sort').onchange = (e) => { S().sort = e.target.value; save(); renderGrid(); };
  $('#mode-seg').onclick = (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    S().playMode = b.dataset.mode;
    save();
    renderModeSeg();
  };
  $('#layout-seg').onclick = (e) => {
    const b = e.target.closest('[data-layout]');
    if (!b) return;
    S().layout = b.dataset.layout;
    save();
    renderLayoutSeg();
    renderGrid();
  };
  $('#size-seg').onclick = (e) => {
    const b = e.target.closest('[data-size]');
    if (!b) return;
    S().padSize = b.dataset.size;
    save();
    renderSizeSeg();
    renderGrid();
  };

  // sidebar
  $('#nav').onclick = (e) => {
    const b = e.target.closest('[data-sec]');
    if (!b) return;
    view.section = b.dataset.sec;
    renderNav(); renderCats(); renderGrid();
  };
  $('#cats').onclick = (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    view.section = b.dataset.cat;
    renderNav(); renderCats(); renderGrid();
  };
  $('#cats').addEventListener('dblclick', (e) => { const b = e.target.closest('[data-cat]'); if (b) renameCat(b.dataset.cat); });
  $('#cats').addEventListener('contextmenu', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    e.preventDefault();
    const c = findCat(b.dataset.cat);
    showMenu(e.clientX, e.clientY, [
      { label: 'Rename', icon: 'edit', action: () => renameCat(c.id) },
      { swatches: PALETTE, current: c.color, onPick: (col) => { c.color = col; save(); renderAll(); } },
      '-',
      { label: 'Delete board', icon: 'trash', danger: true, action: () => deleteCat(c.id) }
    ]);
  });
  // drag pads onto boards
  $('#cats').addEventListener('dragover', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b || !e.dataTransfer.types.includes('text/x-pad')) return;
    e.preventDefault();
    $$('#cats .cat').forEach((c) => c.classList.toggle('drop', c === b));
  });
  $('#cats').addEventListener('dragleave', () => $$('#cats .cat').forEach((c) => c.classList.remove('drop')));
  $('#cats').addEventListener('drop', (e) => {
    const b = e.target.closest('[data-cat]');
    const id = e.dataTransfer.getData('text/x-pad');
    $$('#cats .cat').forEach((c) => c.classList.remove('drop'));
    if (!b || !id) return;
    e.preventDefault();
    e.stopPropagation();
    const s = findSound(id);
    if (s) { s.category = b.dataset.cat; save(); renderAll(); toast(`Moved to ${findCat(b.dataset.cat).name}`, 'ok'); }
  });

  // mixer
  $('#mixer').addEventListener('input', (e) => {
    const k = e.target.dataset.mix;
    if (!k) return;
    S()[k] = Number(e.target.value);
    engine.setVolumes({ monitor: S().monitorVolume, micOut: S().micOutVolume, voice: S().voiceVolume });
    sendVoice();
    const map = { monitorVolume: 'mv-monitor', micOutVolume: 'mv-micOut', voiceVolume: 'mv-voice' };
    const lbl = document.getElementById(map[k]);
    if (lbl) lbl.textContent = Math.round(S()[k] * 100) + '%';
    save();
  });
  $('#mixer').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-tog]');
    if (!b) return;
    const k = b.dataset.tog;
    if (k === 'ptt') {
      if (!S().ptt.key) { openSettings('ptt'); return; }
      S().ptt.enabled = !S().ptt.enabled;
      renderMixer();
      renderNowbar();
    } else if (k === 'passthrough') {
      S().passthrough = !S().passthrough;
      await applyMicInput();
    } else {
      S()[k] = !S()[k];
      applyMixer();
    }
    save();
  });

  // grid
  const grid = $('#grid');
  grid.addEventListener('click', (e) => {
    const sortEl = e.target.closest('[data-sort]');
    if (sortEl) {
      S().sort = sortEl.dataset.sort;
      $('#sort').value = S().sort;
      save();
      renderGrid();
      return;
    }
    const pad = e.target.closest('.pad');
    if (!pad) return;
    const id = pad.dataset.id;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'fav') { const s = findSound(id); s.fav = !s.fav; save(); renderNav(); renderGrid(); return; }
    if (act === 'edit') { openInspector(id); return; }
    if (act === 'hotkey') { setSoundHotkey(id); return; }
    trigger(id, { monitorOnly: e.shiftKey });
  });
  grid.addEventListener('contextmenu', (e) => {
    const pad = e.target.closest('.pad');
    if (!pad) return;
    e.preventDefault();
    const s = findSound(pad.dataset.id);
    showMenu(e.clientX, e.clientY, [
      { label: 'Play', icon: 'play', action: () => trigger(s.id) },
      { label: 'Preview (only you)', icon: 'head', hint: 'Shift+Click', action: () => trigger(s.id, { monitorOnly: true }) },
      '-',
      { label: 'Edit…', icon: 'edit', action: () => openInspector(s.id) },
      { label: s.hotkey ? `Change hotkey (${Keys.label(s.hotkey)})` : 'Set hotkey…', icon: 'key', action: () => setSoundHotkey(s.id) },
      { label: s.fav ? 'Unfavorite' : 'Favorite', icon: 'star', action: () => { s.fav = !s.fav; save(); renderAll(); } },
      { label: 'Rename…', icon: 'edit', action: async () => { const n = await askText('Rename sound', s.name); if (n) { s.name = n; save(); renderAll(); } } },
      { swatches: PALETTE, current: s.color, onPick: (c) => { s.color = c; save(); renderAll(); } },
      '-',
      { label: 'Show file in Explorer', icon: 'folder', action: () => api.revealSound(s.file) },
      { label: 'Delete', icon: 'trash', danger: true, action: () => deleteSounds([s.id]) }
    ]);
  });
  grid.addEventListener('dragstart', (e) => {
    const pad = e.target.closest('.pad');
    if (!pad) return;
    e.dataTransfer.setData('text/x-pad', pad.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    pad.classList.add('dragging');
  });
  grid.addEventListener('dragend', (e) => e.target.closest?.('.pad')?.classList.remove('dragging'));

  $('#empty').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-empty]');
    if (!b) return;
    importPaths(b.dataset.empty === 'files' ? await api.pickFiles() : await api.pickFolder());
  });

  // now playing
  $('#nowbar').addEventListener('click', (e) => {
    const sv = e.target.closest('[data-stopvoice]');
    if (sv) { engine.stop(Number(sv.dataset.stopvoice)); return; }
    if (e.target.closest('#stop-all')) engine.stopAll();
  });

  // file drop
  let dragDepth = 0;
  const isFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!isFiles(e)) return; dragDepth++; document.body.classList.add('dropping'); });
  window.addEventListener('dragleave', (e) => { if (!isFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dropping'); });
  window.addEventListener('dragover', (e) => { if (isFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dropping');
    api.importDropped(e.dataTransfer).then((res) => {
      if (res.length) addImported(res);
      else toast('No supported audio files found', 'err');
    });
  });

  // local shortcuts
  document.addEventListener('keydown', (e) => {
    if (recording) return;
    if (e.ctrlKey && e.code === 'KeyF') { e.preventDefault(); $('#search').focus(); $('#search').select(); }
    else if (e.code === 'Escape') {
      if ($('#modal-root').children.length) return;
      if (document.activeElement === $('#search') && view.search) { view.search = ''; $('#search').value = ''; renderGrid(); }
      else if (editingId) closeInspector();
      else engine.stopAll();
    }
  });

  window.addEventListener('resize', () => { requestAnimationFrame(drawWaves); drawTrim(); });
  // Hidden in the tray / minimized: stop the mic level meter (direct mode only needs it for display).
  // Direct mode only opens the mic to show its level, so close it while you're not looking.
  const micMeterOn = () => {
    document.body.classList.toggle('away', awayFromWindow());
    if (!awayFromWindow()) wakeUi();
    if (!isDirect()) return;
    if (awayFromWindow()) engine.setMicInput(null, false);
    else { engine.wake(); applyMicInput(); }
  };
  document.addEventListener('visibilitychange', micMeterOn);
  window.addEventListener('blur', micMeterOn);
  window.addEventListener('focus', micMeterOn);
  // The backend reopens devices itself when one disappears; refresh what we show.
  api.sb.onRoute((r) => {
    routeOk.monitor = r.monitor;
    if (!isDirect()) routeOk.mic = r.mic;
    renderRoute();
  });
}

async function renameCat(id) {
  const c = findCat(id);
  const n = await askText('Rename board', c.name);
  if (!n) return;
  c.name = n;
  save();
  renderAll();
}
async function deleteCat(id) {
  const c = findCat(id);
  const n = lib.sounds.filter((s) => s.category === id).length;
  const ok = await confirmBox(`Delete board “${c.name}”?`, n ? `Its ${n} sound${n === 1 ? '' : 's'} stay in All sounds.` : 'This board is empty.');
  if (!ok) return;
  lib.categories = lib.categories.filter((x) => x.id !== id);
  lib.sounds.forEach((s) => { if (s.category === id) s.category = null; });
  if (view.section === id) view.section = 'all';
  save();
  renderAll();
}

/* ============================== animation loop ============================== */
const meterState = { mon: 0, mic: 0, voice: 0 };
// The UI redraws at 30 fps while focused and 10 fps in the background (e.g. on a second monitor
// while you play), instead of your monitor's refresh rate, and stops completely while hidden.
let uiTimer = null;
let framePending = false;
let padsLit = false;
function scheduleFrame() {
  if (uiTimer || framePending || document.hidden) return; // visibilitychange starts it again
  uiTimer = setTimeout(() => { uiTimer = null; framePending = true; requestAnimationFrame(frame); }, document.hasFocus() ? 33 : 100);
}
document.addEventListener('visibilitychange', scheduleFrame);

function frame() {
  framePending = false;
  if (document.hidden) return;
  // pads progress
  const prog = new Map();
  for (const v of engine.voices.values()) {
    if (v.stopping) continue;
    prog.set(v.soundId, Math.max(prog.get(v.soundId) || 0, engine.progress(v)));
  }
  // Nothing playing and no pad still lit: skip the pad pass entirely.
  const pads = prog.size || padsLit ? document.querySelectorAll('#grid .pad') : [];
  padsLit = prog.size > 0;
  for (const pad of pads) {
    const p = prog.get(pad.dataset.id);
    if (p !== undefined) {
      if (!pad.classList.contains('playing')) pad.classList.add('playing');
      pad.style.setProperty('--p', p.toFixed(4));
    } else if (pad.classList.contains('playing')) {
      pad.classList.remove('playing');
      pad.style.removeProperty('--p');
    }
  }
  for (const chip of document.querySelectorAll('#nowbar .np')) {
    const v = engine.voices.get(Number(chip.dataset.voice));
    if (v) chip.style.setProperty('--p', engine.progress(v).toFixed(4));
  }
  if (editingId && engine.voicesFor(editingId).length) drawTrim();

  // meters
  const lv = (k, an) => {
    const l = engine.level(an);
    meterState[k] = Math.max(l, meterState[k] * 0.9);
    return meterState[k];
  };
  const set = (sel, v) => {
    const db = v > 0 ? 20 * Math.log10(v) : -60;
    const tf = `scaleX(${clamp((db + 60) / 60, 0, 1).toFixed(2)})`;
    if (meterShown[sel] === tf) return; // unchanged: no repaint
    const e = document.getElementById(sel);
    if (!e) return;
    meterShown[sel] = tf;
    e.style.transform = tf;
    e.classList.toggle('hot', v > 0.95);
  };
  set('m-mon', lv('mon', engine.monAnalyser));
  set('m-mic', lv('mic', engine.micAnalyser));
  set('m-voice', lv('voice', engine.voiceAnalyser));
  // In the background with nothing playing and the meters at rest: stop redrawing entirely.
  // Playing a sound or coming back to the window starts it again.
  const quiet = !engine.voices.size && meterState.mon < 0.001 && meterState.mic < 0.001 && meterState.voice < 0.001;
  if (quiet && awayFromWindow()) { uiResting = true; return; }
  scheduleFrame();
}
const meterShown = {};
let uiResting = false;
function wakeUi() { if (uiResting) { uiResting = false; scheduleFrame(); } }

/* ============================== boot ============================== */
const MEMORY_MB = { low: 48, balanced: 128, fast: 512 };
function applyMemory() {
  engine.setCacheLimit((MEMORY_MB[S().memory] || 128) * 1024 * 1024);
  // Sounds you can trigger instantly (hotkeys / favorites) stay decoded.
  engine.pinned = new Set(lib.sounds.filter((s) => s.hotkey || s.fav).filter((s) => (s.duration || 0) <= 30).map((s) => s.file));
}

async function preloadBuffers() {
  // Decode hotkey / favorite sounds up front so they fire instantly; everything else decodes
  // on first play and is dropped again when the memory budget is reached. Short pauses between
  // files spread the work out, so start-up doesn't spike the CPU.
  applyMemory();
  const budget = engine.cacheLimit * 0.7;
  for (const s of lib.sounds) {
    if (!engine.pinned.has(s.file) || engine.isCached(s.file)) continue;
    if (engine.cacheBytes > budget) break;
    try { await engine.getBuffer(s.file); } catch { /* missing file */ }
    await new Promise((r) => setTimeout(r, 40));
  }
}

/* ============================== power saving ============================== */
// While nothing is playing, the audio engine sleeps and uses no CPU. The headphone side sleeps
// after a few seconds of silence. The mic side also sleeps once the window is in the background
// (in cable mode only when your voice isn't passed through, since that needs it running).
// Playing a sound wakes it up again.
let lastSoundAt = performance.now();
const awayFromWindow = () => document.hidden || !document.hasFocus();
function powerTick() {
  if (!lib) return;
  if (engine.voices.size) { lastSoundAt = performance.now(); return; }
  if (!S().powerSave || performance.now() - lastSoundAt < 4000) return;
  const micCanSleep = awayFromWindow() && (isDirect() || !S().passthrough);
  engine.sleep({ mic: micCanSleep });
}
setInterval(powerTick, 1000);

async function firstRunSetup() {
  const st = S();
  if (!st.micMode) st.micMode = apoAvail ? 'direct' : 'cable';
  if (st.micMode === 'direct' && !apoAvail) st.micMode = 'cable';
  if (st.setupSeen) return;
  st.setupSeen = true;
  const mic = findRealMic();
  if (mic) st.micInDevice = mic.deviceId;
  if (st.micMode === 'direct') { save(); return; } // startupMicCheck() takes it from here
  const cable = findCable();
  if (cable && !st.micOutDevice) st.micOutDevice = cable.deviceId;
  save();
  if (!cable) setTimeout(() => openSettings('routing'), 400);
  else toast(`Routed to ${shortName(cable.label)} — set CABLE Output as your mic in game`, 'ok');
}
async function boot() {
  const stored = await api.loadLib();
  lib = stored ? mergeDeep(defaultLib(), stored) : defaultLib();
  if (stored) { lib.categories = stored.categories || []; lib.sounds = stored.sounds || []; lib.recent = stored.recent || []; }
  lib.settings = mergeDeep(DEFAULT_SETTINGS, lib.settings);
  try { hotkeyBackend = await api.hotkeyBackend(); } catch { /* noop */ }
  try { hwAccel = await api.getHardwareAcceleration(); } catch { /* noop */ }
  try { apoAvail = !!(api.apo && await api.apo.available()); } catch { apoAvail = false; }
  if (api.apo) {
    let t = 0;
    api.apo.onStatus((st) => {
      const wasLive = apoLive();
      apoStatus = st;
      if (wasLive !== apoLive() || document.getElementById('apo-diag') || performance.now() - t > 3000) { t = performance.now(); renderRoute(); }
    });
  }
  applyAccent();
  api.win.setCloseToTray(S().closeToTray);
  bindEvents();
  await initExtras();
  renderAll();
  await refreshDevices();
  await firstRunSetup();
  if (isDirect()) await refreshApo();
  await applyRouting();
  applyMixer();
  await applyMicInput();
  await syncHotkeys();
  scheduleFrame();
  api.sb.onPlayed(onPlayed);
  api.sb.onPtt((held) => { pttHeld = !!held; renderNowbar(); });
  api.sb.onToast((t) => toast(t.msg, t.kind || ''));
  api.sb.onSettingsPatch(({ patch, toast: msg }) => {
    Object.assign(S(), patch || {});
    renderMixer();
    renderRoute();
    if (msg) toast(msg);
  });
  if (!S().starterImported) await importStarterPack({ onlyIfNew: true });
  void preloadBuffers; // the backend preloads hotkey / favorite sounds itself
  startupMicCheck();
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre class="fatal">${esc(e.stack || e)}</pre>`);
});
