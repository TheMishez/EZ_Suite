'use strict';
/* global AudioEngine, engine, lib, S, save, $, $$, esc, clamp, icon, I, toast, modal, trigger, pttPress,
   pttMaybeRelease, addImported, applyMixer, renderAll, renderMixer */
// Updates, text-to-speech, add-from-link and Stream Deck. Loaded before app.js; everything here runs
// from initExtras(), which app.js calls once the library is loaded.


/* ============================== updates ============================== */
let updateState = { phase: 'idle', current: '', version: '', percent: 0, enabled: true, canInstall: false, notes: '', error: '' };
let updatePaneEl = null;

function renderUpdatePill() {
  const pill = $('#update-pill');
  if (!pill) return;
  const u = updateState;
  const show = ['available', 'downloading', 'ready'].includes(u.phase);
  pill.hidden = !show;
  if (!show) return;
  pill.classList.toggle('ready', u.phase === 'ready');
  pill.innerHTML = u.phase === 'ready'
    ? `${icon('refresh')}<span>Restart to update</span>`
    : u.phase === 'downloading'
      ? `${icon('download')}<span>Updating… ${u.percent}%</span>`
      : `${icon('download')}<span>Update ${esc(u.version)}</span>`;
  pill.title = u.phase === 'ready' ? `EZ Soundboard ${u.version} is ready - click to restart and install` : `EZ Soundboard ${u.version} is out`;
}

function updateStatusText() {
  const u = updateState;
  switch (u.phase) {
    case 'checking': return 'Checking GitHub for a new version…';
    case 'available': return `Version ${u.version} is available.${u.canInstall ? '' : ' Download it from the releases page.'}`;
    case 'downloading': return `Downloading ${u.version}… ${u.percent}%`;
    case 'ready': return `Version ${u.version} is downloaded. Restart EZ Soundboard to install it.`;
    case 'none': return "You're on the newest version.";
    case 'error': return u.error || "Couldn't check for updates.";
    default: return u.enabled ? 'EZ Soundboard checks for updates when it starts and every 6 hours.' : 'Automatic checks are off.';
  }
}

