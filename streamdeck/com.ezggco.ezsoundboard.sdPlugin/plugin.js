/* global EZSB */
'use strict';
const A = {
  play: 'com.ezggco.ezsoundboard.play',
  stopall: 'com.ezggco.ezsoundboard.stopall',
  tts: 'com.ezggco.ezsoundboard.tts',
  mic: 'com.ezggco.ezsoundboard.mic'
};
let ws = null;
const keys = new Map(); // context -> { action, settings, state, title }
let pollTimer = null;

function send(event, context, payload) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload === undefined ? { event, context } : { event, context, payload }));
}
const alert = (ctx) => send('showAlert', ctx);
const ok = (ctx) => send('showOk', ctx);

function setTitle(ctx, title) {
  const k = keys.get(ctx);
  if (!k || k.title === title) return;
  k.title = title;
  send('setTitle', ctx, { title, target: 0 });
}
function setState(ctx, state) {
  const k = keys.get(ctx);
  if (!k || k.state === state) return;
  k.state = state;
  send('setState', ctx, { state });
}

// Breaks long sound names onto two short lines so they fit on the key.
function keyTitle(name) {
  name = String(name || '').trim();
  if (!name) return '';
  if (name.length <= 10) return name;
  const words = name.split(/\s+/);
  let a = '';
  let b = '';
  for (const w of words) {
    if (!b && (a + ' ' + w).trim().length <= 10) a = (a + ' ' + w).trim();
    else b = (b + ' ' + w).trim();
  }
  if (!a) { a = name.slice(0, 10); b = name.slice(10); }
  if (b.length > 10) b = b.slice(0, 9) + '…';
  return a + '\n' + b;
}

function refreshTitle(ctx) {
  const k = keys.get(ctx);
  if (!k) return;
  const s = k.settings || {};
  if (k.action === A.play) setTitle(ctx, s.showName === false ? '' : keyTitle(s.soundName || ''));
  if (k.action === A.tts) setTitle(ctx, s.showText === false ? '' : keyTitle(s.text || ''));
}

async function poll() {
  const watched = [...keys.values()].some((k) => k.action === A.play || k.action === A.mic);
  if (!watched) return;
  try {
    const st = await EZSB.state();
    const playing = new Set(st.playing || []);
    for (const [ctx, k] of keys) {
      if (k.action === A.play) setState(ctx, k.settings && playing.has(k.settings.soundId) ? 1 : 0);
      else if (k.action === A.mic) setState(ctx, st.soundsToMic ? 0 : 1);
    }
  } catch {
    for (const [ctx, k] of keys) if (k.action === A.play) setState(ctx, 0);
  }
}
function ensurePolling() {
  if (!pollTimer) pollTimer = setInterval(poll, 400);
  if (!keys.size) { clearInterval(pollTimer); pollTimer = null; }
}

async function keyDown(ctx, k) {
  const s = k.settings || {};
  try {
    if (k.action === A.play) {
      if (!s.soundId && !s.soundName) { alert(ctx); return; }
      const r = await EZSB.play(s.soundId, s.soundName);
      // The sound was re-added and got a new id: remember it.
      if (r.id && r.id !== s.soundId) {
        k.settings = { ...s, soundId: r.id };
        send('setSettings', ctx, k.settings);
      }
      poll();
    } else if (k.action === A.stopall) {
      await EZSB.stopAll();
      ok(ctx);
    } else if (k.action === A.tts) {
      if (!s.text) { alert(ctx); return; }
      await EZSB.tts(s.text);
    } else if (k.action === A.mic) {
      await EZSB.mic();
      setTimeout(poll, 60);
    }
  } catch (e) {
    alert(ctx); // EZ Soundboard isn't running, or the sound was deleted
  }
}

function onMessage(msg) {
  const { event, action, context, payload } = msg;
  switch (event) {
    case 'willAppear':
      keys.set(context, { action, settings: (payload && payload.settings) || {}, state: payload ? payload.state : 0, title: null });
      refreshTitle(context);
      ensurePolling();
      poll();
      break;
    case 'willDisappear':
      keys.delete(context);
      ensurePolling();
      break;
    case 'didReceiveSettings': {
      const k = keys.get(context);
      if (k) { k.settings = (payload && payload.settings) || {}; refreshTitle(context); poll(); }
      break;
    }
    case 'keyDown': {
      const k = keys.get(context) || { action, settings: (payload && payload.settings) || {} };
      if (payload && payload.settings) k.settings = payload.settings;
      keyDown(context, k);
      break;
    }
    case 'keyUp': {
      // Stream Deck flips two-state keys by itself on release; put the real state back.
      const k = keys.get(context);
      if (k && (k.action === A.play || k.action === A.mic)) { k.state = -1; setTimeout(poll, 30); }
      break;
    }
    default:
      break;
  }
}

// Called by the Stream Deck app when the plugin starts.
window.connectElgatoStreamDeckSocket = function (port, uuid, registerEvent) {
  ws = new WebSocket('ws://127.0.0.1:' + port);
  ws.onopen = () => ws.send(JSON.stringify({ event: registerEvent, uuid }));
  ws.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)); } catch (err) { console.error(err); }
  };
};
