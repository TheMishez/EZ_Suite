(function () {
  'use strict';

  const api = window.api;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const mk = (tag, props) => Object.assign(document.createElement(tag), props || {});

  let state = null;
  let design = Crosshair.sanitizeDesign(null);
  // While a state (aim, run...) is being edited, `design` is a view whose layers are that state's
  // layers and `stash` holds the rest. canon() always returns the full design to save or send.
  let editState = 'base';
  let stash = null;
  let styleClip = null;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function canon() {
    if (!stash) return design;
    const st = Object.assign({}, stash.states);
    st[editState] = { layers: design.layers };
    return Object.assign({}, design, { layers: stash.base, states: st });
  }
  function viewOf(root, id) {
    if (id === 'base' || Crosshair.STATE_IDS.indexOf(id) < 0) { stash = null; editState = 'base'; return root; }
    stash = { base: root.layers, states: root.states || {} };
    editState = id;
    const s = stash.states[id];
    const v = { layers: s ? clone(s.layers) : clone(root.layers) };
    if (root.dynamic) v.dynamic = root.dynamic;
    if (root.rules) v.rules = root.rules;
    return v;
  }
  let sel = 0;
  const cur = () => design.layers[sel];
  let triggers = Crosshair.sanitizeTriggers(null);
  let customizing = false;
  let drawMode = false;
  let symmetry = 'none';
  let previewZoom = 2;
  const groups = [];
  let preview = null;
  let pushTimer = 0;
  const rows = {};
  const extrasUI = { host: null };
  const multi = new Set();

  const TRIG_OPTS = Crosshair.TRIGGER_IDS.map((id) => [id, Crosshair.TRIGGER_LABELS[id]]);
  const ANIM_OPTS = Crosshair.ANIMS.map((id) => [id, Crosshair.ANIM_LABELS[id]]);
  const FONT_OPTS = Object.keys(Crosshair.FONTS).map((id) => [id, Crosshair.FONT_LABELS[id]]);
  const animOn = (l) => l.animation !== 'none';
  const HOLD_DEFAULT = { shoot: 'pulse', reload: 'pulse', jump: 'pulse', aim: 'hold', move: 'hold', run: 'hold' };

  // kinds: which layer types show the group/row; when: extra condition on the layer.
  const SCHEMA = [
    { title: 'Shape', icon: 'M12 3v6M12 15v6M3 12h6M15 12h6', kinds: ['shape'], items: [
      { key: 'style', type: 'shape', label: 'Shape' },
      { key: 'size', type: 'range', label: 'Size', min: 0, max: 60, step: 0.1, unit: 'px' },
      { key: 'gap', type: 'range', label: 'Gap', min: 0, max: 40, step: 0.1, unit: 'px' },
      { key: 'thickness', type: 'range', label: 'Thickness', min: 1, max: 12, step: 0.1, unit: 'px' },
      { key: 'rounded', type: 'range', label: 'Corner radius', min: 0, max: 100, step: 5, unit: '%' },
      { key: 'tStyle', type: 'check', label: 'T-style (no top line)' },
      { key: 'dot', type: 'check', label: 'Center dot' },
      { key: 'dotSize', type: 'range', label: 'Dot size', min: 1, max: 12, step: 1, unit: 'px', when: (l) => l.dot }
    ] },
    { title: 'Image', icon: 'M4 5h16v14H4zM8 14l3-3 5 5', kinds: ['image'], items: [
      { type: 'action', label: 'Image', text: 'Replace image…', fn: () => pickImage((img) => { cur().imgAspect = Math.min(20, Math.max(0.05, img.aspect)); update('src', img.src); }) },
      { key: 'imgSize', type: 'range', label: 'Size', min: 4, max: 400, step: 1, unit: 'px' },
      { key: 'tint', type: 'check', label: 'Tint with color' }
    ] },
    { title: 'Text', icon: 'M5 6V4h14v2M12 4v16M9 20h6', kinds: ['text'], items: [
      { key: 'text', type: 'text', label: 'Text' },
      { key: 'font', type: 'select', label: 'Font', options: FONT_OPTS },
      { key: 'fontSize', type: 'range', label: 'Font size', min: 6, max: 200, step: 1, unit: 'px' },
      { key: 'bold', type: 'check', label: 'Bold' }
    ] },
    { title: 'Drawing', icon: 'M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3', kinds: ['draw'], items: [
      { type: 'drawtools', label: 'Tools' },
      { key: 'brush', type: 'range', label: 'Brush size', min: 1, max: 24, step: 1, unit: 'px' }
    ] },
    { title: 'Color & outline', icon: 'M12 3a9 9 0 1 0 0 18c1 0 2-1 1-2-1-2 0-3 2-3h3a3 3 0 0 0 3-3 9 9 0 0 0-9-10z', items: [
      { key: 'color', type: 'color', label: 'Color', swatches: ['#fcc800', '#00ff66', '#00e5ff', '#ff2bd6', '#ff3b3b', '#ffffff'], when: (l) => l.kind !== 'image' || l.tint },
      { key: 'opacity', type: 'range', label: 'Opacity', min: 0.1, max: 1, step: 0.05, pct: true },
      { key: 'outline', type: 'check', label: 'Outline', kinds: ['shape', 'text', 'draw'] },
      { key: 'outlineColor', type: 'color', label: 'Outline color', kinds: ['shape', 'text', 'draw'], when: (l) => l.outline },
      { key: 'outlineThickness', type: 'range', label: 'Outline width', min: 0, max: 6, step: 1, unit: 'px', kinds: ['shape', 'text', 'draw'], when: (l) => l.outline },
      { key: 'outlineOpacity', type: 'range', label: 'Outline opacity', min: 0, max: 1, step: 0.05, pct: true, kinds: ['shape', 'text', 'draw'], when: (l) => l.outline }
    ] },
    { title: 'Transform', icon: 'M12 2v20M2 12h20M7 7l-3 5 3 5M17 7l3 5-3 5', items: [
      { key: 'offsetX', type: 'range', label: 'X', min: -250, max: 250, step: 1, unit: 'px' },
      { key: 'offsetY', type: 'range', label: 'Y', min: -250, max: 250, step: 1, unit: 'px' },
      { key: 'rotation', type: 'range', label: 'Rotation', min: 0, max: 359, step: 1, unit: '°' },
      { key: 'flipX', type: 'check', label: 'Flip left/right' },
      { key: 'flipY', type: 'check', label: 'Flip up/down' }
    ] },
    { title: 'Effects', icon: 'M12 2l2.5 6.5L21 9l-5 4.5 1.5 6.5L12 16.5 6.5 20 8 13.5 3 9l6.5-.5z', items: [
      { key: 'glow', type: 'range', label: 'Glow', min: 0, max: 30, step: 1, unit: 'px' },
      { key: 'blur', type: 'range', label: 'Blur', min: 0, max: 10, step: 1, unit: 'px' },
      { key: 'reactMode', type: 'select', label: 'Spread', options: [
        ['follow', 'Follow crosshair settings'], ['custom', 'Custom for this layer'], ['off', 'Don\u2019t spread or recolor']
      ] },
      { type: 'grid', title: 'Gap change (px) while…', cells: [
        ['dynMove', 'Moving'], ['dynRun', 'Running'], ['dynShoot', 'Shooting'],
        ['dynJump', 'Jumping'], ['dynAim', 'Aiming'], ['dynReload', 'Reloading']
      ], when: (l) => l.dynOwn }
    ] }
  ];
  // Keys that make sense on every kind of layer, so they can be set on a whole multi-selection.
  const SHARED_KEYS = {};
  SCHEMA.forEach((g) => { if (!g.kinds) g.items.forEach((it) => { if (it.key && !it.kinds) SHARED_KEYS[it.key] = true; if (it.cells) it.cells.forEach((c) => { SHARED_KEYS[c[0]] = true; }); }); });
  const ANIM_FIELDS = ['animation', 'animTrigger', 'animMode', 'animEase', 'animIntensity', 'animDuration'];

  // ---------------------------------------------------------------- helpers
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function pushSoon() {
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = 0;
      api.setCrosshair(canon());
    }, 50);
  }

  const baseExtent = Crosshair.baseExtent;

  function layerExtent(l) {
    return baseExtent(l) + (l.kind === 'shape' ? Crosshair.animsOf(l).reduce((n, a) => n + a.animIntensity, 0) : 0);
  }

  function designExtent(d, noOffset) {
    let m = 24;
    d.layers.forEach((l) => {
      if (l.visible === false) return;
      m = Math.max(m, layerExtent(l) + (noOffset ? 0 : Math.hypot(l.offsetX, l.offsetY)));
    });
    return m;
  }

  // ---- canvas zoom: "Fit" follows the design; −/+/wheel switch to a fixed zoom until Fit is pressed.
  let fitMode = true;
  let viewZoom = 2;
  const ZMIN = 0.25, ZMAX = 16;
  function fitZoom() {
    const st = $('#stage');
    const m = st ? Math.min(st.clientWidth, st.clientHeight) : 340;
    return Math.max(ZMIN, Math.min(6, ((m || 340) * 0.26) / designExtent(design)));
  }

  function updateZoom() {
    if (fitMode) viewZoom = fitZoom();
    previewZoom = viewZoom;
    preview.setZoom(viewZoom);
    $('#zoomLabel').textContent = Math.round(viewZoom * 100) + '%';
    $('#zoomFit').classList.toggle('on', fitMode);
    $('#stage').style.setProperty('--gz', (Math.max(4, viewZoom * (viewZoom >= 4 ? 1 : 5))) + 'px');
    refreshSel();
  }

  function setZoom(z) {
    fitMode = false;
    viewZoom = Math.max(ZMIN, Math.min(ZMAX, z));
    updateZoom();
  }

  // ---- undo / redo
  let hist = [];
  let hi = -1;
  let commitTimer = 0;
  const snap = () => JSON.stringify({ d: canon(), sel: sel, es: editState });

  function updateUndoButtons() {
    $('#undoBtn').disabled = hi <= 0 && !commitTimer;
    $('#redoBtn').disabled = hi >= hist.length - 1;
  }

  function commitNow() {
    clearTimeout(commitTimer);
    commitTimer = 0;
    const s0 = snap();
    if (hist[hi] !== s0) {
      hist = hist.slice(0, hi + 1);
      hist.push(s0);
      if (hist.length > 100) hist.shift();
      hi = hist.length - 1;
    }
    updateUndoButtons();
    markDirty();
  }

  function commitSoon() {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commitNow, 400);
    updateUndoButtons();
  }

  function restore(i) {
    const o = JSON.parse(hist[i]);
    hi = i;
    design = viewOf(Crosshair.sanitizeDesign(o.d), o.es || 'base');
    sel = Math.max(0, Math.min(design.layers.length - 1, o.sel | 0));
    multi.clear();
    syncStates();
    renderLayers();
    applyToControls();
    refreshAll();
    updateUndoButtons();
  }

  function undo() {
    if (commitTimer) commitNow();
    if (hi > 0) restore(hi - 1);
  }

  function redo() {
    if (commitTimer) commitNow();
    if (hi < hist.length - 1) restore(hi + 1);
  }

  function refreshAll() {
    markDirty();
    preview.setConfig(design);
    if (homePrev) homePrev.setConfig(canon());
    updateZoom();
    api.setCrosshair(canon());
  }

  // Indices of every selected layer (the inspector shows `sel`; Shift/Ctrl-click adds more).
  function selected() {
    const out = [sel];
    multi.forEach((i) => { if (i !== sel && i >= 0 && i < design.layers.length) out.push(i); });
    return out.sort((a, b) => a - b);
  }

  function update(key, val) {
    const L = cur();
    const targets = selected().filter((i) => SHARED_KEYS[key] || key === 'reactMode' || design.layers[i].kind === L.kind);
    if (key === 'reactMode') {
      targets.forEach((i) => {
        const l = design.layers[i];
        l.dynOwn = val === 'custom';
        l.dynamic = val !== 'off';
      });
      refreshVisibility();
      preview.setConfig(design);
      afterEdit();
      return;
    }
    if ((key === 'offsetX' || key === 'offsetY' || key === 'rotation') && targets.length > 1) {
      // Several layers: move/rotate them together by the change instead of stacking them on one value.
      const dv = val - L[key];
      targets.forEach((i) => {
        const l = design.layers[i];
        l[key] = key === 'rotation' ? ((((l[key] + dv) % 360) + 360) % 360) : Math.max(-250, Math.min(250, l[key] + dv));
      });
    } else {
      targets.forEach((i) => { design.layers[i][key] = val; });
    }
    if (key === 'tint' || key === 'outline' || key === 'dot') refreshVisibility();
    if (key === 'src') renderLayers();
    preview.setConfig(design);
    targets.forEach((i) => drawLayerThumb(i));
    afterEdit();
  }

  // Shared tail of every edit: zoom/selection box, live overlay, undo, real-size preview.
  function afterEdit() {
    updateZoom();
    pushSoon();
    commitSoon();
    markDirty();
  }

  // ---- animations (bottom strip). The first effect lives on the layer itself, extras in layer.anims.
  const ANIM_DEFAULT = { animation: 'expand', animTrigger: 'shoot', animMode: 'pulse', animEase: 'easeOut', animIntensity: 6, animDuration: 150 };
  const FADE_LIKE = ['fade', 'hide', 'show'];

  function animSlots(l) {
    const out = [];
    if (l.animation && l.animation !== 'none') out.push({ obj: l, own: true });
    (l.anims || []).forEach((a, i) => out.push({ obj: a, idx: i }));
    return out;
  }

  function addAnim() {
    const l = cur();
    const d = Object.assign({}, ANIM_DEFAULT);
    if (Crosshair.EASES.indexOf(d.animEase) < 0) d.animEase = Crosshair.EASES[0];
    if (!l.animation || l.animation === 'none') {
      ANIM_FIELDS.forEach((k) => { l[k] = d[k]; });
    } else {
      const list = l.anims || (l.anims = []);
      if (list.length >= Crosshair.MAX_EXTRA_ANIMS) { toast('Up to ' + (Crosshair.MAX_EXTRA_ANIMS + 1) + ' animations per layer'); return; }
      list.push(d);
    }
    animsChanged(true);
  }

  function removeAnim(slot) {
    const l = cur();
    if (slot.own) {
      if (l.anims && l.anims.length) {
        const next = l.anims.shift();
        ANIM_FIELDS.forEach((k) => { l[k] = next[k]; });
      } else {
        l.animation = 'none';
      }
    } else {
      l.anims.splice(slot.idx, 1);
    }
    if (l.anims && !l.anims.length) delete l.anims;
    animsChanged(true);
  }

  function animsChanged(rebuild) {
    if (rebuild) renderAnimCards();
    preview.setConfig(design);
    drawLayerThumb(sel);
    renderLayersSoon();
    afterEdit();
  }

  function easeCurve(id) {
    let d = '';
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const y = 1 - Math.max(-0.2, Math.min(1.2, Crosshair.ease(id, t)));
      d += (i ? 'L' : 'M') + (t * 100).toFixed(1) + ' ' + (4 + y * 22).toFixed(1);
    }
    return '<svg viewBox="0 0 100 30" preserveAspectRatio="none"><path d="' + d + '"/></svg>';
  }

  function renderAnimCards() {
    const host = $('#animCards');
    if (!host) return;
    host.textContent = '';
    const l = cur();
    const slots = animSlots(l);
    slots.forEach((slot) => {
      const a = slot.obj;
      const card = mk('div', { className: 'dz-acard' });
      const head = mk('div', { className: 'dz-ah' });
      const eff = mk('select', { className: 'dz-aeff', title: 'Effect' });
      ANIM_OPTS.filter((o) => o[0] !== 'none').forEach((o) => eff.appendChild(mk('option', { value: o[0], textContent: o[1], selected: o[0] === a.animation })));
      eff.addEventListener('change', () => { a.animation = eff.value; animsChanged(true); });
      const del = mk('button', { type: 'button', className: 'dz-ib xs', title: 'Remove this animation', innerHTML: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>' });
      del.addEventListener('click', () => removeAnim(slot));
      head.appendChild(eff);
      head.appendChild(del);
      card.appendChild(head);
      const grid = mk('div', { className: 'dz-ag' });
      const field = (label, el) => { const w = mk('label'); w.appendChild(mk('span', { textContent: label })); w.appendChild(el); grid.appendChild(w); };
      const selOf = (opts, key, after) => {
        const x = mk('select');
        opts.forEach((o) => x.appendChild(mk('option', { value: o[0], textContent: o[1], selected: o[0] === a[key] })));
        x.addEventListener('change', () => { a[key] = x.value; if (after) after(); animsChanged(!!after); });
        return x;
      };
      const numOf = (key, min, max, step) => {
        const n = mk('input', { type: 'number', className: 'num', min: min, max: max, step: step, value: a[key] });
        const commit = () => {
          let v = Number(n.value);
          if (n.value === '' || !Number.isFinite(v)) v = a[key];
          v = Math.max(min, Math.min(max, v));
          n.value = v;
          a[key] = v;
          animsChanged(false);
        };
        n.addEventListener('change', commit);
        n.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); e.stopPropagation(); });
        return n;
      };
      field('When', selOf(TRIG_OPTS, 'animTrigger', () => { a.animMode = HOLD_DEFAULT[a.animTrigger] || 'pulse'; }));
      field('Mode', selOf([['pulse', 'Pulse'], ['hold', 'While held']], 'animMode'));
      field('Easing', selOf(Crosshair.EASES.map((id) => [id, Crosshair.EASE_LABELS[id]]), 'animEase', () => {}));
      if (FADE_LIKE.indexOf(a.animation) < 0) field('Strength', numOf('animIntensity', 0, 30, 1));
      field('Speed (ms)', numOf('animDuration', 40, 600, 10));
      card.appendChild(grid);
      const curve = mk('div', { className: 'dz-curve', innerHTML: easeCurve(a.animEase) });
      const test = mk('button', { type: 'button', className: 'dz-test', textContent: 'Hold to test' });
      const down = (e) => { e.preventDefault(); test.classList.add('on'); preview.input({ type: 'trigger', action: a.animTrigger, down: true }); realInput({ type: 'trigger', action: a.animTrigger, down: true }); };
      const up = () => { if (!test.classList.contains('on')) return; test.classList.remove('on'); preview.input({ type: 'trigger', action: a.animTrigger, down: false }); realInput({ type: 'trigger', action: a.animTrigger, down: false }); };
      test.addEventListener('pointerdown', down);
      test.addEventListener('pointerup', up);
      test.addEventListener('pointerleave', up);
      const foot = mk('div', { className: 'dz-afoot' });
      foot.appendChild(curve);
      foot.appendChild(test);
      card.appendChild(foot);
      host.appendChild(card);
    });
    const max = Crosshair.MAX_EXTRA_ANIMS + 1;
    if (slots.length < max) {
      const add = mk('button', { type: 'button', className: 'dz-acard add', textContent: slots.length ? '+ Add animation' : '+ Animate this layer' });
      add.addEventListener('click', addAnim);
      host.appendChild(add);
    }
    const ob = $('#animOpenBtn');
    if (ob) ob.classList.toggle('has', slots.length > 0);
  }

  function refreshVisibility() {
    const l = cur();
    groups.forEach((g) => {
      g.el.hidden = !!(g.def.kinds && g.def.kinds.indexOf(l.kind) < 0);
      g.rows.forEach((r) => {
        r.el.hidden = !!((r.def.kinds && r.def.kinds.indexOf(l.kind) < 0) || (r.def.when && !r.def.when(l)));
      });
    });
    if (drawMode && l.kind !== 'draw') setDrawMode(false);
  }

  function applyToControls() {
    Object.keys(rows).forEach((k) => { if (k !== 'reactMode') rows[k].set(cur()[k]); });
    const L = cur();
    rows.reactMode.set(L.dynOwn ? 'custom' : (L.dynamic === false ? 'off' : 'follow'));
    renderAnimCards();
    refreshVisibility();
    const t = $('#inspectorTitle');
    if (t) {
      const n = selected().length;
      t.innerHTML = '';
      t.appendChild(document.createTextNode('INSPECTOR \u00b7 '));
      t.appendChild(mk('span', { textContent: n > 1 ? n + ' layers (editing ' + cur().name + ')' : cur().name }));
    }
    syncDynamics();
    refreshSel();
  }

  function applyNewConfig(c) {
    design = viewOf(Crosshair.sanitizeDesign(c), 'base');
    sel = 0;
    multi.clear();
    syncStates();
    renderLayers();
    applyToControls();
    refreshAll();
    commitNow();
  }


  // ---------------------------------------------------------------- dynamics + color rules (design level)
  const DYN_LABELS = {
    move: ['While moving', 'W A S D'], run: ['While running', 'Shift'], shoot: ['Per shot', 'kick'],
    jump: ['On jump', 'kick'], aim: ['While aiming', 'tighten < 0'], reload: ['On reload', 'kick']
  };
  const dynUI = { sliders: {} };

  function dynChanged() {
    preview.setConfig(design);
    if (homePrev) homePrev.setConfig(canon());
    updateZoom();
    pushSoon();
    commitSoon();
  }

  function dyn() {
    if (!design.dynamic) design.dynamic = Object.assign({}, Crosshair.DYN_DEFAULT);
    return design.dynamic;
  }

  function addDynRange(host, key, label, min, max, step, unit) {
    const row = mk('div', { className: 'row' });
    row.appendChild(mk('span', { className: 'name', textContent: label }));
    const ctl = mk('span', { className: 'ctl' });
    const input = mk('input', { type: 'range', min: min, max: max, step: step });
    const out = mk('output', { textContent: '' });
    const show = (v) => { out.textContent = v + unit; };
    input.addEventListener('input', () => { const v = Number(input.value); show(v); dyn()[key] = v; dynChanged(); });
    ctl.appendChild(input);
    ctl.appendChild(out);
    row.appendChild(ctl);
    host.appendChild(row);
    dynUI.sliders[key] = { set: (v) => { input.value = v; show(Number(v)); } };
  }

  function initDynamics() {
    const test = $('#dynTest');
    Crosshair.TRIGGER_IDS.forEach((id) => {
      const b = mk('button', { type: 'button', textContent: Crosshair.TRIGGER_LABELS[id], title: 'Hold to test' });
      const down = (e) => { e.preventDefault(); b.classList.add('on'); preview.input({ type: 'trigger', action: id, down: true }); realInput({ type: 'trigger', action: id, down: true }); };
      const up = () => { b.classList.remove('on'); preview.input({ type: 'trigger', action: id, down: false }); realInput({ type: 'trigger', action: id, down: false }); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointerleave', up);
      test.appendChild(b);
    });
    const body = $('#dynBody');
    const cells = mk('div', { className: 'cells' });
    Crosshair.DYN_KEYS.forEach((k) => {
      const cell = mk('label', { className: 'cell' });
      cell.appendChild(mk('span', { textContent: DYN_LABELS[k][0] }));
      const num = mk('input', { type: 'number', className: 'num', min: -30, max: 30, step: 0.5 });
      const commit = () => {
        let v = Number(num.value);
        if (num.value === '' || !Number.isFinite(v)) v = 0;
        v = Math.max(-30, Math.min(30, Math.round(v * 2) / 2));
        num.value = v;
        dyn()[k] = v;
        dynChanged();
      };
      num.addEventListener('change', commit);
      num.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); e.stopPropagation(); });
      cell.appendChild(num);
      cells.appendChild(cell);
      dynUI.sliders[k] = { set: (v) => { num.value = v; } };
    });
    body.appendChild(mk('div', { className: 'cellgrid-title', textContent: 'Gap change (px) while…' }));
    body.appendChild(cells);
    body.appendChild(mk('p', { className: 'hint', textContent: 'Positive spreads out, negative pulls in.' }));
    addDynRange(body, 'duration', 'Speed', 40, 600, 10, 'ms');
    const er = mk('div', { className: 'row' });
    er.appendChild(mk('span', { className: 'name', textContent: 'Curve' }));
    const ec = mk('span', { className: 'ctl' });
    const es = mk('select');
    Crosshair.EASES.forEach((id) => es.appendChild(mk('option', { value: id, textContent: Crosshair.EASE_LABELS[id] })));
    es.addEventListener('change', () => { dyn().ease = es.value; dynChanged(); });
    ec.appendChild(es);
    er.appendChild(ec);
    body.appendChild(er);
    dynUI.ease = es;
    $('#dynOn').addEventListener('change', () => { dyn().enabled = $('#dynOn').checked; body.hidden = !dyn().enabled; dynChanged(); });
    $('#addRuleBtn').addEventListener('click', () => {
      const rules = design.rules || (design.rules = []);
      if (rules.length >= Crosshair.MAX_RULES) { toast('Up to ' + Crosshair.MAX_RULES + ' rules'); return; }
      rules.push({ trigger: 'reload', color: '#ff3b3b', mode: 'hold', outline: false });
      renderRules();
      dynChanged();
    });
    syncDynamics();
  }

  function renderRules() {
    const host = $('#ruleList');
    host.textContent = '';
    (design.rules || []).forEach((r, i) => {
      const row = mk('div', { className: 'rule-row' });
      const tsel = mk('select', { title: 'When this is active' });
      TRIG_OPTS.forEach((o) => tsel.appendChild(mk('option', { value: o[0], textContent: o[1], selected: o[0] === r.trigger })));
      tsel.addEventListener('change', () => { r.trigger = tsel.value; dynChanged(); });
      const col = mk('input', { type: 'color', value: r.color, title: 'Blend toward this color' });
      col.addEventListener('input', () => { r.color = col.value; dynChanged(); });
      const msel = mk('select', { title: 'Hold: while pressed. Pulse: flash on press' });
      [['hold', 'While held'], ['pulse', 'Pulse']].forEach((o) => msel.appendChild(mk('option', { value: o[0], textContent: o[1], selected: o[0] === r.mode })));
      msel.addEventListener('change', () => { r.mode = msel.value; dynChanged(); });
      const ol = mk('input', { type: 'checkbox', checked: !!r.outline });
      ol.addEventListener('change', () => { r.outline = ol.checked; dynChanged(); });
      const olab = mk('label', {}); olab.appendChild(ol); olab.appendChild(document.createTextNode('Outline'));
      const del = mk('button', { type: 'button', textContent: '✕', title: 'Remove rule' });
      del.addEventListener('click', () => { design.rules.splice(i, 1); if (!design.rules.length) delete design.rules; renderRules(); dynChanged(); });
      [tsel, col, msel, olab, del].forEach((n) => row.appendChild(n));
      host.appendChild(row);
    });
  }

  function syncDynamics() {
    if (!dynUI.ease) return;
    const d = design.dynamic || Crosshair.DYN_DEFAULT;
    $('#dynOn').checked = !!d.enabled;
    $('#dynBody').hidden = !d.enabled;
    Object.keys(dynUI.sliders).forEach((k) => dynUI.sliders[k].set(d[k]));
    dynUI.ease.value = d.ease;
    renderRules();
  }


  // ---------------------------------------------------------------- states + layer tools
  const STATE_NAMES = { aim: 'While aiming', reload: 'While reloading', jump: 'While jumping', run: 'While running', move: 'While moving', shoot: 'While shooting' };
  const STYLE_KEYS = ['color', 'opacity', 'outline', 'outlineColor', 'outlineOpacity', 'outlineThickness', 'glow', 'blur', 'rounded',
    'animation', 'animTrigger', 'animMode', 'animEase', 'animIntensity', 'animDuration', 'dynamic', 'dynOwn', 'dynMove', 'dynRun', 'dynShoot', 'dynJump', 'dynAim', 'dynReload', 'anims'];

  function syncStates() {
    const sel_ = $('#stateSel');
    if (!sel_) return;
    const root = canon();
    sel_.textContent = '';
    sel_.appendChild(mk('option', { value: 'base', textContent: 'Normal crosshair' }));
    Crosshair.STATE_IDS.forEach((id) => {
      const has = !!(root.states && root.states[id]);
      sel_.appendChild(mk('option', { value: id, textContent: (has ? '• ' : '') + STATE_NAMES[id] }));
    });
    sel_.value = editState;
    $('#stateDel').hidden = editState === 'base';
    document.querySelector('.state-bar').classList.toggle('on', editState !== 'base');
    $('#stateSel').title = $('#stateHint').textContent = editState === 'base'
      ? 'Optional: pick a state to design a different crosshair that replaces this one while that action is held.'
      : 'Editing the crosshair shown ' + STATE_NAMES[editState].toLowerCase() + '. Switch back to “Normal crosshair” to edit the default.';
  }

  function switchState(id) {
    if (id === editState) return;
    if (commitTimer) commitNow();
    const root = canon();
    if (id !== 'base' && !(root.states && root.states[id])) {
      // First visit: start from a copy of the normal crosshair so there is something to tweak.
      root.states = Object.assign({}, root.states, { [id]: { layers: clone(root.layers) } });
    }
    design = viewOf(root, id);
    sel = 0;
    syncStates();
    renderLayers();
    applyToControls();
    refreshAll();
    commitNow();
  }

  function removeState() {
    if (editState === 'base') return;
    const root = canon();
    const st = Object.assign({}, root.states);
    delete st[editState];
    if (!Object.keys(st).length) delete root.states; else root.states = st;
    design = viewOf(root, 'base');
    sel = 0;
    syncStates();
    renderLayers();
    applyToControls();
    refreshAll();
    commitNow();
    toast('State removed');
  }

  function mirrorLayer(axis) {
    if (design.layers.length >= Crosshair.MAX_LAYERS) { toast('Layer limit reached (' + Crosshair.MAX_LAYERS + ')'); return; }
    const c = clone(cur());
    c.name = (c.name + (axis === 'x' ? ' ↔' : ' ↕')).slice(0, 40);
    // Flips apply in the world frame (before rotation), so toggling the flag plus negating the offset mirrors any layer.
    if (axis === 'x') { c.offsetX = -c.offsetX; c.flipX = !c.flipX; } else { c.offsetY = -c.offsetY; c.flipY = !c.flipY; }
    design.layers.splice(sel + 1, 0, Crosshair.sanitize(c));
    sel += 1;
    layerChanged();
  }

  function initStates() {
    $('#stateSel').addEventListener('change', () => switchState($('#stateSel').value));
    $('#stateDel').addEventListener('click', removeState);
    $('#copyStyleBtn').addEventListener('click', () => {
      styleClip = {};
      STYLE_KEYS.forEach((k) => { styleClip[k] = cur()[k] === undefined ? undefined : clone(cur()[k]); });
      $('#pasteStyleBtn').disabled = false;
      toast('Style copied');
    });
    $('#pasteStyleBtn').addEventListener('click', () => {
      if (!styleClip) return;
      selected().forEach((i) => {
        const l = design.layers[i];
        Object.assign(l, clone(styleClip));
        if (!l.anims) delete l.anims;
      });
      applyToControls();
      layerChanged();
      toast('Style pasted');
    });
    $('#mirrorHBtn').addEventListener('click', () => mirrorLayer('x'));
    $('#mirrorVBtn').addEventListener('click', () => mirrorLayer('y'));
    syncStates();
  }

  // ---------------------------------------------------------------- layers
  function drawThumb(canvas, c) {
    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    const d = Crosshair.sanitizeDesign(c);
    let ext = 6;
    d.layers.forEach((l) => { if (l.visible !== false) ext = Math.max(ext, baseExtent(l)); });
    Crosshair.draw(g, d, Crosshair.newAnim(), canvas.width / 2, canvas.height / 2, Math.min(6, (canvas.width * 0.46) / ext), { noOffset: true });
  }

  function drawLayerThumb(i) {
    const row = $('#layerList').querySelector('[data-i="' + i + '"]');
    if (!row) return;
    drawThumb($('canvas', row), { layers: [Object.assign({}, design.layers[i], { visible: true })] });
    const fx = $('.fx', row);
    if (fx) fx.hidden = !Crosshair.animsOf(design.layers[i]).length;
  }

  function markRows() {
    const s = selected();
    document.querySelectorAll('#layerList .layer-row').forEach((r) => {
      const i = Number(r.dataset.i);
      r.classList.toggle('selected', i === sel);
      r.classList.toggle('multi', i !== sel && s.indexOf(i) >= 0);
    });
  }

  // add = Shift/Ctrl-click: toggles the layer in the selection.
  function selectLayer(i, add) {
    if (add) {
      const set = new Set(selected());
      if (set.has(i) && set.size > 1) {
        set.delete(i);
        if (sel === i) sel = Array.from(set).pop();
      } else {
        set.add(i);
        sel = i;
      }
      multi.clear();
      set.forEach((j) => { if (j !== sel) multi.add(j); });
    } else {
      sel = i;
      multi.clear();
    }
    markRows();
    applyToControls();
    commitSoon();
  }

  const KIND_ICONS = {
    shape: 'M12 3v6M12 15v6M3 12h6M15 12h6',
    image: 'M4 5h16v14H4zM8 14l3-3 5 5',
    text: 'M5 6V4h14v2M12 4v16M9 20h6',
    draw: 'M4 20l4-1L19 8l-3-3L5 16z'
  };
  const svgIcon = (d) => '<svg viewBox="0 0 24 24"><path d="' + d + '"/></svg>';
  const EYE_ON = 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6';
  const EYE_OFF = 'M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3 3.5M6.6 6.6C4 8.4 2 12 2 12s4 6 10 6c1.6 0 3-.4 4.3-1';
  let dragFrom = -1;

  function startRename(i) {
    const row = $('#layerList').querySelector('[data-i="' + i + '"]');
    if (!row) return;
    const name = $('.layer-name', row);
    name.readOnly = false;
    name.focus();
    name.select();
  }

  function renderLayers() {
    const list = $('#layerList');
    list.textContent = '';
    const n = design.layers.length;
    const s = selected();
    for (let i = n - 1; i >= 0; i--) {
      const l = design.layers[i];
      const row = mk('div', { className: 'layer-row' + (i === sel ? ' selected' : '') + (i !== sel && s.indexOf(i) >= 0 ? ' multi' : '') + (l.visible === false ? ' hidden-layer' : '') });
      row.dataset.i = String(i);
      row.draggable = true;
      row.appendChild(mk('span', { className: 'grip', title: 'Drag to reorder', textContent: '⋮⋮' }));
      row.appendChild(mk('span', { className: 'kind', innerHTML: svgIcon(KIND_ICONS[l.kind] || KIND_ICONS.shape) }));
      const thumb = mk('canvas', { className: 'layer-thumb', width: 64, height: 64 });
      const name = mk('input', { type: 'text', className: 'layer-name', value: l.name, readOnly: true, maxLength: 40, spellcheck: false, tabIndex: -1 });
      const finish = () => {
        if (name.readOnly) return;
        name.readOnly = true;
        design.layers[i].name = name.value.trim().slice(0, 40) || 'Layer';
        name.value = design.layers[i].name;
        if (i === sel) applyToControls();
        commitNow();
      };
      name.addEventListener('dblclick', (e) => { e.stopPropagation(); startRename(i); });
      name.addEventListener('blur', finish);
      name.addEventListener('mousedown', (e) => { if (name.readOnly) e.preventDefault(); });
      name.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') name.blur();
        else if (e.key === 'Escape') { name.value = design.layers[i].name; name.blur(); }
        e.stopPropagation();
      });
      const fx = mk('span', { className: 'fx', title: 'This layer has animations', textContent: '✦', hidden: !Crosshair.animsOf(l).length });
      const eye = mk('button', { type: 'button', className: 'eye', title: 'Show / hide', innerHTML: svgIcon(l.visible === false ? EYE_OFF : EYE_ON) });
      eye.addEventListener('click', (e) => { e.stopPropagation(); toggleLayer(i); });
      row.appendChild(thumb);
      row.appendChild(name);
      row.appendChild(fx);
      row.appendChild(eye);
      row.addEventListener('click', (e) => {
        if (e.shiftKey || e.ctrlKey || e.metaKey) selectLayer(i, true);
        else if (i !== sel || multi.size) selectLayer(i, false);
      });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (selected().indexOf(i) < 0) selectLayer(i, false);
        else if (i !== sel) { sel = i; markRows(); applyToControls(); }
        openCtx(e.clientX, e.clientY, i);
      });
      row.addEventListener('dragstart', (e) => {
        if (!name.readOnly) { e.preventDefault(); return; }
        dragFrom = i;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(i)); } catch (err) { /* ignore */ }
      });
      row.addEventListener('dragend', () => { dragFrom = -1; row.classList.remove('dragging'); list.querySelectorAll('.drop-above,.drop-below').forEach((r) => r.classList.remove('drop-above', 'drop-below')); });
      row.addEventListener('dragover', (e) => {
        if (dragFrom < 0) return;
        e.preventDefault();
        const r = row.getBoundingClientRect();
        const above = e.clientY < r.top + r.height / 2;
        row.classList.toggle('drop-above', above);
        row.classList.toggle('drop-below', !above);
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop-above', 'drop-below'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        if (dragFrom < 0) return;
        const r = row.getBoundingClientRect();
        const above = e.clientY < r.top + r.height / 2;
        // The list shows the top layer first, so "above" in the list means a higher index.
        let to = above ? i + 1 : i;
        if (dragFrom < to) to -= 1;
        reorderLayer(dragFrom, to);
        dragFrom = -1;
      });
      list.appendChild(row);
      drawThumb(thumb, { layers: [Object.assign({}, l, { visible: true })] });
    }
    $('#addLayerBtn').disabled = n >= Crosshair.MAX_LAYERS;
    const cnt = $('#layerCount');
    if (cnt) cnt.textContent = String(n);
  }

  function reorderLayer(from, to) {
    to = Math.max(0, Math.min(design.layers.length - 1, to));
    if (from === to) return;
    const keep = selected().map((i) => design.layers[i]);
    const main = cur();
    const [l] = design.layers.splice(from, 1);
    design.layers.splice(to, 0, l);
    sel = design.layers.indexOf(main);
    multi.clear();
    keep.forEach((x) => { const j = design.layers.indexOf(x); if (j !== sel) multi.add(j); });
    layerChanged();
  }

  function layerChanged() {
    renderLayers();
    applyToControls();
    refreshAll();
    commitNow();
  }

  function addLayer(kind, extra) {
    if (design.layers.length >= Crosshair.MAX_LAYERS) { toast('Layer limit reached (' + Crosshair.MAX_LAYERS + ')'); return; }
    const labels = { shape: 'Layer', image: 'Image', text: 'Text', draw: 'Drawing' };
    const n = design.layers.length + 1;
    const l = Crosshair.sanitize(Object.assign({ name: labels[kind] + ' ' + n, kind: kind, animation: 'none' }, extra || {}));
    if (kind === 'text') l.text = 'X';
    design.layers.push(l);
    sel = design.layers.length - 1;
    multi.clear();
    layerChanged();
    setDrawMode(kind === 'draw');
  }

  function addOfKind(kind) {
    $('#addMenu').hidden = true;
    if (kind === 'image') {
      pickImage((img) => addLayer('image', { src: img.src, name: img.name, imgSize: 20, imgAspect: img.aspect }));
    } else {
      addLayer(kind);
    }
  }

  // Duplicates every selected layer (each copy goes right above its original).
  function dupLayer() {
    const idx = selected();
    if (design.layers.length + idx.length > Crosshair.MAX_LAYERS) { toast('Layer limit reached (' + Crosshair.MAX_LAYERS + ')'); return; }
    const copies = [];
    idx.slice().reverse().forEach((i) => {
      const c = clone(design.layers[i]);
      c.name = (c.name + ' copy').slice(0, 40);
      design.layers.splice(i + 1, 0, c);
      copies.push(c);
    });
    const main = copies[copies.length - 1 - idx.indexOf(sel)] || copies[0];
    sel = design.layers.indexOf(main);
    multi.clear();
    copies.forEach((c) => { const j = design.layers.indexOf(c); if (j !== sel) multi.add(j); });
    layerChanged();
  }

  function delLayer() {
    const idx = selected();
    if (idx.length >= design.layers.length) { toast('A crosshair needs at least one layer'); return; }
    idx.slice().reverse().forEach((i) => design.layers.splice(i, 1));
    sel = Math.max(0, Math.min(idx[0], design.layers.length - 1));
    multi.clear();
    layerChanged();
  }

  function moveLayer(i, dir) {
    reorderLayer(i, i + dir);
  }

  function toggleLayer(i) {
    const s = selected();
    const group = s.indexOf(i) >= 0 ? s : [i];
    const show = design.layers[i].visible === false;
    group.forEach((j) => { design.layers[j].visible = show; });
    layerChanged();
  }

  // ---- right-click menu on a layer
  function openCtx(x, y, i) {
    const m = $('#ctxMenu');
    m.textContent = '';
    const n = selected().length;
    const item = (label, key, fn, dis) => {
      const b = mk('button', { type: 'button', disabled: !!dis });
      b.appendChild(mk('span', { textContent: label }));
      if (key) b.appendChild(mk('kbd', { textContent: key }));
      b.addEventListener('click', () => { m.hidden = true; fn(); });
      m.appendChild(b);
    };
    const sep = () => m.appendChild(mk('hr'));
    item('Rename', 'F2', () => startRename(i), n > 1);
    item(n > 1 ? 'Duplicate ' + n + ' layers' : 'Duplicate', 'Ctrl+D', dupLayer);
    item(design.layers[i].visible === false ? 'Show' : 'Hide', 'H', () => toggleLayer(i));
    sep();
    item('Bring forward', 'Ctrl+]', () => moveLayer(i, 1), i >= design.layers.length - 1 || n > 1);
    item('Send backward', 'Ctrl+[', () => moveLayer(i, -1), i <= 0 || n > 1);
    item('Mirror copy ↔', '', () => mirrorLayer('x'), n > 1);
    item('Mirror copy ↕', '', () => mirrorLayer('y'), n > 1);
    sep();
    item('Copy style', 'Ctrl+Shift+C', () => $('#copyStyleBtn').click(), n > 1);
    item('Paste style', 'Ctrl+Shift+V', () => $('#pasteStyleBtn').click(), !styleClip);
    sep();
    item(n > 1 ? 'Delete ' + n + ' layers' : 'Delete', 'Del', delLayer, n >= design.layers.length);
    m.hidden = false;
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
    m.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
  }

  // ---------------------------------------------------------------- controls
  const GROUPS_KEY = 'ezr.closedGroups';
  let closedGroups = { 'Color & outline': true, Transform: true, Effects: true };
  try { const o = JSON.parse(localStorage.getItem(GROUPS_KEY) || 'null'); if (o && typeof o === 'object') closedGroups = o; } catch (e) { /* ignore */ }

  function buildControls() {
    const host = $('#controls');
    SCHEMA.forEach((g) => {
      const box = mk('section', { className: 'group' + (closedGroups[g.title] ? ' collapsed' : '') });
      const gh = mk('h3');
      gh.appendChild(mk('span', { className: 'gi', innerHTML: svgIcon(g.icon || 'M12 12h.01') }));
      gh.appendChild(mk('span', { className: 'gt', textContent: g.title }));
      gh.appendChild(mk('span', { className: 'gc', innerHTML: svgIcon('M6 9l6 6 6-6') }));
      gh.addEventListener('click', () => {
        box.classList.toggle('collapsed');
        closedGroups[g.title] = box.classList.contains('collapsed');
        try { localStorage.setItem(GROUPS_KEY, JSON.stringify(closedGroups)); } catch (e) { /* ignore */ }
      });
      box.appendChild(gh);
      const grp = { el: box, def: g, rows: [] };
      groups.push(grp);
      g.items.forEach((it) => {
        if (it.type === 'hint') {
          const h = mk('p', { className: 'hint', textContent: it.text });
          grp.rows.push({ el: h, def: it });
          box.appendChild(h);
          return;
        }
        if (it.type === 'extras') {
          const wrap = mk('div', { className: 'extras' });
          grp.rows.push({ el: wrap, def: it });
          box.appendChild(wrap);
          extrasUI.host = wrap;
          return;
        }
        if (it.type === 'grid') {
          const wrap = mk('div', { className: 'cellgrid' });
          wrap.appendChild(mk('div', { className: 'cellgrid-title', textContent: it.title }));
          const cells = mk('div', { className: 'cells' });
          it.cells.forEach((c) => {
            const cell = mk('label', { className: 'cell' });
            cell.appendChild(mk('span', { textContent: c[1] }));
            const num = mk('input', { type: 'number', className: 'num', min: -30, max: 30, step: 0.5 });
            const commit = () => {
              let v = Number(num.value);
              if (num.value === '' || !Number.isFinite(v)) v = 0;
              v = Math.max(-30, Math.min(30, Math.round(v * 2) / 2));
              num.value = v;
              update(c[0], v);
            };
            num.addEventListener('change', commit);
            num.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); e.stopPropagation(); });
            cell.appendChild(num);
            cells.appendChild(cell);
            rows[c[0]] = { set: (v) => { num.value = v; } };
          });
          wrap.appendChild(cells);
          grp.rows.push({ el: wrap, def: it });
          box.appendChild(wrap);
          return;
        }
        const row = mk('div', { className: 'row' });
        row.appendChild(mk('span', { className: 'name', textContent: it.label }));
        const ctl = mk('span', { className: 'ctl' });
        row.appendChild(ctl);

        if (it.type === 'range') {
          const input = mk('input', { type: 'range', min: it.min, max: it.max, step: it.step });
          const k = it.pct ? 100 : 1;
          const num = mk('input', { type: 'number', className: 'num', min: it.min * k, max: it.max * k, step: it.step * k });
          const unit = mk('span', { className: 'unit', textContent: it.pct ? '%' : (it.unit || '') });
          const show = (v) => { num.value = it.pct ? Math.round(v * 100) : v; };
          input.addEventListener('input', () => {
            const v = Number(input.value);
            show(v);
            update(it.key, v);
          });
          const fromNum = () => {
            let v = Number(num.value);
            if (num.value === '' || !Number.isFinite(v)) { show(Number(input.value)); return; }
            v = Math.max(it.min, Math.min(it.max, v / k));
            v = Math.round(v / it.step) * it.step;
            v = Math.round(v * 1000) / 1000;
            input.value = v;
            show(v);
            update(it.key, v);
          };
          num.addEventListener('change', fromNum);
          num.addEventListener('keydown', (e) => { if (e.key === 'Enter') fromNum(); e.stopPropagation(); });
          ctl.appendChild(input);
          ctl.appendChild(num);
          ctl.appendChild(unit);
          rows[it.key] = { set: (v) => { input.value = v; show(v); } };
        } else if (it.type === 'shape') {
          const btn = mk('button', { type: 'button', className: 'shape-btn' });
          const thumb = mk('canvas', { width: 72, height: 72 });
          const label = mk('span');
          btn.appendChild(thumb);
          btn.appendChild(label);
          btn.addEventListener('click', openShapePicker);
          ctl.appendChild(btn);
          rows[it.key] = { set: (v) => {
            label.textContent = (Crosshair.STYLE_LABELS[v] || v) + ' \u25be';
            drawShapeTile(thumb, v);
          } };
        } else if (it.type === 'text') {
          const inp = mk('input', { type: 'text', className: 'textin', maxLength: 24, spellcheck: false });
          inp.addEventListener('input', () => { update(it.key, inp.value); renderLayersSoon(); });
          inp.addEventListener('keydown', (e) => e.stopPropagation());
          ctl.appendChild(inp);
          rows[it.key] = { set: (v) => { if (inp.value !== v) inp.value = v; } };
        } else if (it.type === 'action') {
          const b = mk('button', { type: 'button', textContent: it.text });
          b.addEventListener('click', it.fn);
          ctl.appendChild(b);
        } else if (it.type === 'drawtools') {
          buildDrawTools(ctl);
        } else if (it.type === 'pair') {
          it.items.forEach((p) => {
            const sel = mk('select');
            p.options.forEach((o) => sel.appendChild(mk('option', { value: o[0], textContent: o[1] })));
            sel.addEventListener('change', () => update(p.key, sel.value));
            ctl.appendChild(sel);
            rows[p.key] = { set: (v) => { sel.value = v; } };
          });
        } else if (it.type === 'select') {
          const sel = mk('select');
          it.options.forEach((o) => sel.appendChild(mk('option', { value: o[0], textContent: o[1] })));
          sel.addEventListener('change', () => update(it.key, sel.value));
          ctl.appendChild(sel);
          rows[it.key] = { set: (v) => { sel.value = v; } };
        } else if (it.type === 'check') {
          const chk = mk('input', { type: 'checkbox' });
          chk.addEventListener('change', () => update(it.key, chk.checked));
          ctl.appendChild(chk);
          rows[it.key] = { set: (v) => { chk.checked = !!v; } };
        } else if (it.type === 'color') {
          const col = mk('input', { type: 'color' });
          const hex = mk('input', { type: 'text', className: 'hex', maxLength: 7, spellcheck: false });
          const setBoth = (v) => { col.value = v; hex.value = v; };
          col.addEventListener('input', () => { hex.value = col.value; update(it.key, col.value); });
          hex.addEventListener('change', () => {
            let v = hex.value.trim();
            if (/^[0-9a-f]{6}$/i.test(v)) v = '#' + v;
            if (/^#[0-9a-f]{6}$/i.test(v)) { v = v.toLowerCase(); setBoth(v); update(it.key, v); }
            else hex.value = col.value;
          });
          ctl.appendChild(col);
          ctl.appendChild(hex);
          (it.swatches || []).forEach((c) => {
            const b = mk('button', { type: 'button', className: 'sw', title: c });
            b.style.background = c;
            b.addEventListener('click', () => { setBoth(c); update(it.key, c); });
            ctl.appendChild(b);
          });
          rows[it.key] = { set: setBoth };
        }
        grp.rows.push({ el: row, def: it });
        box.appendChild(row);
      });
      host.appendChild(box);
    });
  }

  // ---------------------------------------------------------------- shape picker
  const tileCache = {};

  // Draws a shape big on a scratch canvas, crops to its bounds and scales it to fit the tile.
  function drawShapeTile(canvas, id) {
    const S = 360;
    const key = id + '|' + canvas.width;
    let img = tileCache[key];
    if (!img) {
      const off = document.createElement('canvas');
      off.width = S; off.height = S;
      const g = off.getContext('2d');
      const demo = Crosshair.sanitize({
        style: id, color: '#ffffff', size: 10, gap: 3, thickness: 3, outline: true, outlineColor: '#000000',
        outlineThickness: 1, dot: false, tStyle: false, rotation: 0, opacity: 1
      });
      Crosshair.draw(g, demo, Crosshair.newAnim(), S / 2, S / 2, 4);
      const d = g.getImageData(0, 0, S, S).data;
      let x0 = S, y0 = S, x1 = -1, y1 = -1;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          if (d[(y * S + x) * 4 + 3] > 8) {
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
      }
      img = x1 < 0 ? null : { off: off, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
      tileCache[key] = img;
    }
    const t = canvas.getContext('2d');
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.clearRect(0, 0, canvas.width, canvas.height);
    if (!img) return;
    const box = canvas.width * 0.78;
    const k = Math.min(box / img.w, box / img.h);
    const w = img.w * k, h = img.h * k;
    t.imageSmoothingQuality = 'high';
    t.drawImage(img.off, img.x, img.y, img.w, img.h, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  }

  let shapeBuilt = false;
  function buildShapePicker() {
    if (shapeBuilt) return;
    shapeBuilt = true;
    const host = $('#shapeGroups');
    Crosshair.SHAPE_GROUPS.forEach((grp) => {
      const sec = mk('section', { className: 'shape-group' });
      sec.appendChild(mk('h4', { textContent: grp.title }));
      const grid = mk('div', { className: 'shape-grid' });
      grp.items.forEach((it) => {
        const tile = mk('button', { type: 'button', className: 'shape-tile', title: it[1] });
        tile.dataset.shape = it[0];
        const cv = mk('canvas', { width: 128, height: 128 });
        drawShapeTile(cv, it[0]);
        tile.appendChild(cv);
        tile.appendChild(mk('span', { textContent: it[1] }));
        tile.addEventListener('click', () => {
          update('style', it[0]);
          rows.style.set(it[0]);
          closeShapePicker();
        });
        grid.appendChild(tile);
      });
      sec.appendChild(grid);
      host.appendChild(sec);
    });
  }

  function openShapePicker() {
    buildShapePicker();
    document.querySelectorAll('.shape-tile').forEach((t) => t.classList.toggle('selected', t.dataset.shape === cur().style));
    $('#shapeModal').hidden = false;
    const sel = document.querySelector('.shape-tile.selected');
    if (sel) sel.scrollIntoView({ block: 'center' });
  }

  function closeShapePicker() {
    $('#shapeModal').hidden = true;
  }

  // ---------------------------------------------------------------- images, drawing, triggers
  let layersTimer = 0;
  function renderLayersSoon() {
    clearTimeout(layersTimer);
    layersTimer = setTimeout(renderLayers, 250);
  }

  // Reads an image file, shrinks it to at most 256px and returns a PNG data URL.
  function pickImage(cb) {
    const input = $('#imgFile');
    input.value = '';
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onerror = () => toast('Could not read that image');
      rd.onload = () => {
        const img = new Image();
        img.onload = () => {
          const w0 = img.naturalWidth || 256;
          const h0 = img.naturalHeight || 256;
          // Animated formats keep their original bytes so the frames survive.
          if (/^data:image\/(gif|webp);base64,/.test(rd.result)) {
            if (rd.result.length <= 650000) {
              cb({ src: rd.result, aspect: h0 / w0, name: f.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Image' });
              return;
            }
            if (/^data:image\/gif/.test(rd.result)) { toast('That GIF is too large (limit about 480 KB). Try fewer frames or a smaller size.'); return; }
          }
          let max = 256;
          let data = '';
          for (let tries = 0; tries < 4; tries++) {
            const k = Math.min(1, max / Math.max(w0, h0));
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(w0 * k));
            c.height = Math.max(1, Math.round(h0 * k));
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            data = c.toDataURL('image/png');
            if (data.length <= 650000) break;
            max = Math.round(max * 0.6);
          }
          if (data.length > 650000) { toast('That image is too detailed. Try a smaller one.'); return; }
          cb({ src: data, aspect: h0 / w0, name: f.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Image' });
        };
        img.onerror = () => toast('Could not read that image');
        img.src = rd.result;
      };
      rd.readAsDataURL(f);
    };
    input.click();
  }

  function setDrawMode(on) {
    drawMode = !!on && cur().kind === 'draw';
    $('#stage').classList.toggle('drawing', drawMode);
    const top = $('#drawHintTop');
    if (top) top.hidden = !drawMode;
    refreshSel();
    const b = $('#drawToggle');
    if (b) { b.classList.toggle('active', drawMode); b.textContent = drawMode ? 'Drawing… (click to stop)' : 'Draw on preview'; }
    const hint = $('#drawHint');
    if (hint) hint.hidden = !drawMode;
  }

  function buildDrawTools(ctl) {
    const wrap = mk('div');
    const bar = mk('div', { className: 'draw-tools' });
    const tog = mk('button', { type: 'button', id: 'drawToggle', textContent: 'Draw on preview' });
    tog.addEventListener('click', () => setDrawMode(!drawMode));
    const undo = mk('button', { type: 'button', id: 'strokeUndo', textContent: 'Undo stroke' });
    undo.addEventListener('click', () => {
      const l = cur();
      if (l.kind !== 'draw' || !l.strokes.length) return;
      const n = Math.max(1, lastStrokeGroup);
      l.strokes.splice(Math.max(0, l.strokes.length - n), n);
      lastStrokeGroup = 1;
      strokesChanged();
    });
    const clr = mk('button', { type: 'button', id: 'strokeClear', textContent: 'Clear' });
    clr.addEventListener('click', () => { cur().strokes = []; strokesChanged(); });
    const sym = mk('select', { id: 'symSel' });
    [['none', 'No mirror'], ['x', 'Mirror left/right'], ['y', 'Mirror up/down'], ['xy', 'Mirror all 4']].forEach((o) => sym.appendChild(mk('option', { value: o[0], textContent: o[1] })));
    sym.addEventListener('change', () => { symmetry = sym.value; });
    bar.appendChild(tog);
    bar.appendChild(undo);
    bar.appendChild(clr);
    bar.appendChild(sym);
    wrap.appendChild(bar);
    wrap.appendChild(mk('div', { id: 'drawHint', className: 'draw-hint', hidden: true, textContent: 'Click and drag on the canvas. Use a mirror option for a symmetric crosshair.' }));
    ctl.appendChild(wrap);
  }

  let lastStrokeGroup = 1;
  function strokesChanged() {
    preview.setConfig(design);
    updateZoom();
    drawLayerThumb(sel);
    pushSoon();
    commitNow();
  }

  // ---------------------------------------------------------------- canvas: selection box, move / scale / rotate
  let snapOn = true;
  const boundsCache = new Map();
  const scratch = document.createElement('canvas');
  scratch.width = scratch.height = 400;

  // Tight box of a layer in its own (unrotated) frame, measured from real pixels so every shape kind fits.
  function layerBounds(l) {
    const src = l.src ? l.src.length + ':' + l.src.slice(-48) : '';
    const key = JSON.stringify(Object.assign({}, l, { src: src, name: '', offsetX: 0, offsetY: 0, rotation: 0, visible: true, anims: null, animation: 'none' }));
    let b = boundsCache.get(key);
    if (b) return b;
    const ext = Math.max(4, baseExtent(l));
    const k = Math.min(8, 180 / ext);
    const g = scratch.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, 400, 400);
    const one = Crosshair.sanitize(Object.assign({}, l, { offsetX: 0, offsetY: 0, rotation: 0, visible: true, glow: 0, blur: 0, animation: 'none', anims: undefined }));
    Crosshair.draw(g, { layers: [one] }, Crosshair.newAnim(), 200, 200, k, { noOffset: true });
    const d = g.getImageData(0, 0, 400, 400).data;
    let x0 = 400, y0 = 400, x1 = -1, y1 = -1;
    for (let y = 0; y < 400; y += 1) {
      const row = y * 1600;
      for (let x = 0; x < 400; x += 1) {
        if (d[row + x * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
    }
    if (x1 < 0) b = { x0: -ext / 2, y0: -ext / 2, x1: ext / 2, y1: ext / 2, empty: true };
    else b = { x0: (x0 - 200) / k, y0: (y0 - 200) / k, x1: (x1 + 1 - 200) / k, y1: (y1 + 1 - 200) / k };
    if (boundsCache.size > 300) boundsCache.clear();
    if (!b.empty) boundsCache.set(key, b);
    return b;
  }

  // Visual rotation of a layer on screen (a single flip mirrors the direction of rotation).
  const visRot = (l) => (l.flipX !== l.flipY ? -1 : 1) * l.rotation;

  function stageCenter() {
    const st = $('#stage');
    return [st.clientWidth / 2, st.clientHeight / 2];
  }

  // Stage pixel -> which layer is under it (selected layer wins, then the top-most).
  function hitTest(px, py) {
    const c = stageCenter();
    const dx = (px - c[0]) / viewZoom, dy = (py - c[1]) / viewZoom;
    const pad = 4 / viewZoom;
    const hit = (i) => {
      const l = design.layers[i];
      if (!l || l.visible === false) return false;
      const b = layerBounds(l);
      const a = (-visRot(l) * Math.PI) / 180;
      const x = dx - l.offsetX, y = dy - l.offsetY;
      const lx = x * Math.cos(a) - y * Math.sin(a), ly = x * Math.sin(a) + y * Math.cos(a);
      return lx >= b.x0 - pad && lx <= b.x1 + pad && ly >= b.y0 - pad && ly <= b.y1 + pad;
    };
    if (hit(sel)) return sel;
    for (let i = design.layers.length - 1; i >= 0; i--) if (hit(i)) return i;
    return -1;
  }

  function refreshSel() {
    const host = $('#selLayer');
    if (!host || !preview) return;
    host.textContent = '';
    if (drawMode) return;
    const c = stageCenter();
    selected().forEach((i) => {
      const l = design.layers[i];
      if (!l || l.visible === false) return;
      const b = layerBounds(l);
      const box = mk('div', { className: 'dz-box' + (i === sel ? ' main' : '') });
      const w = (b.x1 - b.x0) * viewZoom, h = (b.y1 - b.y0) * viewZoom;
      box.style.width = w + 'px';
      box.style.height = h + 'px';
      box.style.left = (c[0] + l.offsetX * viewZoom) + 'px';
      box.style.top = (c[1] + l.offsetY * viewZoom) + 'px';
      box.style.transform = 'rotate(' + visRot(l) + 'deg) translate(' + (b.x0 * viewZoom) + 'px,' + (b.y0 * viewZoom) + 'px)';
      if (i === sel) {
        box.appendChild(mk('span', { className: 'dz-tag', textContent: l.name }));
        const rot = mk('span', { className: 'dz-rot', title: 'Drag to rotate (Shift = 15° steps)' });
        rot.dataset.h = 'rot';
        box.appendChild(rot);
        ['nw', 'ne', 'sw', 'se'].forEach((p) => {
          const hd = mk('span', { className: 'dz-h ' + p, title: 'Drag to resize' });
          hd.dataset.h = 'scale';
          box.appendChild(hd);
        });
      }
      host.appendChild(box);
    });
  }

  // Uniform resize of one layer from a saved copy; values stay inside each slider's range.
  const clampTo = (v, lo, hi, st) => Math.max(lo, Math.min(hi, Math.round(v / st) * st));
  function scaleLayer(l, s0, k) {
    const st = snapOn ? 0.5 : 0.1;
    if (l.kind === 'shape') {
      l.size = clampTo(s0.size * k, 0, 60, st);
      l.gap = clampTo(s0.gap * k, 0, 40, st);
      l.thickness = clampTo(s0.thickness * k, 1, 12, st);
      l.dotSize = clampTo(s0.dotSize * k, 1, 12, 1);
    } else if (l.kind === 'image') {
      l.imgSize = clampTo(s0.imgSize * k, 4, 400, 1);
    } else if (l.kind === 'text') {
      l.fontSize = clampTo(s0.fontSize * k, 6, 200, 1);
    } else if (l.kind === 'draw') {
      l.strokes = s0.strokes.map((stk) => stk.map((p) => [p[0] * k, p[1] * k]));
      l.brush = clampTo(s0.brush * k, 1, 24, 1);
    }
  }

  function syncRows(keys) {
    keys.forEach((k) => { if (rows[k]) rows[k].set(cur()[k]); });
  }

  function wirePreviewPointer() {
    const st = $('#stage');
    const cv = $('#previewCanvas');
    let live = null; // arrays being filled for the current stroke (one per mirror)
    let drag = null;
    const local = (e) => {
      const r = st.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const toLayer = (e) => {
      const r = cv.getBoundingClientRect();
      const l = cur();
      let x = ((e.clientX - r.left) * (cv.offsetWidth / r.width) - cv.offsetWidth / 2) / previewZoom - l.offsetX;
      let y = ((e.clientY - r.top) * (cv.offsetHeight / r.height) - cv.offsetHeight / 2) / previewZoom - l.offsetY;
      const a = (-l.rotation * Math.PI) / 180;
      return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
    };
    const mirrors = () => {
      const m = [[1, 1]];
      if (symmetry === 'x' || symmetry === 'xy') m.push([-1, 1]);
      if (symmetry === 'y' || symmetry === 'xy') m.push([1, -1]);
      if (symmetry === 'xy') m.push([-1, -1]);
      return m;
    };
    const trig = (action, down) => { preview.input({ type: 'trigger', action: action, down: down }); realInput({ type: 'trigger', action: action, down: down }); };

    st.addEventListener('contextmenu', (e) => e.preventDefault());
    st.addEventListener('wheel', (e) => {
      if (e.target.closest('.dz-real')) return;
      e.preventDefault();
      setZoom(viewZoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    }, { passive: false });

    st.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.dz-real')) return;
      if (e.button === 2) { drag = { kind: 'aim' }; trig('aim', true); st.setPointerCapture(e.pointerId); return; }
      if (e.button !== 0) return;
      if (drawMode && cur().kind === 'draw') {
        e.preventDefault();
        st.setPointerCapture(e.pointerId);
        const p = toLayer(e);
        const ms = mirrors();
        live = ms.map((m) => [[p[0] * m[0], p[1] * m[1]]]);
        live.forEach((stk) => cur().strokes.push(stk));
        live.ms = ms;
        preview.setConfig(design);
        return;
      }
      const p = local(e);
      const handle = e.target.dataset && e.target.dataset.h;
      const c = stageCenter();
      if (handle) {
        e.preventDefault();
        st.setPointerCapture(e.pointerId);
        const l = cur();
        const lc = [c[0] + l.offsetX * viewZoom, c[1] + l.offsetY * viewZoom];
        drag = {
          kind: handle, lc: lc, moved: false,
          d0: Math.max(4, Math.hypot(p[0] - lc[0], p[1] - lc[1])),
          a0: Math.atan2(p[1] - lc[1], p[0] - lc[0]),
          starts: selected().map((i) => ({ i: i, s: clone(design.layers[i]) }))
        };
        return;
      }
      const i = hitTest(p[0], p[1]);
      if (i < 0) {
        if (multi.size && !(e.shiftKey || e.ctrlKey)) { multi.clear(); markRows(); applyToControls(); }
        drag = { kind: 'shoot' };
        trig('shoot', true);
        st.setPointerCapture(e.pointerId);
        return;
      }
      e.preventDefault();
      if (e.shiftKey || e.ctrlKey || e.metaKey) { selectLayer(i, true); return; }
      if (selected().indexOf(i) < 0) selectLayer(i, false);
      else if (i !== sel) { sel = i; markRows(); applyToControls(); }
      st.setPointerCapture(e.pointerId);
      drag = { kind: 'move', p0: p, moved: false, starts: selected().map((j) => ({ i: j, x: design.layers[j].offsetX, y: design.layers[j].offsetY })) };
    });

    st.addEventListener('pointermove', (e) => {
      if (live) {
        const p = toLayer(e);
        let moved = false;
        live.forEach((stk, i) => {
          const m = live.ms[i];
          const q = [p[0] * m[0], p[1] * m[1]];
          const last = stk[stk.length - 1];
          if (Math.hypot(q[0] - last[0], q[1] - last[1]) >= 0.8 && stk.length < 600) { stk.push(q); moved = true; }
        });
        if (moved) preview.setConfig(design);
        return;
      }
      if (!drag || drag.kind === 'shoot' || drag.kind === 'aim') {
        if (!drag) {
          const h = e.target.dataset && e.target.dataset.h;
          const p = local(e);
          st.style.cursor = h === 'rot' ? 'grab' : h === 'scale' ? 'nwse-resize' : (hitTest(p[0], p[1]) >= 0 ? 'move' : '');
        }
        return;
      }
      const p = local(e);
      const free = e.altKey || !snapOn;
      if (drag.kind === 'move') {
        let dx = (p[0] - drag.p0[0]) / viewZoom, dy = (p[1] - drag.p0[1]) / viewZoom;
        if (!drag.moved && Math.hypot(dx, dy) * viewZoom < 2) return;
        drag.moved = true;
        const m0 = drag.starts.find((s0) => s0.i === sel) || drag.starts[0];
        if (!free) {
          // Whole pixels, and the main layer sticks to the center lines.
          let nx = Math.round(m0.x + dx), ny = Math.round(m0.y + dy);
          const stick = 5 / viewZoom;
          if (Math.abs(m0.x + dx) < stick) nx = 0;
          if (Math.abs(m0.y + dy) < stick) ny = 0;
          dx = nx - m0.x; dy = ny - m0.y;
        }
        drag.starts.forEach((s0) => {
          const l = design.layers[s0.i];
          l.offsetX = Math.max(-250, Math.min(250, Math.round((s0.x + dx) * 10) / 10));
          l.offsetY = Math.max(-250, Math.min(250, Math.round((s0.y + dy) * 10) / 10));
        });
        syncRows(['offsetX', 'offsetY']);
      } else if (drag.kind === 'scale') {
        drag.moved = true;
        const k = Math.max(0.05, Math.hypot(p[0] - drag.lc[0], p[1] - drag.lc[1]) / drag.d0);
        drag.starts.forEach((s0) => scaleLayer(design.layers[s0.i], s0.s, k));
        syncRows(['size', 'gap', 'thickness', 'dotSize', 'imgSize', 'fontSize', 'brush']);
      } else if (drag.kind === 'rot') {
        drag.moved = true;
        const a = Math.atan2(p[1] - drag.lc[1], p[0] - drag.lc[0]);
        let delta = ((a - drag.a0) * 180) / Math.PI;
        drag.starts.forEach((s0) => {
          const l = design.layers[s0.i];
          const sg = l.flipX !== l.flipY ? -1 : 1;
          let r = s0.s.rotation + sg * delta;
          r = e.shiftKey ? Math.round(r / 15) * 15 : (free ? Math.round(r * 10) / 10 : Math.round(r));
          l.rotation = Math.round((((r % 360) + 360) % 360) * 10) / 10 % 360;
        });
        syncRows(['rotation']);
      }
      preview.setConfig(design);
      refreshSel();
      pushSoon();
    });

    const end = () => {
      if (live) {
        lastStrokeGroup = live.length;
        live = null;
        strokesChanged();
        return;
      }
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.kind === 'shoot') trig('shoot', false);
      else if (d.kind === 'aim') trig('aim', false);
      else if (d.moved) {
        selected().forEach((i) => drawLayerThumb(i));
        updateZoom();
        pushSoon();
        commitNow();
      }
    };
    st.addEventListener('pointerup', end);
    st.addEventListener('pointercancel', end);
  }

  // ---- triggers
  function triggerLabel(n) {
    return n.replace(/^Mouse(\d)$/, (m, d) => 'Mouse ' + d);
  }

  function renderTriggers() {
    const host = $('#triggerList');
    host.textContent = '';
    Crosshair.TRIGGER_IDS.forEach((id) => {
      const row = mk('div', { className: 'trig-row' });
      const name = mk('button', { type: 'button', className: 'trig-name', textContent: Crosshair.TRIGGER_LABELS[id], title: 'Hold to preview' });
      const down = (e) => { e.preventDefault(); name.classList.add('on'); preview.input({ type: 'trigger', action: id, down: true }); };
      const up = () => { name.classList.remove('on'); preview.input({ type: 'trigger', action: id, down: false }); };
      name.addEventListener('pointerdown', down);
      name.addEventListener('pointerup', up);
      name.addEventListener('pointerleave', up);
      const keys = mk('span', { className: 'trig-keys' });
      triggers[id].forEach((n, i) => {
        if (i > 0) keys.appendChild(mk('i', { textContent: '/' }));
        const chip = mk('button', { type: 'button', className: 'chip' + (customizing ? ' editable' : ''), textContent: triggerLabel(n), disabled: !customizing });
        chip.dataset.action = id;
        chip.dataset.slot = String(i);
        chip.addEventListener('click', () => captureTrigger(id, i, chip));
        keys.appendChild(chip);
      });
      row.appendChild(name);
      row.appendChild(keys);
      host.appendChild(row);
    });
    $('#trigCustomize').textContent = customizing ? 'Done' : 'Customize';
    $('#trigReset').hidden = !customizing;
    $('#trigHint').textContent = customizing
      ? 'Click a key, then press the key or mouse button you want. Esc cancels.'
      : 'Inputs that drive your crosshair animations. Press and hold an action name to preview it.';
  }

  function saveTriggers() {
    triggers = Crosshair.sanitizeTriggers(triggers);
    api.setTriggers(triggers);
  }

  function captureTrigger(id, i, chip) {
    chip.textContent = 'Press…';
    chip.classList.add('capturing');
    let armed = false;
    let finished = false;
    const done = (name) => {
      finished = true;
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onMouse, true);
      document.removeEventListener('contextmenu', onCtx, true);
      if (name) { triggers[id][i] = name; saveTriggers(); }
      renderTriggers();
    };
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { done(null); return; }
      if (e.repeat) return;
      done(Crosshair.domKeyName(e));
    };
    const onMouse = (e) => {
      if (!armed) return;
      e.preventDefault();
      e.stopPropagation();
      done(Crosshair.domMouseName(e.button));
    };
    const onCtx = (e) => e.preventDefault();
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('contextmenu', onCtx, true);
    setTimeout(() => { if (finished) return; armed = true; document.addEventListener('mousedown', onMouse, true); }, 0);
  }

  // ---------------------------------------------------------------- presets, backgrounds, backup, nudge
  function renderPresets() {
    const host = $('#presetGrid');
    host.textContent = '';
    presetList().forEach((p) => {
      const d = Crosshair.sanitizeDesign({ layers: p.layers, dynamic: p.dynamic, rules: p.rules });
      const b = mk('button', { type: 'button', className: 'preset', title: 'Use ' + p.name });
      const c = mk('canvas', { width: 112, height: 112 });
      drawThumb(c, d);
      b.appendChild(c);
      b.appendChild(mk('span', { textContent: p.name }));
      b.addEventListener('click', () => { applyNewConfig(d); setCurName(p.name); toast('Loaded preset “' + p.name + '”'); });
      host.appendChild(b);
    });
  }

  // ---- 1:1 in-game preview: real size (times the overlay scale) over game-like backgrounds or your screenshot.
  const BG_KEY = 'mishez.previewBg';
  const BGI_KEY = 'ezr.previewBgIndex';
  const BGS = [['cs2', 'CS2'], ['deadlock', 'Deadlock'], ['grass', 'Grass'], ['sky', 'Sky'], ['dark', 'Dark'], ['light', 'Light']];
  let realCtl = null;
  let photoBg = '';
  let bgIndex = 0;
  function realInput(e) { if (realCtl) realCtl.input(e); }

  function bgList() { return photoBg ? BGS.concat([['photo', 'Your screenshot']]) : BGS; }

  function showBg() {
    const list = bgList();
    bgIndex = ((bgIndex % list.length) + list.length) % list.length;
    const b = list[bgIndex];
    const w = $('#previewWrap');
    w.className = 'dz-scene bg-' + (b[0] === 'photo' ? 'image' : b[0]);
    w.style.backgroundImage = b[0] === 'photo' ? 'url("' + photoBg + '")' : '';
    $('#bgName').textContent = b[1];
    try { localStorage.setItem(BGI_KEY, b[0]); } catch (e) { /* ignore */ }
  }

  function setPreviewBg(url) {
    photoBg = url;
    bgIndex = bgList().length - 1;
    showBg();
  }

  function updateReal() {
    if (!realCtl) return;
    realCtl.setZoom(state && state.overlayScale ? state.overlayScale : 1);
  }

  function initPreviewBg() {
    try {
      const saved = localStorage.getItem(BG_KEY);
      if (saved && /^data:image\//.test(saved)) photoBg = saved;
      const id = localStorage.getItem(BGI_KEY);
      const j = bgList().findIndex((b) => b[0] === id);
      if (j >= 0) bgIndex = j;
    } catch (e) { /* storage unavailable */ }
    showBg();
    $('#bgPrev').addEventListener('click', () => { bgIndex -= 1; showBg(); });
    $('#bgNext').addEventListener('click', () => { bgIndex += 1; showBg(); });
    $('#realToggle').addEventListener('click', () => {
      const r = $('#realPrev');
      r.classList.toggle('min');
      try { localStorage.setItem('ezr.realMin', r.classList.contains('min') ? '1' : ''); } catch (e) { /* ignore */ }
    });
    try { if (localStorage.getItem('ezr.realMin')) $('#realPrev').classList.add('min'); } catch (e) { /* ignore */ }
    const rc = $('#realCanvas');
    const tr = (down) => (e) => { if (e.button !== 0 && e.button !== 2) return; const a = e.button === 2 ? 'aim' : 'shoot'; realInput({ type: 'trigger', action: a, down: down }); preview.input({ type: 'trigger', action: a, down: down }); };
    rc.addEventListener('pointerdown', tr(true));
    rc.addEventListener('pointerup', tr(false));
    rc.addEventListener('contextmenu', (e) => e.preventDefault());
    $('#bgImgBtn').addEventListener('click', () => $('#bgFile').click());
    $('#bgFile').addEventListener('change', () => {
      const f = $('#bgFile').files && $('#bgFile').files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        const img = new Image();
        img.onload = () => {
          const k = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.naturalWidth * k));
          c.height = Math.max(1, Math.round(img.naturalHeight * k));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const url = c.toDataURL('image/jpeg', 0.82);
          setPreviewBg(url);
          try { localStorage.setItem(BG_KEY, url); } catch (e) { /* too big or blocked */ }
        };
        img.onerror = () => toast('Could not read that image');
        img.src = rd.result;
      };
      rd.readAsDataURL(f);
      $('#bgFile').value = '';
    });
  }

  // ---- stage size: the canvas is a square that covers the whole stage, centered.
  function resizeStage() {
    const st = $('#stage');
    const w = st.clientWidth, h = st.clientHeight;
    if (!w || !h) return;
    preview.setSize(Math.max(w, h));
    updateZoom();
    const gz = parseFloat(st.style.getPropertyValue('--gz')) || 10;
    st.style.setProperty('--gx', ((w / 2) % (gz * 5)) + 'px');
    st.style.setProperty('--gy', ((h / 2) % (gz * 5)) + 'px');
  }

  // ---- top bar: name, saved state, hotkey, share, save, apply
  let savedTimer = 0;
  function markDirty() {
    clearTimeout(savedTimer);
    savedTimer = setTimeout(updateSavedState, 400);
  }

  function updateSavedState() {
    const el = $('#savedState');
    if (!el || !state) return;
    const has = curName && state.profiles && Object.prototype.hasOwnProperty.call(state.profiles, curName);
    let txt = 'Not saved', cls = 'new';
    if (has) {
      const same = JSON.stringify(Crosshair.sanitizeDesign(state.profiles[curName])) === JSON.stringify(Crosshair.sanitizeDesign(canon()));
      txt = same ? 'Saved' : 'Unsaved changes';
      cls = same ? 'ok' : 'dirty';
    }
    el.className = 'dz-saved ' + cls;
    $('b', el).textContent = txt;
    updateHotkeyChip();
  }

  function updateHotkeyChip() {
    const v = $('#hotkeyChipVal');
    if (!v || !state) return;
    const hk = (state.profileHotkeys || {})[curName];
    v.textContent = hk || 'Unbound';
    $('#hotkeyChip').classList.toggle('bound', !!hk);
  }

  async function saveCurrent() {
    const name = $('#profileName').value.trim();
    if (!name) { toast('Name your crosshair first'); $('#profileName').focus(); return; }
    const r = await api.saveProfile(name, canon());
    if (r.ok) {
      if (state.profiles) state.profiles[name] = Crosshair.sanitizeDesign(canon());
      setCurName(name);
      toast('Saved “' + name + '”');
    } else toast('That name is not allowed');
  }

  function captureProfileHotkey() {
    const chip = $('#hotkeyChip');
    if (!curName || !state.profiles || !Object.prototype.hasOwnProperty.call(state.profiles, curName)) {
      toast('Save this crosshair first, then give it a hotkey');
      return;
    }
    if (chip.classList.contains('capturing')) return;
    chip.classList.add('capturing');
    $('#hotkeyChipVal').textContent = 'Press keys…';
    api.pauseHotkey(true);
    const stop = () => { document.removeEventListener('keydown', onKey, true); chip.classList.remove('capturing'); };
    function onKey(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { stop(); api.pauseHotkey(false); updateHotkeyChip(); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        stop();
        api.setProfileHotkey(curName, null).then(() => { api.pauseHotkey(false); toast('Hotkey removed'); });
        return;
      }
      const acc = toAccelerator(e);
      if (!acc) return;
      stop();
      api.setProfileHotkey(curName, acc).then((r) => {
        if (r && r.ok) { state.profileHotkeys = r.profileHotkeys; toast(acc + ' now equips “' + curName + '”'); }
        else toast((r && r.error) || 'Could not use that shortcut');
        updateHotkeyChip();
      });
    }
    document.addEventListener('keydown', onKey, true);
  }

  function initTopBar() {
    const nameIn = $('#profileName');
    nameIn.addEventListener('change', () => { curName = nameIn.value.trim().slice(0, 40); renderHome(); updateSavedState(); });
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameIn.blur(); e.stopPropagation(); });
    $('#saveProfileBtn').addEventListener('click', saveCurrent);
    $('#applyBtn').addEventListener('click', async () => {
      await api.setCrosshair(canon());
      if (!state.overlayVisible) await api.setOverlay(true);
      toast('Applied – it’s on your screen (' + state.hotkey + ' hides it)');
    });
    $('#newBtn').addEventListener('click', () => {
      applyNewConfig(Crosshair.DEFAULT_DESIGN);
      setCurName('');
      fitMode = true;
      updateZoom();
      toast('New crosshair');
    });
    const pop = (btn, menu) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); const open = menu.hidden; closePops(); menu.hidden = !open; });
    };
    pop($('#savedBtn'), $('#savedMenu'));
    pop($('#shareBtn'), $('#shareMenu'));
    document.querySelectorAll('#shareMenu button').forEach((b) => b.addEventListener('click', async () => {
      closePops();
      if (b.dataset.share === 'xh') { await api.clipboardWrite(encodeCfg(canon())); toast('Share code copied – paste it into Import on the Home tab'); }
      else exportCrosshair(b.dataset.share);
    }));
    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.dz-pop, #savedBtn, #shareBtn')) closePops();
      if (!e.target.closest('#ctxMenu')) $('#ctxMenu').hidden = true;
    });
    $('#hotkeyChip').addEventListener('click', captureProfileHotkey);
    $('#hotkeyChip').addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (curName && (state.profileHotkeys || {})[curName]) api.setProfileHotkey(curName, null).then(() => toast('Hotkey removed'));
    });
  }

  function closePops() {
    document.querySelectorAll('.dz-pop').forEach((m) => { m.hidden = true; });
  }

  // ---- canvas toolbar + animation strip
  function initCanvasTools() {
    const st = $('#stage');
    const store = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch (e) { /* ignore */ } };
    const read = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch (e) { return d; } };
    const setGrid = (on) => { st.classList.toggle('grid', on); $('#gridBtn').classList.toggle('on', on); store('ezr.grid', on); };
    const setSnap = (on) => { snapOn = on; $('#snapBtn').classList.toggle('on', on); store('ezr.snap', on); };
    setGrid(read('ezr.grid', true));
    setSnap(read('ezr.snap', true));
    $('#gridBtn').addEventListener('click', () => setGrid(!st.classList.contains('grid')));
    $('#snapBtn').addEventListener('click', () => setSnap(!snapOn));
    $('#zoomIn').addEventListener('click', () => setZoom(viewZoom * 1.25));
    $('#zoomOut').addEventListener('click', () => setZoom(viewZoom / 1.25));
    $('#zoomFit').addEventListener('click', () => { fitMode = true; updateZoom(); });
    $('#zoomLabel').addEventListener('dblclick', () => setZoom(1));
    $('#zoomLabel').title = 'Double-click for 100%';

    const dock = $('#animDock');
    const setTab = (t) => {
      dock.dataset.tab = t;
      dock.querySelectorAll('.dz-atab').forEach((b) => b.classList.toggle('on', b.dataset.atab === t));
      dock.querySelectorAll('.dz-apane').forEach((p) => { p.hidden = p.dataset.apane !== t; });
      try { localStorage.setItem('ezr.animTab', t); } catch (e) { /* ignore */ }
    };
    const setOpen = (on) => {
      dock.classList.toggle('open', on);
      try { localStorage.setItem('ezr.animOpen', on ? '1' : ''); } catch (e) { /* ignore */ }
    };
    let t0 = 'anims';
    try { t0 = localStorage.getItem('ezr.animTab') || 'anims'; if (localStorage.getItem('ezr.animOpen')) dock.classList.add('open'); } catch (e) { /* ignore */ }
    setTab(t0);
    dock.querySelectorAll('.dz-atab').forEach((b) => b.addEventListener('click', () => { setTab(b.dataset.atab); setOpen(true); }));
    $('#animOpenBtn').addEventListener('click', () => {
      setTab('anims');
      setOpen(true);
      if (!Crosshair.animsOf(cur()).length) addAnim();
    });
    $('#animCollapse').addEventListener('click', () => setOpen(!dock.classList.contains('open')));

    if (window.ResizeObserver) new ResizeObserver(() => resizeStage()).observe(st);
  }

  // ---- designer keyboard shortcuts
  function initDesignerKeys() {
    document.addEventListener('keydown', (e) => {
      if (!$('#tab-crosshair').classList.contains('active') || !$('#shapeModal').hidden) return;
      const t = e.target;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && t.type !== 'checkbox' && t.type !== 'range' && t.type !== 'button'))) return;
      const k = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && k === 's') { e.preventDefault(); saveCurrent(); return; }
      if (ctrl && k === 'd') { e.preventDefault(); dupLayer(); return; }
      if (ctrl && k === 'a') { e.preventDefault(); multi.clear(); design.layers.forEach((_, i) => { if (i !== sel) multi.add(i); }); markRows(); applyToControls(); return; }
      if (ctrl && e.shiftKey && k === 'c') { e.preventDefault(); $('#copyStyleBtn').click(); return; }
      if (ctrl && e.shiftKey && k === 'v') { e.preventDefault(); $('#pasteStyleBtn').click(); return; }
      if (ctrl && e.key === ']') { e.preventDefault(); if (selected().length === 1) moveLayer(sel, 1); return; }
      if (ctrl && e.key === '[') { e.preventDefault(); if (selected().length === 1) moveLayer(sel, -1); return; }
      if (ctrl || e.altKey) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); delLayer(); }
      else if (e.key === 'F2') { e.preventDefault(); if (selected().length === 1) startRename(sel); }
      else if (k === 'g') $('#gridBtn').click();
      else if (k === 'f') { fitMode = true; updateZoom(); }
      else if (k === 'h') toggleLayer(sel);
      else if (e.key === '+' || e.key === '=') setZoom(viewZoom * 1.25);
      else if (e.key === '-') setZoom(viewZoom / 1.25);
      else if (e.key === 'Escape') { $('#ctxMenu').hidden = true; closePops(); if (multi.size) { multi.clear(); markRows(); applyToControls(); } }
    });
  }

  function initBackup() {
    $('#backupBtn').addEventListener('click', async () => {
      const r = await api.exportBackup();
      if (r && r.ok) toast('Backup saved');
      else if (r && r.error) toast(r.error);
    });
    $('#restoreBtn').addEventListener('click', async () => {
      const r = await api.importBackup();
      if (r && r.ok) { toast('Backup restored'); } else if (r && r.error) toast(r.error);
    });
  }

  // Arrow keys nudge the selected layer by 1px (Shift = 10px) for pixel-perfect placement.
  function initNudge() {
    document.addEventListener('keydown', (e) => {
      if (!$('#tab-crosshair').classList.contains('active') || !$('#shapeModal').hidden || drawMode) return;
      const t = e.target;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && t.type !== 'checkbox' && t.type !== 'button'))) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const d = e.shiftKey ? 10 : 1;
      const m = { ArrowLeft: ['offsetX', -d], ArrowRight: ['offsetX', d], ArrowUp: ['offsetY', -d], ArrowDown: ['offsetY', d] }[e.key];
      if (!m) return;
      e.preventDefault();
      const v = Math.max(-250, Math.min(250, cur()[m[0]] + m[1]));
      update(m[0], v);
      rows[m[0]].set(v);
    });
  }

  // ---------------------------------------------------------------- share codes
  const PREFIX = 'XH1:';
  function encodeCfg(c) { return PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify(c)))); }
  function decodeCfg(text) {
    const t = String(text || '').trim().replace(/\s+/g, '');
    if (!t.startsWith(PREFIX)) throw new Error('That is not a crosshair code');
    let obj;
    try { obj = JSON.parse(decodeURIComponent(escape(atob(t.slice(PREFIX.length))))); } catch (e) { throw new Error('That code is corrupted'); }
    return Crosshair.sanitizeDesign(obj);
  }

  function importFrom(text) {
    if (/^\s*CS/.test(String(text || '')) && !/^\s*XH1:/.test(String(text || ''))) return importCsCode(text);
    try {
      applyNewConfig(decodeCfg(text));
      toast('Crosshair imported');
      return true;
    } catch (e) {
      toast(e.message);
      return false;
    }
  }

  // ---------------------------------------------------------------- profiles
  function loadDefault() {
    closePops();
    applyNewConfig(Crosshair.DEFAULT_DESIGN);
    setCurName('Default');
    fitMode = true;
    updateZoom();
    toast('Back to the default crosshair');
  }

  // Starter presets with the built-in default first.
  function presetList() {
    return [{ name: 'Default', layers: Crosshair.DEFAULT_DESIGN.layers, dynamic: Crosshair.DEFAULT_DESIGN.dynamic, rules: Crosshair.DEFAULT_DESIGN.rules }].concat(window.PRESETS || []);
  }

  function renderProfiles() {
    const list = $('#profileList');
    list.textContent = '';
    const names = Object.keys(state.profiles).sort((a, b) => a.localeCompare(b));
    // The built-in default is always first, so you can get back to it in one click.
    const dRow = mk('div', { className: 'prow default' });
    const dc = mk('canvas', { width: 48, height: 48 });
    drawThumb(dc, Crosshair.sanitizeDesign(Crosshair.DEFAULT_DESIGN));
    dRow.appendChild(dc);
    dRow.appendChild(mk('span', { className: 'pn', textContent: 'Default crosshair', title: 'The crosshair EZ Reticle starts with' }));
    const dLoad = mk('button', { textContent: 'Load' });
    dLoad.addEventListener('click', () => loadDefault());
    dRow.appendChild(dLoad);
    list.appendChild(dRow);
    if (!names.length) {
      list.appendChild(mk('div', { className: 'muted small', textContent: 'No saved crosshairs yet.' }));
      return;
    }
    names.forEach((n) => {
      const p = Crosshair.sanitizeDesign(state.profiles[n]);
      const row = mk('div', { className: 'prow' });
      const c = mk('canvas', { width: 48, height: 48 });
      drawThumb(c, p);
      row.appendChild(c);
      row.appendChild(mk('span', { className: 'pn', textContent: n, title: n }));
      const load = mk('button', { textContent: 'Load' });
      load.addEventListener('click', async () => {
        const loaded = await api.loadProfile(n);
        if (loaded) { closePops(); applyNewConfig(loaded); setCurName(n); fitMode = true; updateZoom(); toast('Loaded \u201c' + n + '\u201d'); }
      });
      if (n === curName) row.classList.add('current');
      const hk = (state.profileHotkeys || {})[n];
      if (hk) row.appendChild(mk('kbd', { textContent: hk, title: 'Hotkey' }));
      const del = mk('button', { textContent: 'Delete', className: 'danger' });
      del.addEventListener('click', () => api.deleteProfile(n));
      row.appendChild(load);
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  // ---------------------------------------------------------------- home
  let homePrev = null;
  let lastActive = null;
  let curName = '';

  function setCurName(n) {
    curName = n || '';
    const el = $('#profileName');
    if (el && el.value !== curName) el.value = curName;
    renderHome();
    updateSavedState();
  }

  function renderHome() {
    if (!state || !$('#homeTitle')) return;
    const on = !!state.overlayVisible;
    $('#homeDot').classList.toggle('on', on);
    $('#homeState').textContent = on ? 'RUNNING' : 'READY';
    $('#homeTitle').textContent = on ? 'Overlay is running' : 'Ready to play';
    $('#homeToggle').textContent = on ? 'Stop overlay' : 'Start overlay';
    $('#homeToggle').classList.toggle('primary', !on);
    $('#homeSub').textContent = (curName || 'Your crosshair') + ' equipped \u00b7 ' +
      (state.displayMode === 'fullscreen' ? 'Fullscreen games mode' : 'Simple overlay mode') + ' \u00b7 ' + state.hotkey + ' toggles';
    $('#homeName').textContent = curName || 'Current crosshair';
  }

  function renderHomeGrid() {
    const host = $('#homeGrid');
    if (!host) return;
    host.textContent = '';
    const names = Object.keys(state.profiles || {}).sort((a, b) => a.localeCompare(b));
    if (!names.length) {
      host.appendChild(mk('div', { className: 'tile-empty', textContent: 'Nothing saved yet. Save a crosshair from the Designer and it shows up here.' }));
      return;
    }
    names.forEach((n) => {
      const d = Crosshair.sanitizeDesign(state.profiles[n]);
      const b = mk('button', { type: 'button', className: 'preset', title: 'Equip ' + n });
      const c = mk('canvas', { width: 112, height: 112 });
      drawThumb(c, d);
      b.appendChild(c);
      b.appendChild(mk('span', { textContent: n }));
      b.addEventListener('click', async () => {
        const loaded = await api.loadProfile(n);
        if (loaded) { applyNewConfig(loaded); setCurName(n); toast('Equipped \u201c' + n + '\u201d'); }
      });
      host.appendChild(b);
    });
  }

  // ---------------------------------------------------------------- settings
  const ACCENTS = [['#3ddc84', 'Green'], ['#fcc800', 'Logo yellow'], ['#00e5ff', 'Cyan'], ['#4d9fff', 'Blue'], ['#b57bff', 'Purple'], ['#ff2bd6', 'Pink'], ['#ff5c6c', 'Red'], ['#ff9f1a', 'Orange'], ['#ffffff', 'White']];

  // Sets the app's accent color (CSS variables) and picks readable text for filled buttons.
  function applyAccent(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) hex = '#fcc800';
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const root = document.documentElement.style;
    root.setProperty('--accent', hex);
    root.setProperty('--accent-rgb', r + ', ' + g + ', ' + b);
    root.setProperty('--on-accent', lum > 0.55 ? '#10130f' : '#ffffff');
    const sw = $('#accentSwatches');
    if (sw) {
      sw.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.c === hex.toLowerCase()));
      $('#accentPick').value = hex;
    }
  }

  function initAccent() {
    const sw = $('#accentSwatches');
    ACCENTS.forEach(([c, name]) => {
      const b = mk('button', { type: 'button', title: name });
      b.dataset.c = c;
      b.style.background = c;
      b.addEventListener('click', () => api.setSettings({ accentColor: c }));
      sw.appendChild(b);
    });
    $('#accentPick').addEventListener('input', (e) => { applyAccent(e.target.value); });
    $('#accentPick').addEventListener('change', (e) => api.setSettings({ accentColor: e.target.value }));
    $('#accentReset').addEventListener('click', () => api.setSettings({ accentColor: '#fcc800' }));
    applyAccent(state.accentColor);
  }

  function renderSettings() {
    applyAccent(state.accentColor);
    $('#overlayToggle').checked = state.overlayVisible;
    $('#hotkeyBtn').textContent = state.hotkey;
    $('#hotkeyNextBtn').textContent = state.hotkeyNext;
    $('#hotkeyPrevBtn').textContent = state.hotkeyPrev;
    $('#startHidden').checked = !!state.startHidden;
    $('#gameOnly').checked = !!state.gameOnly;
    $('#hideCapture').checked = !!state.hideFromCapture;
    const nGames = Object.keys(state.gameProfiles || {}).length;
    $('#gameOnlyNote').textContent = !state.gameOnly ? 'Tip: with all three on, EZ Reticle waits quietly in the tray and the crosshair pops up when your game is in front.'
      : (nGames ? (state.gameFront ? 'A game is in front: crosshair showing.' : 'Waiting for one of your games (' + Object.keys(state.gameProfiles).join(', ') + ').') : 'Add your game under Games below, or the crosshair stays hidden.');
    renderProfileHotkeys();
    renderUpdate();
    $('#lowPriority').checked = state.lowPriority !== false;
    $('#fpsSel').value = String(state.fpsCap === undefined ? 60 : state.fpsCap);
    if ($('#memSel')) {
      $('#memSel').value = state.memoryMode || 'low';
      const pending = (state.memoryMode || 'low') !== (state.memoryActive || 'low');
      $('#memRestart').hidden = !pending;
      $('#memNote').textContent = pending ? 'Restart the app to apply this.' :
        ({ balanced: 'Default Chromium settings.', low: 'Smaller caches and heaps. No visible difference.', lowest: 'Also draws in software and removes the GPU process (biggest saving). Fine for a small crosshair; switch back if anything looks off.' })[state.memoryMode || 'low'];
    }
    if (scaleCtl) { scaleCtl.set(state.overlayScale); opacityCtl.set(state.overlayOpacity); }
    if (offXCtl) { offXCtl.set(state.overlayOffsetX || 0); offYCtl.set(state.overlayOffsetY || 0); }
    $('#guideBtn').textContent = state.guide ? 'Hide alignment guide' : 'Show alignment guide (15 s)';
    renderGames();
    $('#autoStart').checked = state.autoStart;
    $('#autoStart').disabled = !state.isPackaged;
    $('#autoStartNote').textContent = state.isPackaged ? '' : 'Available in the installed build (npm run dist).';
    $('#hookWarn').hidden = state.hookState !== 'unavailable';
    const pill = $('#pill');
    pill.textContent = 'Overlay ' + (state.overlayVisible ? 'ON' : 'OFF') + ' \u00b7 ' + state.hotkey;
    pill.classList.toggle('on', state.overlayVisible);
    renderHome();
    const dsel = $('#displaySel');
    dsel.value = state.displayId === null ? '' : String(state.displayId);
    document.querySelectorAll('.mode-card').forEach((b) => b.classList.toggle('selected', b.dataset.mode === state.displayMode));
  }

  async function refreshDisplays() {
    const list = await api.listDisplays();
    const sel = $('#displaySel');
    sel.textContent = '';
    sel.appendChild(mk('option', { value: '', textContent: 'Primary display' }));
    list.forEach((d) => sel.appendChild(mk('option', { value: String(d.id), textContent: d.label })));
    if (state) sel.value = state.displayId === null ? '' : String(state.displayId);
  }

  function toAccelerator(e) {
    const k0 = e.key;
    if (k0 === 'Control' || k0 === 'Shift' || k0 === 'Alt' || k0 === 'Meta') return null;
    const mods = [];
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    const map = {
      ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
      Escape: 'Esc', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown'
    };
    let k = map[k0] || (k0.length === 1 ? k0.toUpperCase() : k0);
    return mods.concat(k).join('+');
  }

  // Click a button, press keys: Esc cancels, Backspace/Delete clears (done(null)).
  function captureKeys(btn, done) {
    if (btn.classList.contains('capturing')) return;
    btn.classList.add('capturing');
    btn.textContent = 'Press keys\u2026';
    api.pauseHotkey(true);
    const stop = () => { document.removeEventListener('keydown', onKey, true); btn.classList.remove('capturing'); };
    function onKey(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { stop(); api.pauseHotkey(false); renderSettings(); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') { stop(); done(null); return; }
      const acc = toAccelerator(e);
      if (!acc) return;
      stop();
      done(acc);
    }
    document.addEventListener('keydown', onKey, true);
  }

  function renderProfileHotkeys() {
    const host = $('#profHkList');
    if (!host) return;
    host.textContent = '';
    const names = Object.keys(state.profiles || {}).sort((a, b) => a.localeCompare(b));
    const map = state.profileHotkeys || {};
    if (!names.length) {
      host.appendChild(mk('p', { className: 'muted small', textContent: 'Save a crosshair in the Designer and it shows up here, ready for its own hotkey.' }));
      return;
    }
    names.forEach((n) => {
      const row = mk('div', { className: 'row' });
      row.appendChild(mk('span', { className: 'name', textContent: n }));
      const ctl = mk('span', { className: 'ctl' });
      const b = mk('button', { type: 'button', className: 'hk' + (map[n] ? '' : ' unbound'), textContent: map[n] || 'Set hotkey' });
      b.addEventListener('click', () => captureKeys(b, (acc) => {
        api.setProfileHotkey(n, acc).then((r) => {
          if (r && r.profileHotkeys) state.profileHotkeys = r.profileHotkeys;
          if (r && !r.ok) toast(r.error || 'Could not use that shortcut');
          else toast(acc ? acc + ' now equips \u201c' + n + '\u201d' : 'Hotkey removed');
          if (!acc || !r || !r.ok) api.pauseHotkey(false);
          renderSettings();
        });
      }));
      ctl.appendChild(b);
      if (map[n]) {
        const x = mk('button', { type: 'button', className: 'x', title: 'Remove hotkey', textContent: '\u00d7' });
        x.addEventListener('click', () => api.setProfileHotkey(n, null).then((r) => { if (r && r.profileHotkeys) state.profileHotkeys = r.profileHotkeys; renderSettings(); }));
        ctl.appendChild(x);
      }
      row.appendChild(ctl);
      host.appendChild(row);
    });
  }

  function renderUpdate() {
    const u = state.update;
    const line = $('#updateLine');
    if (line) {
      line.hidden = !u;
      line.classList.toggle('busy', !!u && u.phase === 'downloading');
      if (u) {
        line.textContent = u.phase === 'ready' ? 'Restart to update to v' + u.version + ' \u2713'
          : u.phase === 'downloading' ? 'Downloading v' + u.version + '\u2026 ' + (u.percent || 0) + '%'
          : u.phase === 'error' ? 'Update failed \u2013 open the download page'
          : u.canInstall ? 'v' + u.version + ' is out \u2013 click to update'
          : 'New version available: v' + u.version + ' \u2192';
      }
    }
    const ib = $('#updateInstallBtn');
    if (ib) {
      ib.hidden = !(u && u.canInstall && u.phase !== 'error');
      ib.textContent = u && u.phase === 'ready' ? 'Restart and update' : u && u.phase === 'downloading' ? 'Downloading\u2026 ' + (u.percent || 0) + '%' : 'Download and install';
      ib.disabled = !!u && u.phase === 'downloading';
    }
    if ($('#checkUpdates')) $('#checkUpdates').checked = state.checkUpdates !== false;
    if ($('#updateNote')) $('#updateNote').textContent = u ? 'Version ' + u.version + ' is out. You have ' + state.version + '.' : 'You have version ' + (state.version || '?') + '.';
  }

  // ---------------------------------------------------------------- first-run setup guide
  const WZ_GAMES = [['cs2', 'Counter-Strike 2'], ['deadlock', 'Deadlock'], ['valorant', 'VALORANT'], ['r5apex', 'Apex Legends'], ['fortniteclient-win64-shipping', 'Fortnite'], ['overwatch', 'Overwatch 2'], ['rustclient', 'Rust'], ['tarkov', 'Escape from Tarkov']];
  const WZ_PRESETS = 8;
  const wz = { step: 1, games: new Set(), mode: '', picked: -1 };

  function wzShow() {
    document.querySelectorAll('.wz-step').forEach((sec) => { sec.hidden = Number(sec.dataset.step) !== wz.step; });
    document.querySelectorAll('.wz-dots i').forEach((d, i) => d.classList.toggle('on', i < wz.step));
    $('#wzStepLbl').textContent = 'Step ' + wz.step + ' of 3';
    $('#wzBack').style.visibility = wz.step > 1 ? 'visible' : 'hidden';
    $('#wzNext').textContent = wz.step === 3 ? 'Done – show my crosshair' : 'Next';
    $('#wzHotkey').textContent = state.hotkey;
    $('#wzAutoRow').hidden = !state.isPackaged;
  }

  function openWelcome() {
    wz.step = 1;
    wz.games = new Set(Object.keys(state.gameProfiles || {}));
    wz.mode = state.displayMode || 'fullscreen';
    wz.picked = -1;
    renderWzGames();
    document.querySelectorAll('.wz-mode').forEach((b) => b.classList.toggle('selected', b.dataset.mode === wz.mode));
    $('#wzGameOnly').checked = true;
    $('#wzAuto').checked = true;
    $('#wzCapture').checked = !!state.hideFromCapture;
    wzShow();
    $('#welcome').hidden = false;
  }

  function closeWelcome() {
    $('#welcome').hidden = true;
    if (!state.onboarded) { state.onboarded = true; api.setSettings({ onboarded: true }); }
  }

  function renderWzGames() {
    const host = $('#wzGames');
    host.textContent = '';
    const known = WZ_GAMES.map((g) => g[0]);
    const all = WZ_GAMES.concat(Array.from(wz.games).filter((g) => known.indexOf(g) < 0).map((g) => [g, g]));
    all.forEach((g) => {
      const b = mk('button', { type: 'button', className: 'wz-chip' + (wz.games.has(g[0]) ? ' on' : ''), textContent: g[1] });
      b.addEventListener('click', () => { if (wz.games.has(g[0])) wz.games.delete(g[0]); else wz.games.add(g[0]); renderWzGames(); });
      host.appendChild(b);
    });
  }

  function addWzExe(v) {
    const exe = String(v || '').trim().toLowerCase().replace(/\.exe$/, '');
    if (!exe) return;
    wz.games.add(exe);
    renderWzGames();
  }

  function renderWzPresets() {
    const host = $('#wzPresets');
    host.textContent = '';
    presetList().slice(0, WZ_PRESETS).forEach((p, i) => {
      const d = Crosshair.sanitizeDesign({ layers: p.layers, dynamic: p.dynamic, rules: p.rules });
      const b = mk('button', { type: 'button', className: 'preset' + (wz.picked === i ? ' on' : '') });
      const c = mk('canvas', { width: 96, height: 96 });
      drawThumb(c, d);
      b.appendChild(c);
      b.appendChild(mk('span', { textContent: p.name }));
      b.addEventListener('click', () => {
        wz.picked = i;
        applyNewConfig(d);
        setCurName(p.name);
        renderWzPresets();
      });
      host.appendChild(b);
    });
  }

  async function finishWelcome() {
    const games = Object.assign({}, state.gameProfiles || {});
    wz.games.forEach((g) => { if (!games[g]) games[g] = '*'; });
    Object.keys(games).forEach((g) => { if (games[g] === '*' && !wz.games.has(g)) delete games[g]; });
    const gameOnly = $('#wzGameOnly').checked && wz.games.size > 0;
    await api.setGames({ gameProfiles: games, gameOnly: gameOnly });
    if (wz.mode && wz.mode !== state.displayMode) await api.setDisplayMode(wz.mode);
    await api.setSettings({ hideFromCapture: $('#wzCapture').checked, startHidden: state.isPackaged && $('#wzAuto').checked ? true : !!state.startHidden });
    if (state.isPackaged && $('#wzAuto').checked !== !!state.autoStart) await api.setAutoStart($('#wzAuto').checked);
    await api.setCrosshair(canon());
    if (!state.overlayVisible) await api.setOverlay(true);
    closeWelcome();
    toast(gameOnly ? 'All set – your crosshair appears when your game is in front (' + state.hotkey + ' hides it)' : 'All set – your crosshair is on (' + state.hotkey + ' hides it)');
  }

  function initWelcome() {
    $('#wzSkip').addEventListener('click', closeWelcome);
    $('#wzBack').addEventListener('click', () => { if (wz.step > 1) { wz.step -= 1; wzShow(); } });
    $('#wzNext').addEventListener('click', () => {
      if (wz.step === 1) {
        addWzExe($('#wzExe').value);
        $('#wzExe').value = '';
        wz.step = 2;
        renderWzPresets();
      } else if (wz.step === 2) {
        wz.step = 3;
      } else {
        finishWelcome();
        return;
      }
      wzShow();
    });
    document.querySelectorAll('.wz-mode').forEach((b) => b.addEventListener('click', () => {
      wz.mode = b.dataset.mode;
      document.querySelectorAll('.wz-mode').forEach((x) => x.classList.toggle('selected', x === b));
    }));
    $('#wzExe').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { addWzExe($('#wzExe').value); $('#wzExe').value = ''; } });
    $('#wzPick').addEventListener('click', async () => {
      const sel = $('#wzPickSel');
      const procs = await api.listProcs();
      sel.textContent = '';
      sel.appendChild(mk('option', { value: '', textContent: procs.length ? 'Choose a running app…' : 'None found' }));
      procs.forEach((n) => sel.appendChild(mk('option', { value: n, textContent: n })));
      sel.hidden = false;
    });
    $('#wzPickSel').addEventListener('change', (e) => { addWzExe(e.target.value); e.target.hidden = true; });
    const useCode = () => {
      const v = $('#wzCode').value;
      if (!v.trim()) return;
      if (importFrom(v)) { wz.picked = -1; renderWzPresets(); $('#wzCode').value = ''; }
    };
    $('#wzCodeBtn').addEventListener('click', useCode);
    $('#wzCode').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') useCode(); });
    $('#wzHotkey').addEventListener('click', () => captureKeys($('#wzHotkey'), (acc) => {
      if (!acc) { api.pauseHotkey(false); wzShow(); return; }
      api.setHotkey(acc, 'toggle').then((r) => {
        state.hotkey = r.hotkeys.toggle;
        if (!r.ok) toast('Could not use that shortcut (already taken?)');
        wzShow();
        renderSettings();
      });
    }));
  }

  function wireHotkeyCapture() {
    document.querySelectorAll('.hk').forEach((btn) => {
      const which = btn.dataset.which;
      let capturing = false;
      const stop = () => {
        capturing = false;
        document.removeEventListener('keydown', onKey, true);
      };
      function onKey(e) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') {
          stop();
          api.pauseHotkey(false);
          renderSettings();
          return;
        }
        const acc = toAccelerator(e);
        if (!acc) return;
        stop();
        api.setHotkey(acc, which).then((r) => {
          state.hotkey = r.hotkeys.toggle;
          state.hotkeyNext = r.hotkeys.next;
          state.hotkeyPrev = r.hotkeys.prev;
          renderSettings();
          toast(r.ok ? 'Hotkey set to ' + acc : 'Could not use that shortcut (already taken?)');
        });
      }
      btn.addEventListener('click', () => {
        if (capturing) return;
        capturing = true;
        btn.textContent = 'Press a key\u2026 (Esc to cancel)';
        api.pauseHotkey(true);
        document.addEventListener('keydown', onKey, true);
      });
    });
  }

  // A slider with a typed number box, used by the settings cards.
  function makeSetting(host, o) {
    const row = mk('div', { className: 'row' });
    row.appendChild(mk('span', { className: 'name', textContent: o.label }));
    const ctl = mk('span', { className: 'ctl' });
    const range = mk('input', { type: 'range', min: o.min, max: o.max, step: o.step });
    const num = mk('input', { type: 'number', className: 'num', min: o.min * o.k, max: o.max * o.k, step: o.step * o.k });
    ctl.appendChild(range);
    ctl.appendChild(num);
    ctl.appendChild(mk('span', { className: 'unit', textContent: o.unit }));
    row.appendChild(ctl);
    host.appendChild(row);
    const set = (v) => { range.value = v; num.value = Math.round(v * o.k); };
    range.addEventListener('input', () => { num.value = Math.round(Number(range.value) * o.k); o.onChange(Number(range.value)); });
    const fromNum = () => {
      let v = Number(num.value);
      if (num.value === '' || !Number.isFinite(v)) { set(Number(range.value)); return; }
      v = Math.min(o.max, Math.max(o.min, v / o.k));
      set(v);
      o.onChange(v);
    };
    num.addEventListener('change', fromNum);
    num.addEventListener('keydown', (e) => { if (e.key === 'Enter') fromNum(); e.stopPropagation(); });
    return { set: set };
  }

  let scaleCtl = null;
  let opacityCtl = null;
  let offXCtl = null;
  let offYCtl = null;

  function renderGames() {
    if (!$('#gameList')) return;
    $('#autoSwitch').checked = !!state.autoSwitch;
    $('#autoRevert').checked = state.autoRevert !== false;
    $('#followWindow').checked = !!state.followWindow;
    const games = state.gameProfiles || {};
    const profNames = Object.keys(state.profiles || {}).sort((a, b) => a.localeCompare(b));
    const list = $('#gameList');
    list.textContent = '';
    Object.keys(games).sort().forEach((exe) => {
      const row = mk('div', { className: 'grow' });
      row.appendChild(mk('b', { textContent: exe }));
      const sel = mk('select');
      const names = games[exe] === '*' || profNames.indexOf(games[exe]) >= 0 ? profNames : profNames.concat([games[exe]]);
      sel.appendChild(mk('option', { value: '*', textContent: 'Keep current crosshair' }));
      names.forEach((n) => sel.appendChild(mk('option', { value: n, textContent: n })));
      sel.value = games[exe];
      sel.addEventListener('change', () => api.setGames({ gameProfiles: Object.assign({}, games, { [exe]: sel.value }) }));
      row.appendChild(sel);
      const del = mk('button', { type: 'button', textContent: 'Remove' });
      del.addEventListener('click', () => {
        const next = Object.assign({}, games);
        delete next[exe];
        api.setGames({ gameProfiles: next });
      });
      row.appendChild(del);
      list.appendChild(row);
    });
    const gp = $('#gameProf');
    const keep = gp.value;
    gp.textContent = '';
    gp.appendChild(mk('option', { value: '*', textContent: 'Keep current crosshair' }));
    profNames.forEach((n) => gp.appendChild(mk('option', { value: n, textContent: n })));
    if (keep && (keep === '*' || profNames.indexOf(keep) >= 0)) gp.value = keep;
    $('#gameAdd').disabled = false;
    $('#gameNote').textContent = state.watcherOn ? 'Watching the active window.' : '';
  }

  function initGames() {
    const set = (p) => api.setGames(p);
    $('#autoSwitch').addEventListener('change', (e) => set({ autoSwitch: e.target.checked }));
    $('#autoRevert').addEventListener('change', (e) => set({ autoRevert: e.target.checked }));
    $('#followWindow').addEventListener('change', (e) => set({ followWindow: e.target.checked }));
    $('#gameAdd').addEventListener('click', () => {
      const exe = $('#gameExe').value.trim().toLowerCase().replace(/\.exe$/, '');
      const prof = $('#gameProf').value;
      if (!exe || !prof) { toast('Type the game\u2019s process name and pick a crosshair'); return; }
      set({ gameProfiles: Object.assign({}, state.gameProfiles || {}, { [exe]: prof }) });
      $('#gameExe').value = '';
    });
    $('#gameExe').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') $('#gameAdd').click(); });
    $('#gamePick').addEventListener('click', async () => {
      const sel = $('#gamePickSel');
      const procs = await api.listProcs();
      sel.textContent = '';
      sel.appendChild(mk('option', { value: '', textContent: procs.length ? 'Choose an app\u2026' : 'None found (Windows only)' }));
      procs.forEach((n) => sel.appendChild(mk('option', { value: n, textContent: n })));
      sel.hidden = false;
    });
    $('#gamePickSel').addEventListener('change', (e) => {
      if (e.target.value) $('#gameExe').value = e.target.value;
      e.target.hidden = true;
    });
  }

  function initAlignment() {
    const mkOff = (host, label, key) => makeSetting(host, {
      label: label, min: -100, max: 100, step: 1, k: 1, unit: 'px',
      onChange: (v) => api.setSettings({ [key]: Math.round(v) })
    });
    offXCtl = mkOff($('#offXHost'), 'Horizontal offset', 'overlayOffsetX');
    offYCtl = mkOff($('#offYHost'), 'Vertical offset', 'overlayOffsetY');
    offXCtl.set(state.overlayOffsetX || 0);
    offYCtl.set(state.overlayOffsetY || 0);
    $('#offReset').addEventListener('click', () => api.setSettings({ overlayOffsetX: 0, overlayOffsetY: 0 }));
    $('#guideBtn').addEventListener('click', () => api.setGuide(!state.guide));
  }

  async function pollAlign() {
    try {
      const d = await api.getDiag();
      if (!d) return;
      const off = (n) => (n === null || n === undefined ? '?' : (Math.abs(n) < 0.01 ? '0' : n.toFixed(1)));
      $('#alignDiag').textContent = 'Display ' + d.physical + ' px at ' + Math.round(d.scale * 100) + '% scaling' +
        (d.following ? ', following the game window' : '') + '. Centre error: ' + off(d.errorX) + ' px across, ' + off(d.errorY) + ' px down.';
    } catch (e) { /* ignore */ }
  }
  let perfTimer = 0;

  function initSettings() {
    scaleCtl = makeSetting($('#scaleHost'), { label: 'Overlay size', min: 0.5, max: 3, step: 0.05, k: 100, unit: '%', onChange: (v) => api.setSettings({ overlayScale: v }) });
    opacityCtl = makeSetting($('#opacityHost'), { label: 'Overlay opacity', min: 0.2, max: 1, step: 0.05, k: 100, unit: '%', onChange: (v) => api.setSettings({ overlayOpacity: v }) });
    scaleCtl.set(state.overlayScale || 1);
    opacityCtl.set(state.overlayOpacity || 1);
    initAlignment();
    initGames();
    initAccent();
    $('#startHidden').addEventListener('change', (e) => api.setSettings({ startHidden: e.target.checked }));
    $('#gameOnly').addEventListener('change', (e) => {
      api.setGames({ gameOnly: e.target.checked });
      if (e.target.checked && !Object.keys(state.gameProfiles || {}).length) toast('Now add your game under Games so the crosshair knows when to show');
    });
    $('#checkUpdates').addEventListener('change', (e) => api.setCheckUpdates(e.target.checked));
    $('#updateCheckBtn').addEventListener('click', async () => {
      $('#updateCheckBtn').disabled = true;
      const r = await api.checkUpdate();
      $('#updateCheckBtn').disabled = false;
      toast(!r || !r.ok ? 'Could not reach GitHub' : (r.update ? 'Version ' + r.update.version + ' is available' : 'You\u2019re on the latest version'));
    });
    $('#updateOpenBtn').addEventListener('click', () => api.openUpdate());
    const runUpdate = () => {
      const u = state.update;
      if (!u) return;
      if (u.phase === 'ready') api.installUpdate();
      else if (u.canInstall && u.phase !== 'error') { api.downloadUpdate(); toast('Downloading the update\u2026 keep playing, it installs when you restart'); }
      else api.openUpdate();
    };
    $('#updateLine').addEventListener('click', runUpdate);
    $('#updateInstallBtn').addEventListener('click', runUpdate);
    $('#hideCapture').addEventListener('change', (e) => api.setSettings({ hideFromCapture: e.target.checked }));
    $('#runSetupBtn').addEventListener('click', () => openWelcome());
    $('#lowPriority').addEventListener('change', (e) => api.setSettings({ lowPriority: e.target.checked }));
    $('#fpsSel').addEventListener('change', (e) => api.setSettings({ fpsCap: Number(e.target.value) }));
    $('#memSel').addEventListener('change', (e) => api.setSettings({ memoryMode: e.target.value }));
    $('#memRestart').addEventListener('click', () => api.relaunch());
    renderSettings();
  }

  // Live footprint readout, only polled while the Settings tab is showing.
  async function pollPerf() {
    if (!$('#tab-settings').classList.contains('active') || document.hidden) return;
    try {
      const p = await api.getPerf();
      $('#perfCpu').textContent = p.cpu.toFixed(1) + '%';
      $('#perfMem').textContent = Math.round(p.memMB) + ' MB';
      $('#perfWin').textContent = p.overlayVisible ? p.overlaySize + '\u00d7' + p.overlaySize + ' px' : 'hidden';
      $('#perfHook').textContent = p.hook === 'running' ? 'active' : p.hook === 'unavailable' ? 'unavailable' : 'idle';
      pollAlign();
    } catch (e) { /* ignore */ }
  }

  function startPerfPolling() {
    clearInterval(perfTimer);
    perfTimer = setInterval(pollPerf, 1500);
    pollPerf();
  }

  // ---------------------------------------------------------------- pro crosshairs
  const PRO_OPTS_KEY = 'mishez.proOpts';
  const PRO_EDITS_KEY = 'mishez.proEdits';
  const COLOR_NAMES = ['red', 'green', 'yellow', 'blue', 'cyan', 'custom'];
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  let proOpts = { height: 1080, scale: 1 };
  let proEdits = {}; // name -> full crosshair config the user saved over that pro
  let editingPro = null;
  const proThumbs = [];

  function loadProOpts() {
    try {
      const o = JSON.parse(localStorage.getItem(PRO_OPTS_KEY) || '{}');
      const h = Number(o.height);
      const s = Number(o.scale);
      if (Number.isFinite(h) && h >= 480 && h <= 4320) proOpts.height = Math.round(h);
      if (Number.isFinite(s) && s >= 0.5 && s <= 2) proOpts.scale = s;
    } catch (e) { /* storage unavailable: keep defaults */ }
  }

  function saveProOpts() {
    try { localStorage.setItem(PRO_OPTS_KEY, JSON.stringify(proOpts)); } catch (e) { /* ignore */ }
  }

  function loadProEdits() {
    proEdits = {};
    try {
      const raw = JSON.parse(localStorage.getItem(PRO_EDITS_KEY) || '{}');
      (window.PROS || []).forEach((p) => {
        if (raw && hasOwn(raw, p.name)) proEdits[p.name] = Crosshair.sanitizeDesign(raw[p.name]);
      });
    } catch (e) { /* storage unavailable or corrupt: no edits */ }
  }

  function saveProEdits() {
    try { localStorage.setItem(PRO_EDITS_KEY, JSON.stringify(proEdits)); } catch (e) { /* ignore */ }
  }

  function codeToConfig(code) {
    const d = ShareCode.decode(code);
    const c = ShareCode.toConfig(d, {
      screenHeight: proOpts.height,
      scale: proOpts.scale,
      dpr: window.devicePixelRatio || 1
    });
    return { d: d, cfg: Crosshair.sanitizeDesign(c) };
  }

  // The crosshair a pro card stands for: the user's saved edit, or the decoded original.
  function proConfig(p) {
    if (hasOwn(proEdits, p.name)) return Crosshair.sanitizeDesign(proEdits[p.name]);
    return codeToConfig(p.code).cfg;
  }

  // Keeps the user's own animation and offset settings when a shared crosshair is applied.
  function applyShared(c, label) {
    const d = Crosshair.sanitizeDesign(c);
    const old = design.layers[0];
    if (d.layers.length === 1) {
      Object.assign(d.layers[0], {
        offsetX: old.offsetX,
        offsetY: old.offsetY,
        animation: old.animation,
        animIntensity: old.animIntensity,
        animDuration: old.animDuration,
        animTrigger: old.animTrigger,
        animMode: old.animMode,
        animEase: old.animEase
      });
    }
    applyNewConfig(d);
    toast(label);
  }

  function proSummary(d) {
    const col = d.colorMode >= 0 && d.colorMode <= 5 ? COLOR_NAMES[d.colorMode] : 'custom';
    return 'Size ' + d.length + ' · Gap ' + d.gap + ' · Thick ' + d.thickness + ' · ' + col + (d.dot ? ' · dot' : '');
  }

  function renderProThumbs() {
    proThumbs.forEach((t) => {
      try { drawThumb(t.canvas, proConfig(t.pro)); } catch (e) { /* skip */ }
    });
  }

  // ---- edit mode
  function showTab(name) {
    const btn = document.querySelector('.tab-btn[data-tab="' + name + '"]');
    if (btn) btn.click();
  }

  function updateEditBar() {
    const bar = $('#editBar');
    bar.hidden = !editingPro;
    if (!editingPro) return;
    $('#editBarText').textContent = 'Editing ' + editingPro + '’s crosshair. Changes show on your overlay live; save them to this pro when you’re done.';
    $('#editSaveBtn').textContent = 'Save to ' + editingPro;
  }

  function startEdit(p) {
    let base;
    try { base = proConfig(p); } catch (e) { toast('Could not load that crosshair'); return; }
    editingPro = p.name;
    applyNewConfig(base);
    setCurName(p.name);
    updateEditBar();
    showTab('crosshair');
  }

  function finishEdit() {
    if (!editingPro) return;
    const name = editingPro;
    proEdits[name] = Crosshair.sanitizeDesign(canon());
    saveProEdits();
    editingPro = null;
    updateEditBar();
    renderPros();
    showTab('pros');
    toast('Saved your version of ' + name);
  }

  function cancelEdit() {
    editingPro = null;
    updateEditBar();
  }

  function resetPro(p) {
    delete proEdits[p.name];
    saveProEdits();
    renderPros();
    toast('Restored ' + p.name + '’s original crosshair');
  }

  function renderPros() {
    const grid = $('#proGrid');
    const q = $('#proSearch').value.trim().toLowerCase();
    grid.textContent = '';
    proThumbs.length = 0;
    const list = (window.PROS || []).filter((p) => !q || p.name.toLowerCase().indexOf(q) >= 0);
    $('#proCount').textContent = list.length + ' crosshair' + (list.length === 1 ? '' : 's');
    if (!list.length) {
      grid.appendChild(mk('div', { className: 'muted', textContent: 'No players match that search.' }));
      return;
    }
    list.forEach((p) => {
      let decoded;
      try { decoded = codeToConfig(p.code); } catch (e) { return; }
      const edited = hasOwn(proEdits, p.name);
      const card = mk('div', { className: 'pro-card' });
      const canvas = mk('canvas', { width: 72, height: 72 });
      drawThumb(canvas, edited ? proEdits[p.name] : decoded.cfg);
      proThumbs.push({ canvas: canvas, pro: p });
      const info = mk('div', { className: 'pi' });
      const nameEl = mk('div', { className: 'pname', title: p.name });
      nameEl.appendChild(document.createTextNode(p.name));
      if (edited) nameEl.appendChild(mk('span', { className: 'badge', textContent: 'edited', title: 'You saved your own version of this crosshair' }));
      info.appendChild(nameEl);
      info.appendChild(mk('div', {
        className: 'pmeta',
        textContent: edited ? 'Your version · original: ' + proSummary(decoded.d) : proSummary(decoded.d)
      }));
      const btns = mk('div', { className: 'pbtns' });
      const use = mk('button', { textContent: 'Use', className: 'primary' });
      use.addEventListener('click', () => {
        try { applyShared(proConfig(p), 'Applied ' + p.name + '’s crosshair'); } catch (e) { toast('Could not load that crosshair'); }
      });
      const edit = mk('button', { textContent: 'Edit', title: 'Open in the editor and save your own version' });
      edit.addEventListener('click', () => startEdit(p));
      const save = mk('button', { textContent: 'Save', title: 'Add to your saved crosshairs list' });
      save.addEventListener('click', async () => {
        try {
          const r = await api.saveProfile(p.name, proConfig(p));
          toast(r.ok ? 'Saved “' + p.name + '” to your list' : 'Could not save');
        } catch (e) { toast('Could not save'); }
      });
      btns.appendChild(use);
      btns.appendChild(edit);
      btns.appendChild(save);
      if (edited) {
        const reset = mk('button', { textContent: 'Reset', className: 'danger', title: 'Go back to the original crosshair' });
        reset.addEventListener('click', () => resetPro(p));
        btns.appendChild(reset);
      }
      info.appendChild(btns);
      card.appendChild(canvas);
      card.appendChild(info);
      grid.appendChild(card);
    });
  }

  function importCsCode(text) {
    try {
      const r = codeToConfig(text);
      applyShared(r.cfg, 'Crosshair imported');
      return true;
    } catch (e) {
      toast(e.message);
      return false;
    }
  }

  function exportFields() {
    const L = design.layers;
    if (L.length !== 1 || L[0].kind !== 'shape' || L[0].style !== 'cross') {
      throw new Error('Export needs a single plain cross layer (remove other layers and set the shape to Cross)');
    }
    return ShareCode.fromConfig(L[0], { screenHeight: proOpts.height, scale: proOpts.scale, dpr: window.devicePixelRatio || 1 });
  }

  async function exportCrosshair(kind) {
    try {
      const f = exportFields();
      const text = kind === 'code' ? ShareCode.encode(f) : ShareCode.toConsole(f);
      await api.clipboardWrite(text);
      toast(kind === 'code' ? 'CS2 code copied' : 'Console commands copied');
    } catch (e) {
      toast(e.message);
    }
  }

  function initPros() {
    $('#csExportCode').addEventListener('click', () => exportCrosshair('code'));
    $('#csExportCmd').addEventListener('click', () => exportCrosshair('cmd'));
    loadProOpts();
    loadProEdits();
    $('#proHeight').value = proOpts.height;
    $('#proScale').value = proOpts.scale;
    $('#proScaleOut').textContent = proOpts.scale.toFixed(2) + '×';
    $('#proSearch').addEventListener('input', renderPros);
    $('#proHeight').addEventListener('change', (e) => {
      const h = Math.round(Number(e.target.value));
      if (Number.isFinite(h) && h >= 480 && h <= 4320) { proOpts.height = h; saveProOpts(); renderProThumbs(); }
      else e.target.value = proOpts.height;
    });
    $('#proScale').addEventListener('input', (e) => {
      proOpts.scale = Number(e.target.value);
      $('#proScaleOut').textContent = proOpts.scale.toFixed(2) + '×';
      saveProOpts();
      renderProThumbs();
    });
    $('#csImportBtn').addEventListener('click', () => {
      if (importCsCode($('#csCode').value)) $('#csCode').value = '';
    });
    $('#csCode').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#csImportBtn').click();
    });
    $('#editSaveBtn').addEventListener('click', finishEdit);
    $('#editCancelBtn').addEventListener('click', cancelEdit);
    renderPros();
  }

  // ---------------------------------------------------------------- init
  async function init() {
    state = await api.getConfig();
    design = viewOf(Crosshair.sanitizeDesign(state.crosshair), 'base');
    sel = 0;

    preview = Crosshair.createController($('#previewCanvas'), { size: 600, zoom: 2 });
    realCtl = Crosshair.createController($('#realCanvas'), { size: 240, zoom: 1 });
    const baseSet = preview.setConfig;
    preview.setConfig = (c) => { baseSet(c); realCtl.setConfig(c); refreshSel(); };
    updateReal();
    initCanvasTools();
    initTopBar();
    initDesignerKeys();
    homePrev = Crosshair.createController($('#homePreview'), { size: 200, zoom: 3 });
    homePrev.setConfig(canon());
    buildControls();
    initDynamics();
    initStates();
    renderLayers();
    applyToControls();
    preview.setConfig(design);
    updateZoom();
    commitNow();
    triggers = Crosshair.sanitizeTriggers(state.triggers);
    renderTriggers();
    wirePreviewPointer();
    Crosshair.onAssetLoad(() => { boundsCache.clear(); refreshSel(); renderLayersSoon(); });
    requestAnimationFrame(resizeStage);
    $('#addLayerBtn').addEventListener('click', (e) => { e.stopPropagation(); $('#addMenu').hidden = !$('#addMenu').hidden; });
    document.querySelectorAll('#addMenu button').forEach((b) => b.addEventListener('click', () => addOfKind(b.dataset.kind)));
    document.addEventListener('click', (e) => { if (!e.target.closest('.add-wrap')) $('#addMenu').hidden = true; });
    $('#trigCustomize').addEventListener('click', () => { customizing = !customizing; renderTriggers(); });
    $('#trigReset').addEventListener('click', () => { triggers = Crosshair.sanitizeTriggers(null); saveTriggers(); renderTriggers(); toast('Triggers reset'); });
    $('#undoBtn').addEventListener('click', undo);
    $('#redoBtn').addEventListener('click', redo);
    document.addEventListener('keydown', (ev) => {
      const t = ev.target;
      if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type === 'text'))) return;
      if (!(ev.ctrlKey || ev.metaKey)) return;
      const k = ev.key.toLowerCase();
      if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); undo(); }
      else if (k === 'y' || (k === 'z' && ev.shiftKey)) { ev.preventDefault(); redo(); }
    });
    document.querySelectorAll('.mode-card').forEach((b) => b.addEventListener('click', () => {
      state.displayMode = b.dataset.mode;
      renderSettings();
      api.setDisplayMode(b.dataset.mode);
      toast(b.dataset.mode === 'fullscreen' ? 'Fullscreen games mode on' : 'Windowed / borderless mode on');
    }));


    initPreviewBg();
    renderPresets();
    initBackup();
    initNudge();

    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((x) => x.classList.toggle('active', x === b));
        document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
        if (b.dataset.tab === 'settings') refreshDisplays();
        if (b.dataset.tab === 'crosshair') requestAnimationFrame(resizeStage);
      });
    });

    $('#exportBtn').addEventListener('click', async () => {
      await api.clipboardWrite(encodeCfg(canon()));
      toast('Crosshair code copied to clipboard');
    });
    $('#importBtn').addEventListener('click', () => {
      if (importFrom($('#importIn').value)) $('#importIn').value = '';
    });
    $('#imgImportBtn').addEventListener('click', () => pickImage((img) => {
      applyNewConfig({ layers: [{ name: img.name, kind: 'image', src: img.src, imgAspect: Math.min(20, Math.max(0.05, img.aspect)), imgSize: 32, animation: 'none' }] });
      setCurName(img.name);
      toast('Imported “' + img.name + '” - adjust its size in the Designer');
      document.querySelector('[data-tab=crosshair]').click();
    }));
    $('#pasteBtn').addEventListener('click', async () => {
      const text = await api.clipboardRead();
      $('#importIn').value = text;
      importFrom(text);
    });

    $('#overlayToggle').addEventListener('change', (e) => api.setOverlay(e.target.checked));
    $('#pill').addEventListener('click', () => api.setOverlay(!state.overlayVisible));
    $('#homeToggle').addEventListener('click', () => api.setOverlay(!state.overlayVisible));
    $('#homeEdit').addEventListener('click', () => showTab('crosshair'));
    $('#displaySel').addEventListener('change', (e) => api.setDisplay(e.target.value === '' ? null : Number(e.target.value)));
    $('#autoStart').addEventListener('change', (e) => api.setAutoStart(e.target.checked));
    $('#resetBtn').addEventListener('click', () => loadDefault());
    wireHotkeyCapture();
    $('#shapeClose').addEventListener('click', closeShapePicker);
    $('#shapeModal').addEventListener('mousedown', (ev) => { if (ev.target === $('#shapeModal')) closeShapePicker(); });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('#shapeModal').hidden) closeShapePicker(); });

    if (state.activeProfile) { lastActive = state.activeProfile; setCurName(state.activeProfile); }
    renderProfiles();
    renderSettings();
    renderHomeGrid();
    refreshDisplays();
    updateSavedState();
    initWelcome();
    // Existing users (already have saved crosshairs) skip the guide; it's in Settings > Reset if wanted.
    if (!state.onboarded && Object.keys(state.profiles || {}).length) api.setSettings({ onboarded: true });
    else if (!state.onboarded) openWelcome();

    api.onState((s) => {
      state = s;
      if (!customizing && s.triggers) { triggers = Crosshair.sanitizeTriggers(s.triggers); renderTriggers(); }
      if (s.activeProfile && s.activeProfile !== lastActive) { lastActive = s.activeProfile; setCurName(s.activeProfile); }
      renderProfiles();
      renderSettings();
      renderHomeGrid();
      updateReal();
      updateSavedState();
    });
    api.onInput((e) => { preview.input(e); realInput(e); if (homePrev) homePrev.input(e); });

    initPros();
    initSettings();
    startPerfPolling();
    api.onCrosshair((c) => applyNewConfig(c));
  }

  init();
})();