function renderUpdatePane(pane) {
  updatePaneEl = pane;
  const u = updateState;
  const busy = u.phase === 'checking' || u.phase === 'downloading';
  const actionBtn = u.phase === 'ready'
    ? `<button class="btn primary" id="up-act">${icon('refresh')}Restart and install</button>`
    : u.phase === 'available' || (u.phase === 'error' && u.version)
      ? `<button class="btn primary" id="up-act">${icon('download')}${u.canInstall ? 'Download and install' : 'Open download page'}</button>`
      : '';
  pane.innerHTML = `
    <div class="about">
      <div class="about-ver"><b>EZ Soundboard</b><span class="muted">Version ${esc(u.current || '')}</span></div>
      <div class="backend ${u.phase === 'error' ? '' : 'ok'}">
        ${u.phase === 'error' ? icon('warn') : ['available', 'ready', 'downloading'].includes(u.phase) ? icon('download') : icon('check')}
        <span>${esc(updateStatusText())}</span>
      </div>
      ${u.phase === 'downloading' ? `<div class="up-bar"><i style="width:${clamp(u.percent, 0, 100)}%"></i></div>` : ''}
      ${u.notes && (u.phase === 'available' || u.phase === 'ready') ? `<label>What's new in ${esc(u.version)}</label><div class="up-notes">${esc(u.notes)}</div>` : ''}
      <div class="btn-row">
        ${actionBtn}
        <button class="btn" id="up-check" ${busy ? 'disabled' : ''}>${icon('refresh')}Check now</button>
        <button class="btn ghost" id="up-page">${icon('ext')}Releases page</button>
      </div>
      <div class="toggles col"><label class="switch"><input type="checkbox" id="up-auto" ${u.enabled ? 'checked' : ''}/><span></span>Check for updates automatically</label></div>
      <p class="muted small">Updates download from GitHub and install in the background. Windows asks once for permission, then EZ Soundboard restarts by itself. Your sounds, boards and mic settings stay as they are.</p>
    </div>`;
  const act = $('#up-act', pane);
  if (act) act.onclick = () => runUpdateAction();
  $('#up-check', pane).onclick = () => api.update.check();
  $('#up-page', pane).onclick = () => api.update.openPage();
  $('#up-auto', pane).onchange = async (e) => { updateState = await api.update.setEnabled(e.target.checked); renderUpdatePane(pane); };
}

async function runUpdateAction() {
  const u = updateState;
  if (u.phase === 'ready') {
    engine.stopAll();
    await api.update.install();
  } else if (u.phase === 'available' || u.phase === 'error') {
    const started = await api.update.download();
    if (started) toast(`Downloading EZ Soundboard ${u.version}…`);
  }
}

function openUpdatePrompt() {
  const u = updateState;
  if (u.phase === 'ready') { runUpdateAction(); return; }
  if (u.phase === 'downloading') return;
  const m = modal(`
    <h3>EZ Soundboard ${esc(u.version)} is out</h3>
    <p class="muted">You have ${esc(u.current)}.${u.canInstall ? ' It downloads in the background and installs when you restart.' : ''}</p>
    ${u.notes ? `<div class="up-notes">${esc(u.notes)}</div>` : ''}
    <div class="modal-actions"><button class="btn ghost" data-close>Later</button><button class="btn primary" id="upm-go">${icon('download')}${u.canInstall ? 'Update' : 'Open download page'}</button></div>`);
  $('#upm-go', m.el).onclick = () => { m.close(); runUpdateAction(); };
}

function onUpdateState(st) {
  const was = updateState.phase;
  updateState = st;
  renderUpdatePill();
  if (updatePaneEl && updatePaneEl.isConnected) renderUpdatePane(updatePaneEl);
  if (st.phase === 'ready' && was !== 'ready') toast(`Update ${st.version} is ready - restart to install`, 'ok');
}

/* ============================== add from link ============================== */
const looksLikeUrl = (t) => /^(https?:\/\/)[^\s]+$/i.test(String(t || '').trim());

async function importFromLink(url, { category } = {}) {
  const r = await api.importUrl(String(url || '').trim());
  if (!r || !r.ok) throw new Error((r && r.error) || "Couldn't download that link");
  const n = await addImported([r.sound], { category, quiet: true });
  if (!n) throw new Error("That file downloaded but isn't audio EZ Soundboard can play");
  return r.sound;
}

/** Quick import (paste / drop a link): no dialog, just a toast. */
async function quickImportLink(url) {
  toast('Downloading sound…');
  try {
    const s = await importFromLink(url);
    toast(`Added “${s.name}”`, 'ok');
  } catch (e) {
    toast(e.message, 'err');
  }
}

function openLinkDialog(prefill = '') {
  const m = modal(`
    <h3>Add a sound from a link</h3>
    <p class="muted small">Paste a link to an audio file (mp3, wav, ogg…), a Discord attachment, a Dropbox / Google Drive / GitHub share link, or a sound page like myinstants.com.</p>
    <input class="input" id="link-in" placeholder="https://…" spellcheck="false" value="${esc(prefill)}" />
    <div class="link-err" id="link-err" hidden></div>
    <div class="modal-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="link-ok">${icon('download')}<span>Add sound</span></button></div>`);
  const inp = $('#link-in', m.el);
  const btn = $('#link-ok', m.el);
  const err = $('#link-err', m.el);
  inp.focus();
  inp.select();
  const go = async () => {
    const v = inp.value.trim();
    if (!v) { inp.focus(); return; }
    btn.disabled = true;
    inp.disabled = true;
    btn.lastElementChild.textContent = 'Downloading…';
    err.hidden = true;
    try {
      const s = await importFromLink(v);
      toast(`Added “${s.name}”`, 'ok');
      m.close();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      btn.disabled = false;
      inp.disabled = false;
      btn.lastElementChild.textContent = 'Add sound';
      inp.focus();
    }
  };
  btn.onclick = go;
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

/* ============================== text-to-speech ============================== */
let ttsVoices = null;
const ttsClips = new Map(); // "voice|rate|text" -> { file, rms, duration }

async function loadVoices(refresh = false) {
  if (ttsVoices && !refresh) return ttsVoices;
  try { ttsVoices = await api.tts.voices(refresh); } catch { ttsVoices = []; }
  return ttsVoices;
}

/** Turns text into a clip (cached for this session). */
async function ttsClip(text, voice, rate) {
  const key = `${voice}|${rate}|${text}`;
  let clip = ttsClips.get(key);
  if (clip) return clip;
  const r = await api.tts.speak({ text, voice, rate });
  if (!r || !r.ok) throw new Error((r && r.error) || 'Text-to-speech failed');
  const a = await engine.analyse(r.file);
  clip = { key, file: r.file, text, ...a };
  ttsClips.set(key, clip);
  if (ttsClips.size > 40) ttsClips.delete(ttsClips.keys().next().value);
  return clip;
}

/** Speaks `text` into the mic (or only to you with monitorOnly), like playing a sound. */
async function speakText(text, { voice, rate, monitorOnly = false } = {}) {
  const t = S().tts;
  text = String(text || '').trim();
  if (!text) return null;
  const clip = await ttsClip(text, voice ?? t.voice, rate ?? t.rate);
  const snd = {
    id: 'tts:' + clip.file, name: 'Speech: ' + text.slice(0, 40), file: clip.file,
    volume: t.volume, speed: 1, trimStart: 0, trimEnd: null, loop: false, normalize: true, rms: clip.rms
  };
  await api.sb.playClip(snd, monitorOnly);
  t.recent = [text, ...t.recent.filter((x) => x !== text)].slice(0, 8);
  save();
  return clip;
}

/** Saves a spoken phrase as a normal sound on the current board. */
async function saveSpeech(text, voice, rate) {
  const clip = await ttsClip(text, voice, rate);
  const kept = await api.tts.keep(clip.file);
  if (!kept) throw new Error("Couldn't save the speech");
  ttsClips.delete(clip.key);
  engine.forget(clip.file);
  const name = text.length > 40 ? text.slice(0, 38).trim() + '…' : text;
  await addImported([{ id: kept.id, file: kept.file, name }], { quiet: true, normalize: true });
  return name;
}

async function openTts() {
  const t = S().tts;
  const m = modal(`
    <div class="tts">
      <h3>${icon('speak')}Text to speech</h3>
      <p class="muted small">Type something and it plays into your mic in the voice you pick.</p>
      <textarea class="input tts-text" id="tts-text" maxlength="1000" spellcheck="true" placeholder="Type what to say…  (Enter plays it · Shift+Enter for a new line)"></textarea>
      <div class="tts-row">
        <div class="tts-voice"><label>Voice</label><select class="select full" id="tts-voice"><option>Loading voices…</option></select></div>
        <div><label>Speed</label><span class="num-wrap"><input type="number" class="num" id="tts-rate" min="0.5" max="3" step="0.1" value="${t.rate}"/><em>×</em></span></div>
        <div><label>Volume</label><span class="num-wrap"><input type="number" class="num" id="tts-vol" min="0" max="300" step="5" value="${Math.round(t.volume * 100)}"/><em>%</em></span></div>
      </div>
      <div class="link-err" id="tts-err" hidden></div>
      <div class="tts-recent" id="tts-recent"></div>
      <div class="modal-actions tts-actions">
        <button class="btn ghost" id="tts-preview" title="Only you hear it">${icon('head')}Preview</button>
        <button class="btn ghost" id="tts-save" title="Add it to your board as a sound">${icon('plus')}Save as sound</button>
        <button class="btn primary" id="tts-play">${icon('broadcast')}<span>Play to mic</span></button>
      </div>
    </div>`, { wide: false });
  m.el.classList.add('tts-modal');
  const el = m.el;
  const ta = $('#tts-text', el);
  const sel = $('#tts-voice', el);
  const err = $('#tts-err', el);
  const btns = ['#tts-preview', '#tts-save', '#tts-play'].map((s) => $(s, el));
  ta.focus();

  const renderRecent = () => {
    $('#tts-recent', el).innerHTML = t.recent.length
      ? t.recent.map((x, i) => `<button class="tts-chip" data-r="${i}" title="Click to put it back in the box · Double-click to play it">${esc(x.length > 48 ? x.slice(0, 46) + '…' : x)}</button>`).join('')
      : '';
  };
  renderRecent();
  $('#tts-recent', el).onclick = (e) => { const b = e.target.closest('[data-r]'); if (b) { ta.value = t.recent[Number(b.dataset.r)] || ''; ta.focus(); } };
  $('#tts-recent', el).ondblclick = (e) => { const b = e.target.closest('[data-r]'); if (b) run('play', t.recent[Number(b.dataset.r)]); };

  loadVoices().then((voices) => {
    if (!sel.isConnected) return;
    if (!voices.length) {
      sel.innerHTML = '<option value="">Windows default voice</option>';
      return;
    }
    const cur = voices.some((v) => v.id === t.voice) ? t.voice : (voices.find((v) => v.isDefault) || voices[0]).id;
    sel.innerHTML = voices.map((v) => `<option value="${esc(v.id)}" ${v.id === cur ? 'selected' : ''}>${esc(v.name.replace(/^Microsoft\s+/, ''))}${v.lang ? ` · ${esc(v.lang)}` : ''}</option>`).join('');
    t.voice = cur;
  });
  sel.onchange = () => { t.voice = sel.value; save(); };
  $('#tts-rate', el).onchange = (e) => { t.rate = clamp(Number(e.target.value) || 1, 0.5, 3); e.target.value = t.rate; save(); };
  $('#tts-vol', el).onchange = (e) => { t.volume = clamp(Number(e.target.value) || 0, 0, 300) / 100; e.target.value = Math.round(t.volume * 100); save(); };

  let busy = false;
  async function run(what, text = ta.value) {
    text = String(text || '').trim();
    if (!text) { ta.focus(); return; }
    if (busy) return;
    busy = true;
    err.hidden = true;
    btns.forEach((b) => { b.disabled = true; });
    const cached = ttsClips.has(`${t.voice}|${t.rate}|${text}`);
    if (!cached) btns[2].lastElementChild.textContent = 'Generating…';
    try {
      if (what === 'save') {
        const name = await saveSpeech(text, t.voice, t.rate);
        toast(`Saved “${name}” to your board`, 'ok');
      } else {
        await speakText(text, { monitorOnly: what === 'preview' });
        if (what === 'play') ta.select();
        renderRecent();
      }
    } catch (e) {
      err.textContent = e.message || String(e);
      err.hidden = false;
    } finally {
      busy = false;
      btns.forEach((b) => { b.disabled = false; });
      btns[2].lastElementChild.textContent = 'Play to mic';
      if (ta.isConnected) ta.focus();
    }
  }
  btns[0].onclick = () => run('preview');
  btns[1].onclick = () => run('save');
  btns[2].onclick = () => run('play');
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(e.ctrlKey ? 'preview' : 'play'); }
  });
}

