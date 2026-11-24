'use strict';
/* global Crosshair */
/*
 * The crosshair overlay page. Used for animated crosshairs (and while the designer is open).
 * For static crosshairs it only draws the design once into a bitmap for the native overlay
 * window, and the backend closes this page straight after.
 */
const T = window.__TAURI__;
const invoke = (cmd, args, opts) => T.core.invoke(cmd, args, opts);
const listen = (ev, cb) => T.event.listen(ev, (e) => cb(e.payload));

const canvas = document.getElementById('c');
const ctrl = Crosshair.createController(canvas, { size: window.innerWidth || 200, zoom: 1 });
let current = null; // the design exactly as the backend sent it
let zoom = 1;
let triggers = null;

// The window is sized to the crosshair by the backend; follow it.
window.addEventListener('resize', () => ctrl.setSize(window.innerWidth));

// Alignment guide: 1-physical-pixel lines through the exact middle, drawn in device pixels.
let guideWanted = false;
window.addEventListener('resize', () => { if (guideWanted) drawGuide(true); });

function drawGuide(on) {
  guideWanted = on;
  const g = document.getElementById('g');
  g.hidden = !on;
  if (!on) return;
  const dpr = window.devicePixelRatio || 1;
  const W = Math.round(window.innerWidth * dpr);
  const H = Math.round(window.innerHeight * dpr);
  g.width = W;
  g.height = H;
  g.style.width = W / dpr + 'px';
  g.style.height = H / dpr + 'px';
  const x = g.getContext('2d');
  x.clearRect(0, 0, W, H);
  x.fillStyle = '#ff00ff';
  const cx = Math.floor((W - 1) / 2);
  const cy = Math.floor((H - 1) / 2);
  const w = W % 2 === 0 ? 2 : 1; // even window: the centre sits between two pixels
  const h = H % 2 === 0 ? 2 : 1;
  x.fillRect(cx, 0, w, H);
  x.fillRect(0, cy, W, h);
  x.fillStyle = '#00ffff';
  for (let i = 10; i < Math.min(W, H) / 2; i += 10) {
    const len = i % 50 === 0 ? 7 : 3;
    x.fillRect(cx - i, cy - len, 1, len * 2 + h);
    x.fillRect(cx + w - 1 + i, cy - len, 1, len * 2 + h);
    x.fillRect(cx - len, cy - i, len * 2 + w, 1);
    x.fillRect(cx - len, cy + h - 1 + i, len * 2 + w, 1);
  }
}

function applyState(s) {
  if (!s) return;
  drawGuide(!!s.guide);
  zoom = s.overlayScale || 1;
  ctrl.setZoom(zoom);
  ctrl.setFpsCap(s.fpsCap === undefined ? 60 : s.fpsCap);
  canvas.style.opacity = String(s.overlayOpacity === undefined ? 1 : s.overlayOpacity);
  if (s.triggers) triggers = Crosshair.sanitizeTriggers(s.triggers);
}

/** Tells the backend what this design needs: its size, and whether it animates. */
function reportMeta() {
  if (!current) return;
  const cfg = Crosshair.sanitizeDesign(current);
  invoke('xh_report_meta', {
    design: current,
    radius: Crosshair.designRadius(cfg),
    animated: Crosshair.hasAnimation(cfg),
    moving: Crosshair.hasMovingImage(cfg)
  }).catch(() => {});
}

function setDesign(c) {
  current = c;
  ctrl.setConfig(c);
  reportMeta();
}

/* ---- static designs: draw once into a bitmap for the native overlay window ---- */
let capture = null;
function sendStill() {
  if (!capture || !current) return;
  const { key, size, scale } = capture;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  const logical = size / scale;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  Crosshair.draw(ctx, Crosshair.sanitizeDesign(current), Crosshair.newAnim(), Math.round(logical / 2), Math.round(logical / 2), zoom);
  const px = ctx.getImageData(0, 0, size, size).data;
  invoke('xh_still_frame', new Uint8Array(px.buffer), { headers: { 'x-w': String(size), 'x-h': String(size), 'x-key': key } }).catch(() => {});
}
listen('xh-capture', (c) => {
  capture = c;
  sendStill();
  setTimeout(sendStill, 400); // again once image layers / fonts have surely loaded
});
Crosshair.onAssetLoad(() => { reportMeta(); setTimeout(sendStill, 30); });

/* ---- click / key animations ---- */
const held = new Set();
function onRawInput({ code, down }) {
  if (!triggers) return;
  const name = Crosshair.canonKey(code);
  const actions = Crosshair.actionsFor(triggers, name);
  const active = (a) => triggers[a].some((n) => held.has(n));
  if (down) {
    if (held.has(name)) return;
    const was = actions.map(active);
    held.add(name);
    actions.forEach((a, i) => { if (!was[i]) ctrl.input({ type: 'trigger', action: a, down: true }); });
  } else {
    if (!held.delete(name)) return;
    actions.forEach((a) => { if (!active(a)) ctrl.input({ type: 'trigger', action: a, down: false }); });
  }
}

invoke('xh_get_config').then((c) => { applyState(c); setDesign(c.crosshair); });
listen('xh-crosshair', setDesign);
listen('xh-state', applyState);
listen('xh-input', onRawInput);