/* ============================== Stream Deck / local control ============================== */
let remoteStatus = { running: false, port: 41720, error: '', enabled: true, pluginAvailable: false };
let deckPaneEl = null;
let pushLibTimer = null;
let lastPlaying = '';

/** Sends the sound list to the Stream Deck plugin's source (debounced). */
function pushLibraryToRemote() {
  clearTimeout(pushLibTimer);
  pushLibTimer = setTimeout(() => {
    if (!lib || !api.remote) return;
    const boardName = (id) => (lib.categories.find((c) => c.id === id) || {}).name || '';
    api.remote.setLibrary({
      sounds: lib.sounds.map((s) => ({ id: s.id, name: s.name, board: boardName(s.category), color: s.color || '', hotkey: s.hotkey || '' })),
      boards: lib.categories.map((c) => c.name)
    });
  }, 250);
}

function pushPlayingToRemote() {
  if (!api.remote || !lib) return;
  const ids = [...new Set([...engine.voices.values()].filter((v) => !v.stopping && v.soundId).map((v) => v.soundId))];
  const key = ids.join(',') + '|' + S().soundsToMic;
  if (key === lastPlaying) return;
  lastPlaying = key;
  api.remote.setPlaying({ playing: ids, soundsToMic: !!S().soundsToMic });
}

function setSoundsToMic(on) {
  S().soundsToMic = on;
  applyMixer();
  renderMixer();
  save();
  pushPlayingToRemote();
}

async function onRemoteCommand(cmd) {
  if (!cmd || !lib) return;
  try {
    if (cmd.cmd === 'play') await trigger(cmd.id);
    else if (cmd.cmd === 'stop') engine.stopSound(cmd.id);
    else if (cmd.cmd === 'stopAll') engine.stopAll();
    else if (cmd.cmd === 'mic') {
      const on = typeof cmd.on === 'boolean' ? cmd.on : !S().soundsToMic;
      setSoundsToMic(on);
      toast(on ? 'Sounds → mic ON' : 'Sounds → mic OFF (only you hear)');
    } else if (cmd.cmd === 'tts') {
      await speakText(cmd.text, cmd.voice ? { voice: cmd.voice } : {});
    }
  } catch (e) {
    console.error(e);
    toast(e.message || 'Stream Deck action failed', 'err');
  }
}

function renderDeckPane(pane) {
  deckPaneEl = pane;
  const r = remoteStatus;
  pane.innerHTML = `
    <p class="muted">Put your sounds on Stream Deck keys. Each key shows the sound's name and lights up while it plays.</p>
    <div class="backend ${r.enabled && r.running ? 'ok' : ''}">
      ${r.enabled && r.running ? icon('check') : icon('warn')}
      <span>${!r.enabled ? '<b>Stream Deck control is off.</b> Turn it on below.'
        : r.running ? '<b>Ready for Stream Deck.</b> The plugin connects automatically while EZ Soundboard is running.'
          : `<b>Couldn't start.</b> ${esc(r.error || 'Unknown error')}`}</span>
    </div>
    <div class="deck-steps">
      <div class="deck-step"><b>1</b><span>Install the free <a href="#" data-ext="https://www.elgato.com/downloads">Stream Deck app</a> if you don't have it.</span></div>
      <div class="deck-step"><b>2</b><span>Click <b>Install Stream Deck plugin</b> and confirm in the Stream Deck window.</span></div>
      <div class="deck-step"><b>3</b><span>In Stream Deck, drag <b>EZ Soundboard → Play sound</b> onto a key and pick a sound. There are also <b>Stop all</b>, <b>Text to speech</b> and <b>Sounds to mic on/off</b> actions.</span></div>
    </div>
    <div class="btn-row">
      <button class="btn primary" id="deck-install" ${r.pluginAvailable ? '' : 'disabled'}>${icon('deck')}Install Stream Deck plugin</button>
    </div>
    ${r.pluginAvailable ? '' : '<p class="muted small">This build doesn\'t include the plugin. Run <code>npm run pack:streamdeck</code> first.</p>'}
    <div class="toggles col"><label class="switch"><input type="checkbox" id="deck-on" ${r.enabled ? 'checked' : ''}/><span></span>Allow Stream Deck to control EZ Soundboard</label></div>
    <p class="muted small">Only programs on this PC can connect (port ${r.port}); websites and other computers can't. Other tools can use it too, for example <code>curl -H "X-EZSB: 1" localhost:${r.port}/v1/play -d "{\\"name\\":\\"air horn\\"}"</code>.</p>`;
  $('#deck-install', pane).onclick = async () => {
    const res = await api.remote.installPlugin();
    if (res && res.ok) toast('Confirm the install in the Stream Deck window', 'ok');
    else toast((res && res.error) || "Couldn't open the plugin", 'err');
  };
  $('#deck-on', pane).onchange = async (e) => {
    const st = await api.remote.setEnabled(e.target.checked);
    remoteStatus = { ...remoteStatus, ...st };
    renderDeckPane(pane);
  };
  $$('[data-ext]', pane).forEach((a) => { a.onclick = (e) => { e.preventDefault(); api.openExternal(a.dataset.ext); }; });
}

async function refreshRemoteStatus() {
  try { remoteStatus = await api.remote.status(); } catch { /* old main */ }
}

/* ============================== wiring ============================== */
function bindExtras() {
  $('#tts-btn').innerHTML = icon('speak');
  $('#tts-btn').onclick = () => openTts();
  $('#update-pill').onclick = () => openUpdatePrompt();

  // Ctrl+V a link anywhere outside a text box → add it as a sound.
  document.addEventListener('paste', (e) => {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    if ($('#modal-root').children.length) return;
    const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    if (looksLikeUrl(text)) { e.preventDefault(); quickImportLink(text.trim()); }
  });

  // Dragging a link from the browser onto the window.
  const isLink = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('text/uri-list') && ![...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragover', (e) => { if (isLink(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  window.addEventListener('drop', (e) => {
    if (!isLink(e)) return;
    e.preventDefault();
    const url = e.dataTransfer.getData('text/uri-list').split(/\r?\n/).find((l) => l && !l.startsWith('#'));
    if (url && looksLikeUrl(url)) quickImportLink(url);
  });
}

async function initExtras() {
  Object.assign(I, {
    speak: '<path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/><path d="M8 9.5h8M8 12.5h5"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M20 21v-5h-5"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>',
    deck: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><rect x="6" y="8" width="3.2" height="3.2" rx=".6"/><rect x="10.4" y="8" width="3.2" height="3.2" rx=".6"/><rect x="14.8" y="8" width="3.2" height="3.2" rx=".6"/><rect x="6" y="12.8" width="3.2" height="3.2" rx=".6"/><rect x="10.4" y="12.8" width="3.2" height="3.2" rx=".6"/><rect x="14.8" y="12.8" width="3.2" height="3.2" rx=".6"/>'
  });
  bindExtras();
  if (api.update) {
    api.update.onState(onUpdateState);
    try { onUpdateState(await api.update.state()); } catch { /* noop */ }
  }
  if (api.remote) {
    api.remote.onCommand(onRemoteCommand);
    api.remote.onStatus((st) => {
      remoteStatus = { ...remoteStatus, ...st };
      if (deckPaneEl && deckPaneEl.isConnected) renderDeckPane(deckPaneEl);
    });
    await refreshRemoteStatus();
    pushLibraryToRemote();
    pushPlayingToRemote();
  }
}
