/*
 * Shared crosshair logic: config validation, drawing and animation.
 * Loaded by the main process (require) and by the renderers (<script>).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Crosshair = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Shape library, grouped for the picker. Ids are what is stored in a crosshair config.
  const SHAPE_GROUPS = [
    { title: 'Crosshairs', items: [
      ['cross', 'Crosshair'], ['crosshair2', 'Crosshair 2'], ['twolines', 'Two Lines'], ['threelines', 'Three Lines'],
      ['plus', 'Cross'], ['tshape', 'T-Shape'], ['trident', 'Trident'], ['cornerframe', 'Corner Frame'],
      ['bracketplus', 'Bracket Plus'], ['trirects', 'Tri Rects'], ['triellipses', 'Tri Ellipses'],
      ['doublechevron', 'Double Chevron'], ['x', 'X']
    ] },
    { title: 'Shapes', items: [
      ['circle', 'Ring'], ['square', 'Square Frame'], ['dot', 'Dot'], ['ellipse', 'Ellipse'], ['rectangle', 'Rectangle'],
      ['triangle', 'Triangle'], ['diamond', 'Diamond'], ['trapezoid', 'Trapezoid'], ['hexagon', 'Polygon'],
      ['crescent', 'Crescent'], ['arc', 'Arc'], ['chevron', 'Chevron'], ['bracket', 'Bracket'], ['arrow', 'Arrow'],
      ['dart', 'Dart'], ['house', 'House'], ['star', 'Star'], ['heart', 'Heart']
    ] },
    { title: 'Radial', items: [
      ['segmentedring', 'Segmented Ring'], ['radiallines', 'Radial Lines'], ['dotring', 'Dot Ring'], ['tickring', 'Tick Ring'],
      ['spikering', 'Spike Ring'], ['wedgering', 'Wedge Ring'], ['duplexposts', 'Duplex Posts'], ['housering', 'House Ring'],
      ['tring', 'T-Ring'], ['chevronring', 'Chevron Ring']
    ] },
    { title: 'Other', items: [
      ['chargebar', 'Charge Bar'], ['arcgauge', 'Arc Gauge'], ['piprow', 'Pip Row'], ['pipring', 'Pip Ring'],
      ['spreadsector', 'Spread Sector']
    ] }
  ];
  const STYLES = [];
  const STYLE_LABELS = {};
  SHAPE_GROUPS.forEach(function (gr) {
    gr.items.forEach(function (it) { STYLES.push(it[0]); STYLE_LABELS[it[0]] = it[1]; });
  });
  const ANIMS = ['none', 'expand', 'shrink', 'pulse', 'flash', 'spin', 'fade', 'hide', 'show'];
  const ANIM_LABELS = {
    none: 'None', expand: 'Expand', shrink: 'Shrink', pulse: 'Pulse (scale)', flash: 'Flash (invert color)',
    spin: 'Spin', fade: 'Fade out', hide: 'Hide', show: 'Show only'
  };
  const KINDS = ['shape', 'image', 'text', 'draw'];
  const FONTS = {
    sans: '"Segoe UI", Arial, sans-serif',
    mono: 'Consolas, "Courier New", monospace',
    impact: 'Impact, "Arial Black", sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    round: '"Trebuchet MS", Verdana, sans-serif'
  };
  const FONT_LABELS = { sans: 'Sans', mono: 'Monospace', impact: 'Impact', serif: 'Serif', round: 'Rounded' };

  // ---------- animation triggers: inputs that drive layer animations
  const TRIGGER_IDS = ['shoot', 'aim', 'reload', 'jump', 'move', 'run'];
  const TRIGGER_LABELS = { shoot: 'Shoot', aim: 'Aim', reload: 'Reload', jump: 'Jump', move: 'Move', run: 'Run' };
  const TRIGGER_DEFAULTS = {
    shoot: ['Mouse1'], aim: ['Mouse2'], reload: ['R'], jump: ['Space'], move: ['W', 'A', 'S', 'D'], run: ['Shift']
  };
  const EASES = [
    'linear', 'in-sine', 'out-sine', 'in-out-sine', 'in-quad', 'out-quad', 'in-out-quad',
    'in-cubic', 'out-cubic', 'in-out-cubic', 'in-quart', 'out-quart', 'in-expo', 'out-expo',
    'in-out-expo', 'out-back', 'in-out-back', 'out-elastic', 'out-bounce'
  ];
  const EASE_LABELS = {
    'linear': 'Linear', 'in-sine': 'Sine in', 'out-sine': 'Sine out', 'in-out-sine': 'Sine in-out',
    'in-quad': 'Quad in', 'out-quad': 'Quad out', 'in-out-quad': 'Quad in-out',
    'in-cubic': 'Cubic in', 'out-cubic': 'Cubic out', 'in-out-cubic': 'Cubic in-out',
    'in-quart': 'Quart in', 'out-quart': 'Quart out', 'in-expo': 'Expo in', 'out-expo': 'Expo out',
    'in-out-expo': 'Expo in-out', 'out-back': 'Back out (overshoot)', 'in-out-back': 'Back in-out',
    'out-elastic': 'Elastic out', 'out-bounce': 'Bounce out'
  };
  const C1 = 1.70158;
  const C3 = C1 + 1;
  const C2 = C1 * 1.525;
  const bounceOut = function (x) {
    const n1 = 7.5625, d1 = 2.75;
    if (x < 1 / d1) return n1 * x * x;
    if (x < 2 / d1) { x -= 1.5 / d1; return n1 * x * x + 0.75; }
    if (x < 2.5 / d1) { x -= 2.25 / d1; return n1 * x * x + 0.9375; }
    x -= 2.625 / d1; return n1 * x * x + 0.984375;
  };
  const EASE_FN = {
    'linear': function (x) { return x; },
    'in-sine': function (x) { return 1 - Math.cos((x * Math.PI) / 2); },
    'out-sine': function (x) { return Math.sin((x * Math.PI) / 2); },
    'in-out-sine': function (x) { return -(Math.cos(Math.PI * x) - 1) / 2; },
    'in-quad': function (x) { return x * x; },
    'out-quad': function (x) { return 1 - (1 - x) * (1 - x); },
    'in-out-quad': function (x) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; },
    'in-cubic': function (x) { return x * x * x; },
    'out-cubic': function (x) { return 1 - Math.pow(1 - x, 3); },
    'in-out-cubic': function (x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; },
    'in-quart': function (x) { return x * x * x * x; },
    'out-quart': function (x) { return 1 - Math.pow(1 - x, 4); },
    'in-expo': function (x) { return x === 0 ? 0 : Math.pow(2, 10 * x - 10); },
    'out-expo': function (x) { return x === 1 ? 1 : 1 - Math.pow(2, -10 * x); },
    'in-out-expo': function (x) { return x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2; },
    'out-back': function (x) { return 1 + C3 * Math.pow(x - 1, 3) + C1 * Math.pow(x - 1, 2); },
    'in-out-back': function (x) { return x < 0.5 ? (Math.pow(2 * x, 2) * ((C2 + 1) * 2 * x - C2)) / 2 : (Math.pow(2 * x - 2, 2) * ((C2 + 1) * (x * 2 - 2) + C2) + 2) / 2; },
    'out-elastic': function (x) { return x === 0 ? 0 : x === 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1; },
    'out-bounce': bounceOut
  };
  function ease(name, x) {
    x = x < 0 ? 0 : x > 1 ? 1 : x;
    return (EASE_FN[name] || EASE_FN.linear)(x);
  }

  const ENUMS = {
    animEase: EASES,
    kind: KINDS,
    font: Object.keys(FONTS),
    animTrigger: TRIGGER_IDS,
    animMode: ['pulse', 'hold']
  };

  const ARROWS = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
  const SPECIAL = { Escape: 'Esc', Control: 'Ctrl', Spacebar: 'Space', ' ': 'Space' };

  // One spelling per physical input, shared by the DOM, the global hook and saved settings.
  function canonKey(name) {
    let n = String(name);
    if (ARROWS[n]) return ARROWS[n];
    if (SPECIAL[n]) return SPECIAL[n];
    n = n.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num');
    n = n.replace(/^(Shift|Ctrl|Control|Alt|Meta)(Left|Right)$/, '$1').replace(/^(Shift|Ctrl|Alt|Meta)R(ight)?$/, '$1');
    if (n === 'Control') n = 'Ctrl';
    return n.length === 1 ? n.toUpperCase() : n;
  }

  function domKeyName(e) { return canonKey(e.code || e.key); }

  function domMouseName(button) {
    return ['Mouse1', 'Mouse3', 'Mouse2', 'Mouse4', 'Mouse5'][button] || 'Mouse' + (button + 1);
  }

  function sanitizeTriggers(t) {
    const out = {};
    TRIGGER_IDS.forEach(function (id) {
      const def = TRIGGER_DEFAULTS[id];
      const arr = t && Array.isArray(t[id]) ? t[id] : [];
      out[id] = def.map(function (d, i) {
        const v = arr[i];
        return typeof v === 'string' && /^[A-Za-z0-9+\-]{1,14}$/.test(v) ? v : d;
      });
    });
    return out;
  }

  function actionsFor(triggers, name) {
    return TRIGGER_IDS.filter(function (id) { return triggers[id].indexOf(name) >= 0; });
  }

  const DEFAULTS = {
    style: 'cross',
    color: '#00ff66',
    opacity: 1,
    outlineOpacity: 1,
    size: 10,
    gap: 4,
    thickness: 2,
    rotation: 0,
    tStyle: false,
    dot: false,
    dotSize: 2,
    rounded: 0,
    outline: true,
    outlineColor: '#000000',
    outlineThickness: 1,
    offsetX: 0,
    offsetY: 0,
    animation: 'none',
    animEase: 'linear',
    animIntensity: 6,
    animDuration: 150,
    name: 'Layer',
    visible: true,
    glow: 0,
    blur: 0,
    kind: 'shape',
    src: '',
    imgSize: 32,
    imgAspect: 1,
    tint: false,
    text: 'X',
    font: 'sans',
    fontSize: 24,
    bold: true,
    brush: 3,
    strokes: [],
    animTrigger: 'shoot',
    animMode: 'pulse',
    dynamic: true,
    dynOwn: false,
    dynMove: 0,
    dynRun: 0,
    dynShoot: 0,
    dynJump: 0,
    dynAim: 0,
    dynReload: 0,
    flipX: false,
    flipY: false
  };

  const MAX_LAYERS = 16;

  const RANGES = {
    opacity: [0.1, 1],
    outlineOpacity: [0, 1],
    size: [0, 60],
    gap: [0, 40],
    thickness: [1, 12],
    rotation: [0, 359],
    dotSize: [1, 12],
    rounded: [0, 100],
    outlineThickness: [0, 6],
    offsetX: [-250, 250],
    offsetY: [-250, 250],
    animIntensity: [0, 30],
    animDuration: [40, 600],
    dynMove: [-30, 30],
    dynRun: [-30, 30],
    dynShoot: [-30, 30],
    dynJump: [-30, 30],
    dynAim: [-30, 30],
    dynReload: [-30, 30],
    glow: [0, 30],
    blur: [0, 10],
    imgSize: [4, 400],
    imgAspect: [0.05, 20],
    fontSize: [6, 200],
    brush: [1, 24]
  };

  function isHex(v) {
    return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
  }

  const LEGACY_ANIMS = {
    'expand-click': ['expand', 'shoot', 'pulse'],
    'shrink-click': ['shrink', 'shoot', 'pulse'],
    'expand-move': ['expand', 'move', 'hold']
  };

  // Image data URLs can be large; remember the ones already checked so live edits stay cheap.
  const okSrcs = new Set();
  function validSrc(v) {
    if (typeof v !== 'string' || !v) return false;
    if (okSrcs.has(v)) return true;
    if (v.length > 700000 || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+\/=]+$/.test(v)) return false;
    if (okSrcs.size > 24) okSrcs.clear();
    okSrcs.add(v);
    return true;
  }

  function cleanStrokes(v) {
    const out = [];
    if (!Array.isArray(v)) return out;
    let total = 0;
    const q = function (n) { return Math.round(Math.min(300, Math.max(-300, n)) * 10) / 10; };
    for (let i = 0; i < v.length && i < 300 && total < 4000; i++) {
      const st = v[i];
      if (!Array.isArray(st)) continue;
      const pts = [];
      for (let j = 0; j < st.length && j < 600 && total + pts.length < 4000; j++) {
        const p = st[j];
        if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) pts.push([q(p[0]), q(p[1])]);
      }
      if (pts.length) { out.push(pts); total += pts.length; }
    }
    return out;
  }

  // ---------- dynamics (spread reacts to what you do) and color rules (color reacts to what you do)
  const DYN_KEYS = ['move', 'run', 'shoot', 'jump', 'aim', 'reload'];
  const DYN_PULSE = { shoot: true, jump: true, reload: true };
  const DYN_DEFAULT = { enabled: false, duration: 120, ease: 'out-quad', move: 0, run: 0, shoot: 0, jump: 0, aim: 0, reload: 0 };
  const MAX_RULES = 6;
  // Alternate crosshairs shown while an action is held. Earlier ids win when several are held.
  const STATE_PRIORITY = ['aim', 'reload', 'jump', 'run', 'move', 'shoot'];
  const STATE_IDS = STATE_PRIORITY;

  function num(v, lo, hi, def) {
    const n = typeof v === 'number' ? v : Number(v);
    return v !== undefined && v !== null && v !== '' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
  }

  function cleanDynamic(v) {
    if (!v || typeof v !== 'object') return null;
    const d = { enabled: v.enabled === true };
    d.duration = num(v.duration, 40, 600, DYN_DEFAULT.duration);
    d.ease = EASES.indexOf(v.ease) >= 0 ? v.ease : DYN_DEFAULT.ease;
    DYN_KEYS.forEach(function (k) { d[k] = Math.round(num(v[k], -30, 30, 0) * 10) / 10; });
    return d;
  }

  function cleanRules(v) {
    const out = [];
    if (!Array.isArray(v)) return out;
    for (let i = 0; i < v.length && out.length < MAX_RULES; i++) {
      const r = v[i];
      if (!r || typeof r !== 'object' || TRIGGER_IDS.indexOf(r.trigger) < 0 || !isHex(r.color)) continue;
      out.push({
        trigger: r.trigger,
        color: r.color.toLowerCase(),
        mode: r.mode === 'pulse' ? 'pulse' : 'hold',
        outline: r.outline === true
      });
    }
    return out;
  }

  // Extra gap (px, may be negative) from the dynamics settings at the current animation state.
  function dynGap(cfg, anim) {
    const d = cfg && cfg.dynamic;
    if (!d || !d.enabled || !anim || !anim.v) return 0;
    let g = 0;
    for (let i = 0; i < DYN_KEYS.length; i++) {
      const k = DYN_KEYS[i];
      if (!d[k]) continue;
      const raw = (DYN_PULSE[k] ? anim.kick[k] : anim.v[k]) || 0;
      g += d[k] * (d.ease && d.ease !== 'linear' ? ease(d.ease, raw) : raw);
    }
    return g;
  }

  const cap = function (k) { return k.charAt(0).toUpperCase() + k.slice(1); };

  // A layer's own dynamics (used instead of the design-wide ones when "Own dynamics" is on).
  function ownGap(l, cfg, anim) {
    if (!anim || !anim.v) return 0;
    const en = cfg && cfg.dynamic && cfg.dynamic.ease ? cfg.dynamic.ease : 'out-quad';
    let g = 0;
    for (let i = 0; i < DYN_KEYS.length; i++) {
      const k = DYN_KEYS[i];
      const c = l['dyn' + cap(k)];
      if (!c) continue;
      const raw = (DYN_PULSE[k] ? anim.kick[k] : anim.v[k]) || 0;
      g += c * (en !== 'linear' ? ease(en, raw) : raw);
    }
    return g;
  }

  function ownGrowth(l) {
    let g = 0;
    DYN_KEYS.forEach(function (k) { if (l['dyn' + cap(k)] > 0) g += l['dyn' + cap(k)]; });
    return g;
  }

  function ruleAmount(anim, r) {
    if (!anim || !anim.v) return 0;
    return Math.max(0, Math.min(1, (r.mode === 'pulse' ? anim.kick[r.trigger] : anim.v[r.trigger]) || 0));
  }

  // Returns a complete, clamped config. Anything missing or invalid falls back to the default.
  // Extra animations on a layer (the layer's own animation fields are the first one).
  const MAX_EXTRA_ANIMS = 5;
  function cleanAnims(v) {
    const out = [];
    if (!Array.isArray(v)) return out;
    for (let i = 0; i < v.length && out.length < MAX_EXTRA_ANIMS; i++) {
      const a = v[i];
      if (!a || typeof a !== 'object' || ANIMS.indexOf(a.animation) < 1) continue;
      out.push({
        animation: a.animation,
        animTrigger: TRIGGER_IDS.indexOf(a.animTrigger) >= 0 ? a.animTrigger : 'shoot',
        animMode: a.animMode === 'hold' ? 'hold' : 'pulse',
        animEase: ENUMS.animEase.indexOf(a.animEase) >= 0 ? a.animEase : 'linear',
        animIntensity: num(a.animIntensity, 0, 30, 6),
        animDuration: num(a.animDuration, 40, 600, 150)
      });
    }
    return out;
  }

  // All active animations of a layer: its own first, then the extras.
  function animsOf(l) {
    const list = [];
    if (l && l.animation && l.animation !== 'none') list.push(l);
    if (l && l.anims) for (let i = 0; i < l.anims.length; i++) list.push(l.anims[i]);
    return list;
  }

  function sanitize(input) {
    let src = input && typeof input === 'object' ? input : {};
    if (typeof src.animation === 'string' && LEGACY_ANIMS[src.animation]) {
      const m = LEGACY_ANIMS[src.animation];
      src = Object.assign({}, src, { animation: m[0], animTrigger: src.animTrigger || m[1], animMode: src.animMode || m[2] });
    }
    const out = {};
    for (const key of Object.keys(DEFAULTS)) {
      const def = DEFAULTS[key];
      const v = src[key];
      if (key === 'name') out[key] = typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : def;
      else if (key === 'style') out[key] = STYLES.indexOf(v) >= 0 ? v : def;
      else if (key === 'animation') out[key] = ANIMS.indexOf(v) >= 0 ? v : def;
      else if (ENUMS[key]) out[key] = ENUMS[key].indexOf(v) >= 0 ? v : def;
      else if (key === 'src') out[key] = validSrc(v) ? v : '';
      else if (key === 'text') out[key] = typeof v === 'string' ? v.slice(0, 24) : def;
      else if (key === 'strokes') out[key] = cleanStrokes(v);
      else if (key === 'color' || key === 'outlineColor') out[key] = isHex(v) ? v.toLowerCase() : def;
      else if (typeof def === 'boolean') out[key] = typeof v === 'boolean' ? v : def;
      else {
        const n = typeof v === 'number' ? v : Number(v);
        const r = RANGES[key];
        out[key] = v !== undefined && v !== null && Number.isFinite(n) ? Math.min(r[1], Math.max(r[0], n)) : def;
      }
    }
    const extra = cleanAnims(src.anims);
    if (extra.length) out.anims = extra;
    return out;
  }

  // A crosshair design is a list of layers (drawn bottom to top). A plain single config
  // (from older saves, share codes and the pro list) is accepted and becomes one layer.
  function sanitizeDesign(input) {
    let layers = [];
    if (input && typeof input === 'object' && Array.isArray(input.layers)) {
      layers = input.layers.slice(0, MAX_LAYERS).map(sanitize);
    } else if (input && typeof input === 'object') {
      layers = [sanitize(input)];
    }
    if (!layers.length) layers = [sanitize(null)];
    const out = { layers: layers };
    const dyn = cleanDynamic(input && input.dynamic);
    if (dyn) out.dynamic = dyn;
    const rules = cleanRules(input && input.rules);
    if (rules.length) out.rules = rules;
    if (input && input.states && typeof input.states === 'object') {
      const st = {};
      STATE_IDS.forEach(function (id) {
        const s = input.states[id];
        if (s && Array.isArray(s.layers) && s.layers.length) st[id] = { layers: s.layers.slice(0, MAX_LAYERS).map(sanitize) };
      });
      if (Object.keys(st).length) out.states = st;
    }
    return out;
  }

  // The crosshair new installs start with (also what "Reset" restores).
  const DEFAULT_DESIGN = {
    layers: [{
      style: 'cross', color: '#00ff91', opacity: 1, size: 4, gap: 4, thickness: 2, rotation: 0, tStyle: false,
      dot: true, dotSize: 4, outline: false, outlineColor: '#000000', outlineThickness: 1, offsetX: 0, offsetY: 0,
      animation: 'pulse', animIntensity: 6, animDuration: 150
    }]
  };

  function newLayer(name) {
    return sanitize({ name: name });
  }

  // Every layer the design can ever show (base plus all state variants), for sizing and animation checks.
  function layersOf(c) {
    if (!c || !Array.isArray(c.layers)) return [c];
    if (!c.states) return c.layers;
    let all = c.layers;
    STATE_IDS.forEach(function (id) { if (c.states[id]) all = all.concat(c.states[id].layers); });
    return all;
  }

  // The layers to draw right now: a state's own layers while its action is held (first match wins).
  function activeLayers(cfg, anim) {
    if (cfg.states && anim && anim.held) {
      for (let i = 0; i < STATE_PRIORITY.length; i++) {
        const id = STATE_PRIORITY[i];
        if (anim.held[id] && cfg.states[id]) return cfg.states[id].layers;
      }
    }
    return cfg.layers;
  }

  function hasAnimation(c) {
    if (c && ((c.dynamic && c.dynamic.enabled) || (c.rules && c.rules.length) || c.states)) return true;
    if (layersOf(c).some(function (l) { return l && l.dynOwn; })) return true;
    return layersOf(c).some(function (l) { return l && l.visible !== false && animsOf(l).length > 0; });
  }

  // Rough radius (px at zoom 1) of what a layer can paint, used to size the editor preview and
  // the overlay window. Errs on the large side.
  function baseExtent(l) {
    const e = l.glow + l.blur;
    const o = l.outline ? l.outlineThickness : 0;
    if (l.kind === 'image') return Math.hypot(l.imgSize, l.imgSize * l.imgAspect) / 2 + e;
    if (l.kind === 'text') {
      const w = Math.max(l.fontSize, 0.7 * l.fontSize * (l.text || '').length) / 2;
      return Math.hypot(w, l.fontSize * 0.6) + e + o;
    }
    if (l.kind === 'draw') {
      let m = 6;
      l.strokes.forEach(function (st) { st.forEach(function (p) { m = Math.max(m, Math.hypot(p[0], p[1])); }); });
      return m + l.brush / 2 + e + o;
    }
    return l.size + l.gap + l.thickness + o + e + 4;
  }

  function dynGrowth(d) {
    let g = 0;
    DYN_KEYS.forEach(function (k) { if (d[k] > 0) g += d[k]; });
    return g;
  }

  // Radius of the whole design including layer offsets and animation growth.
  function designRadius(c) {
    let r = 8;
    layersOf(c).forEach(function (l) {
      if (!l || l.visible === false) return;
      let b = baseExtent(l);
      const b0 = b;
      animsOf(l).forEach(function (a) {
        if (a.animation === 'expand' || a.animation === 'shrink') b += l.kind === 'shape' ? a.animIntensity : b0 * a.animIntensity / 30;
        else if (a.animation === 'pulse') b += b0 * a.animIntensity / 30;
      });
      const grow = l.dynOwn ? ownGrowth(l) : (l.dynamic !== false && c && c.dynamic && c.dynamic.enabled ? dynGrowth(c.dynamic) : 0);
      if (grow) b += grow * (l.kind === 'shape' ? 1 : b / 30);
      r = Math.max(r, b + Math.hypot(l.offsetX, l.offsetY));
    });
    return r;
  }

  // ---------- color helpers
  function hexToRgb(h) {
    if (h.charAt(0) === 'r') { const m = h.match(/\d+/g); return [+m[0], +m[1], +m[2]]; }
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function invertHex(h) {
    const c = hexToRgb(h);
    return '#' + c.map(function (v) { return (255 - v).toString(16).padStart(2, '0'); }).join('');
  }
  function mixHex(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    const m = A.map(function (v, i) { return Math.round(v + (B[i] - v) * t); });
    return 'rgb(' + m.join(',') + ')';
  }

  // ---------- animation state
  function newAnim() {
    const a = { kick: {}, held: {}, v: {}, rise: {} };
    TRIGGER_IDS.forEach(function (id) { a.kick[id] = 0; a.held[id] = false; a.v[id] = 0; a.rise[id] = false; });
    return a;
  }

  // Applies a trigger event ({type:'trigger', action, down}) to the animation state.
  function applyInput(a, e) {
    if (!e || e.type !== 'trigger' || TRIGGER_IDS.indexOf(e.action) < 0) return false;
    a.held[e.action] = !!e.down;
    if (e.down) { if (!a.rise) a.rise = {}; a.rise[e.action] = true; }
    return true;
  }

  function releaseAll(a) {
    TRIGGER_IDS.forEach(function (id) { a.held[id] = false; });
  }

  function animMs(c) {
    let ms = 150;
    let found = false;
    layersOf(c).forEach(function (l) {
      animsOf(l).forEach(function (a) {
        ms = found ? Math.min(ms, a.animDuration) : a.animDuration;
        found = true;
      });
    });
    const own = layersOf(c).some(function (l) { return l && l.dynOwn; });
    if ((c && c.dynamic && c.dynamic.enabled) || own) {
      const dd = c && c.dynamic ? c.dynamic.duration : DYN_DEFAULT.duration;
      ms = found ? Math.min(ms, dd) : dd;
    }
    return ms;
  }

  // Advances animation by dt seconds. Returns true while something is still animating.
  function stepAnim(a, cfg, dt) {
    const dur = Math.max(0.04, animMs(cfg) / 1000);
    const d = dt / dur;
    let more = false;
    TRIGGER_IDS.forEach(function (id) {
      if (a.rise && a.rise[id]) {
        // A new press rises from wherever the value is now (no snapping), then decays again.
        a.kick[id] = Math.min(1, a.kick[id] + d * 4);
        if (a.kick[id] >= 1) a.rise[id] = false;
      } else {
        a.kick[id] = Math.max(0, a.kick[id] - d);
      }
      const target = a.held[id] ? 1 : 0;
      if (a.v[id] < target) a.v[id] = Math.min(target, a.v[id] + d);
      else if (a.v[id] > target) a.v[id] = Math.max(target, a.v[id] - d);
      if (a.kick[id] > 0 || (a.rise && a.rise[id]) || a.v[id] !== target) more = true;
    });
    return more;
  }

  // ---------- shape library
  const PI = Math.PI;

  function poly(ctx, g, pts) {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]);
      else ctx.lineTo(pts[i][0], pts[i][1]);
    }
    ctx.closePath();
    ctx.fill();
    if (g > 0) { ctx.lineWidth = g * 2; ctx.lineJoin = 'round'; ctx.stroke(); }
  }
  // 0..1: how far the corners of straight bars and cross arms are rounded (set per layer while drawing)
  let roundAmt = 0;

  // Filled rectangle with optionally rounded corners (radius = roundAmt of the shorter half-side).
  function rbox(ctx, x, y, w, h) {
    const r = Math.min(w, h) / 2 * roundAmt;
    if (r > 0.01 && ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, w, h);
    }
  }

  function bar(ctx, g, x1, y1, x2, y2, w) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    if (roundAmt > 0 && ctx.roundRect) {
      ctx.save();
      ctx.translate((x1 + x2) / 2, (y1 + y2) / 2);
      ctx.rotate(Math.atan2(dy, dx));
      rbox(ctx, -len / 2 - g, -w / 2 - g, len + g * 2, w + g * 2);
      ctx.restore();
      return;
    }
    const nx = (-dy / len) * (w / 2);
    const ny = (dx / len) * (w / 2);
    poly(ctx, g, [[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]]);
  }
  function disc(ctx, g, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, PI * 2);
    ctx.fill();
    if (g > 0) { ctx.lineWidth = g * 2; ctx.stroke(); }
  }
  function arcLine(ctx, g, cx, cy, r, a0, a1, w) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a1);
    ctx.lineWidth = w + g * 2;
    ctx.lineCap = 'butt';
    ctx.stroke();
  }
  function dimmed(ctx, fn) {
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * 0.35;
    fn();
    ctx.globalAlpha = a;
  }
  function spin(ctx, ang, fn) {
    ctx.save();
    ctx.rotate(ang);
    fn();
    ctx.restore();
  }
  function star(n, outer, inner) {
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = -PI / 2 + (i * PI) / n;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return pts;
  }

  // Each shape draws centred on the origin. size = overall extent, gap = inner offset,
  // thickness = line / part width. g > 0 means "draw the outline pass, grown by g".
  const SHAPES = {
    crosshair2: function (ctx, c, gap, g) {
      // Four tapered spikes: tip near the centre, base (width = Thickness) at the outer end.
      const s = Math.max(1, c.size), w = Math.max(0.5, c.thickness / 2);
      for (let k = 0; k < 4; k++) spin(ctx, (k * PI) / 2, function () { poly(ctx, g, [[gap, 0], [gap + s, -w], [gap + s, w]]); });
    },
    twolines: function (ctx, c, gap, g) {
      const s = Math.max(1, c.size), t = Math.max(1, c.thickness);
      bar(ctx, g, gap, 0, gap + s, 0, t);
      bar(ctx, g, -gap, 0, -gap - s, 0, t);
    },
    threelines: function (ctx, c, gap, g) {
      const s = Math.max(1, c.size), t = Math.max(1, c.thickness);
      bar(ctx, g, gap, 0, gap + s, 0, t);
      bar(ctx, g, -gap, 0, -gap - s, 0, t);
      bar(ctx, g, 0, gap, 0, gap + s, t);
    },
    plus: function (ctx, c, gap, g) {
      const e = Math.max(1, c.size) + gap, h = Math.max(c.thickness, e / 3) / 2;
      poly(ctx, g, [[-h, -e], [h, -e], [h, -h], [e, -h], [e, h], [h, h], [h, e], [-h, e], [-h, h], [-e, h], [-e, -h], [-h, -h]]);
    },
    tshape: function (ctx, c, gap, g) {
      const e = Math.max(1, c.size) + gap, w = Math.max(c.thickness, e / 3), h = w / 2;
      poly(ctx, g, [[-e, -e], [e, -e], [e, -e + w], [h, -e + w], [h, e], [-h, e], [-h, -e + w], [-e, -e + w]]);
    },
    trident: function (ctx, c, gap, g) {
      const s = Math.max(1, c.size), w = Math.max(2, c.thickness * 1.5);
      [-150, -30, 90].forEach(function (deg) {
        const a = (deg * PI) / 180;
        bar(ctx, g, Math.cos(a) * gap, Math.sin(a) * gap, Math.cos(a) * (gap + s), Math.sin(a) * (gap + s), w);
      });
    },
    cornerframe: function (ctx, c, gap, g) {
      const e = Math.max(1, c.size) + gap, a = Math.max(2, c.size * 0.6), t = Math.max(1, c.thickness);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) {
        bar(ctx, g, q[0] * e, q[1] * e, q[0] * (e - a), q[1] * e, t);
        bar(ctx, g, q[0] * e, q[1] * e, q[0] * e, q[1] * (e - a), t);
      });
    },
    bracketplus: function (ctx, c, gap, g) {
      const k = gap + Math.max(1, c.thickness), a = Math.max(2, c.size), t = Math.max(1, c.thickness);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) {
        bar(ctx, g, q[0] * k, q[1] * k, q[0] * (k + a), q[1] * k, t);
        bar(ctx, g, q[0] * k, q[1] * k, q[0] * k, q[1] * (k + a), t);
      });
    },
    trirects: function (ctx, c, gap, g) {
      const s = Math.max(1, c.size), w = Math.max(2, c.thickness * 1.5);
      [-90, 30, 150].forEach(function (deg) {
        const a = (deg * PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
        bar(ctx, g, ca * gap, sa * gap, ca * (gap + s), sa * (gap + s), w);
      });
    },
    triellipses: function (ctx, c, gap, g) {
      const s = Math.max(1, c.size), r = Math.max(1.5, c.thickness * 0.8), d = gap + s * 0.6;
      [-90, 30, 150].forEach(function (deg) {
        const a = (deg * PI) / 180;
        disc(ctx, g, Math.cos(a) * d, Math.sin(a) * d, r);
      });
    },
    doublechevron: function (ctx, c, gap, g) {
      const cc = Math.max(2, c.size * 0.6), t = Math.max(1, c.thickness);
      [-1, 1].forEach(function (side) {
        const tip = side * gap;
        const endX = side * (gap + cc);
        bar(ctx, g, endX, -cc, tip, 0, t);
        bar(ctx, g, endX, cc, tip, 0, t);
      });
    },
    ellipse: function (ctx, c, gap, g) {
      const e = Math.max(1, c.size) + gap;
      ctx.beginPath();
      ctx.ellipse(0, 0, e, e * 0.78, 0, 0, PI * 2);
      ctx.fill();
      if (g > 0) { ctx.lineWidth = g * 2; ctx.stroke(); }
    },
    rectangle: function (ctx, c, gap, g) {
      const e = Math.max(1, c.size) + gap;
      poly(ctx, g, [[-e, -e * 0.6], [e, -e * 0.6], [e, e * 0.6], [-e, e * 0.6]]);
    },
    triangle: function (ctx, c, gap, g) {
      const e = Math.max(1, c.size) + gap;
      poly(ctx, g, [[0, -e], [e, e * 0.8], [-e, e * 0.8]]);
    },
    diamond: function (ctx, c, gap, g) {
      const e = Math.max(1, c.size) + gap;
      poly(ctx, g, [[0, -e], [e * 0.6, 0], [0, e], [-e * 0.6, 0]]);
    },
    trapezoid: function (ctx, c, gap, g) {
      const e = Math.max(1, c.size) + gap;
      poly(ctx, g, [[-e * 0.5, -e * 0.7], [e * 0.5, -e * 0.7], [e, e * 0.7], [-e, e * 0.7]]);
    },
    hexagon: function (ctx, c, gap, g) {
      const e = Math.max(1, c.size) + gap, pts = [];
      for (let i = 0; i < 6; i++) pts.push([Math.cos((i * PI) / 3) * e, Math.sin((i * PI) / 3) * e]);
      poly(ctx, g, pts);
    },
    crescent: function (ctx, c, gap, g) {
      const R = Math.max(1, c.size) + gap, r = R * 0.82, d = R * 0.38;
      const x = (d * d + R * R - r * r) / (2 * d);
      const y = Math.sqrt(Math.max(0, R * R - x * x));
      ctx.beginPath();
      ctx.arc(0, 0, R, Math.atan2(-y, x), Math.atan2(y, x), true);
      ctx.arc(d, 0, r, Math.atan2(y, x - d), Math.atan2(-y, x - d), false);
      ctx.closePath();
      ctx.fill();
      if (g > 0) { ctx.lineWidth = g * 2; ctx.lineJoin = 'round'; ctx.stroke(); }
    },
    arc: function (ctx, c, gap, g) {
      const e = Math.max(1, c.size) + gap;
      arcLine(ctx, g, 0, -e * 0.45, e, PI * 0.2, PI * 0.8, Math.max(1, c.thickness));
    },
    chevron: function (ctx, c, gap, g) {
      const e = Math.max(1, c.size) + gap, w = Math.max(2, c.thickness * 1.2);
      bar(ctx, g, -e * 0.5, -e * 0.7, e * 0.5, 0, w);
      bar(ctx, g, -e * 0.5, e * 0.7, e * 0.5, 0, w);
    },
    bracket: function (ctx, c, gap, g) {
      const e = Math.max(1, c.size) + gap, w = Math.max(c.thickness, e / 3);
      poly(ctx, g, [[-e, -e], [e, -e], [e, -e + w], [-e + w, -e + w], [-e + w, e], [-e, e]]);
    },
    arrow: function (ctx, c, gap, g) {
      const e = Math.max(1, c.size) + gap;
      poly(ctx, g, [[0, -e], [e * 0.7, -e * 0.1], [e * 0.28, -e * 0.1], [e * 0.28, e], [-e * 0.28, e], [-e * 0.28, -e * 0.1], [-e * 0.7, -e * 0.1]]);
    },
    dart: function (ctx, c, gap, g) {
      const e = Math.max(1, c.size) + gap;
      poly(ctx, g, [[0, -e], [e * 0.7, e], [0, e * 0.55], [-e * 0.7, e]]);
    },
    house: function (ctx, c, gap, g) {
      const e = Math.max(1, c.size) + gap;
      poly(ctx, g, [[0, -e], [e * 0.7, -e * 0.3], [e * 0.7, e], [-e * 0.7, e], [-e * 0.7, -e * 0.3]]);
    },
    star: function (ctx, c, gap, g) {
      const e = Math.max(1, c.size) + gap;
      poly(ctx, g, star(5, e, e * 0.45));
    },
    heart: function (ctx, c, gap, g) {
      const e = Math.max(1, c.size) + gap;
      ctx.beginPath();
      ctx.moveTo(0, e * 0.9);
      ctx.bezierCurveTo(-e * 1.3, -e * 0.1, -e * 0.6, -e * 1.1, 0, -e * 0.4);
      ctx.bezierCurveTo(e * 0.6, -e * 1.1, e * 1.3, -e * 0.1, 0, e * 0.9);
      ctx.closePath();
      ctx.fill();
      if (g > 0) { ctx.lineWidth = g * 2; ctx.lineJoin = 'round'; ctx.stroke(); }
    },
    segmentedring: function (ctx, c, gap, g) {
      const R = Math.max(1, c.size) + gap, t = Math.max(1, c.thickness);
      for (let i = 0; i < 8; i++) arcLine(ctx, g, 0, 0, R, (i * PI) / 4 + 0.12, ((i + 1) * PI) / 4 - 0.12, t);
    },
    radiallines: function (ctx, c, gap, g) {
      const s = Math.max(1, c.size), t = Math.max(1, c.thickness);
      for (let i = 0; i < 8; i++) {
        const a = (i * PI) / 4 + PI / 8;
        bar(ctx, g, Math.cos(a) * gap, Math.sin(a) * gap, Math.cos(a) * (gap + s), Math.sin(a) * (gap + s), t);
      }
    },
    dotring: function (ctx, c, gap, g) {
      const R = Math.max(1, c.size) + gap, r = Math.max(1.2, c.thickness * 0.7);
      for (let i = 0; i < 8; i++) disc(ctx, g, Math.cos((i * PI) / 4) * R, Math.sin((i * PI) / 4) * R, r);
    },
    tickring: function (ctx, c, gap, g) {
      const s = Math.max(1, c.size), R = s + gap, t = Math.max(1, c.thickness);
      arcLine(ctx, g, 0, 0, R, 0, PI * 2, t);
      for (let k = 0; k < 4; k++) spin(ctx, (k * PI) / 2, function () { bar(ctx, g, R - s * 0.6, 0, R + t, 0, t * 1.4); });
    },
    spikering: function (ctx, c, gap, g) {
      const s = Math.max(1, c.size), w = Math.max(c.thickness * 1.5, s * 0.5);
      for (let k = 0; k < 4; k++) spin(ctx, (k * PI) / 2, function () { poly(ctx, g, [[gap, 0], [gap + s, -w], [gap + s, w]]); });
    },
    wedgering: function (ctx, c, gap, g) {
      const s = Math.max(1, c.size), w = Math.max(c.thickness * 1.5, s * 0.5);
      for (let k = 0; k < 4; k++) spin(ctx, (k * PI) / 2, function () { poly(ctx, g, [[gap, -w * 0.4], [gap + s, -w * 1.1], [gap + s, w * 1.1], [gap, w * 0.4]]); });
    },
    duplexposts: function (ctx, c, gap, g) {
      const s = Math.max(1, c.size), t = Math.max(1, c.thickness), p = t * 1.3;
      for (let k = 0; k < 4; k++) spin(ctx, (k * PI) / 2, function () {
        bar(ctx, g, gap, -p, gap + s, -p, t);
        bar(ctx, g, gap, p, gap + s, p, t);
      });
    },
    housering: function (ctx, c, gap, g) {
      const s = Math.max(1, c.size), w = Math.max(c.thickness * 1.2, s * 0.3);
      for (let k = 0; k < 4; k++) spin(ctx, (k * PI) / 2, function () {
        poly(ctx, g, [[gap, 0], [gap + s * 0.5, -w], [gap + s, -w], [gap + s, w], [gap + s * 0.5, w]]);
      });
    },
    tring: function (ctx, c, gap, g) {
      const s = Math.max(1, c.size), t = Math.max(1, c.thickness);
      for (let k = 0; k < 4; k++) spin(ctx, (k * PI) / 2, function () {
        bar(ctx, g, gap, 0, gap + s, 0, t);
        bar(ctx, g, gap + s, -s * 0.5, gap + s, s * 0.5, t);
      });
    },
    chevronring: function (ctx, c, gap, g) {
      const s = Math.max(1, c.size), R = s + gap, cc = Math.max(2, s * 0.5), t = Math.max(1, c.thickness);
      [-90, 30, 150].forEach(function (deg) {
        spin(ctx, (deg * PI) / 180, function () {
          bar(ctx, g, R - cc, -cc, R, 0, t);
          bar(ctx, g, R - cc, cc, R, 0, t);
        });
      });
    },
    chargebar: function (ctx, c, gap, g) {
      const e = Math.max(1, c.size) + gap, h = Math.max(2, c.thickness);
      dimmed(ctx, function () { poly(ctx, g, [[-e, -h], [e, -h], [e, h], [-e, h]]); });
      poly(ctx, g, [[-e, -h], [-e + e * 1.2, -h], [-e + e * 1.2, h], [-e, h]]);
    },
    arcgauge: function (ctx, c, gap, g) {
      const R = Math.max(1, c.size) + gap, w = Math.max(2, c.thickness * 1.5);
      dimmed(ctx, function () { arcLine(ctx, g, 0, 0, R, 0, PI * 2, w); });
      arcLine(ctx, g, 0, 0, R, -PI / 2, -PI / 2 + PI * 1.4, w);
    },
    piprow: function (ctx, c, gap, g) {
      const e = Math.max(1, c.size) + gap, h = Math.max(2, c.thickness * 1.2), n = 5;
      const slot = (e * 2) / n, pw = slot * 0.72;
      for (let i = 0; i < n; i++) {
        const x = -e + slot * i + (slot - pw) / 2;
        const draw = function () { poly(ctx, g, [[x, -h], [x + pw, -h], [x + pw, h], [x, h]]); };
        if (i < 3) draw(); else dimmed(ctx, draw);
      }
    },
    pipring: function (ctx, c, gap, g) {
      const R = Math.max(1, c.size) + gap, w = Math.max(2, c.thickness * 1.2), n = 10;
      for (let i = 0; i < n; i++) {
        const a0 = -PI / 2 + (i * PI * 2) / n + 0.1, a1 = -PI / 2 + ((i + 1) * PI * 2) / n - 0.1;
        const draw = function () { arcLine(ctx, g, 0, 0, R, a0, a1, w); };
        if (i < 7) draw(); else dimmed(ctx, draw);
      }
    },
    spreadsector: function (ctx, c, gap, g) {
      const e = Math.max(1, c.size) + gap, r = e * 1.8, half = (32 * PI) / 180;
      ctx.beginPath();
      ctx.moveTo(0, e * 0.9);
      ctx.arc(0, e * 0.9, r, -PI / 2 - half, -PI / 2 + half);
      ctx.closePath();
      ctx.fill();
      if (g > 0) { ctx.lineWidth = g * 2; ctx.lineJoin = 'round'; ctx.stroke(); }
    }
  };

  // ---------- drawing
  function shape(ctx, cfg, gap, g) {
    const t = cfg.thickness;
    const s = cfg.size;
    switch (cfg.style) {
      case 'cross':
      case 'x': {
        if (s > 0) {
          if (cfg.style === 'cross' && cfg.rotation === 0) {
            // Pixel-aligned plus: a centre box of t x t, with four arms attached around it.
            const tt = Math.max(1, Math.round(t));
            const a = Math.floor(tt / 2);
            const x0 = -a;
            const x1 = -a + tt;
            const gg = Math.round(gap);
            const ss = Math.max(1, Math.round(s));
            const box = function (x, y, w, h) { rbox(ctx, x - g, y - g, w + g * 2, h + g * 2); };
            box(x1 + gg, x0, ss, tt); // right
            box(x0 - gg - ss, x0, ss, tt); // left
            box(x0, x1 + gg, tt, ss); // bottom
            if (!cfg.tStyle) box(x0, x0 - gg - ss, tt, ss); // top
          } else {
            // Rotated / X style: arms are centred on their own axis, then rotated about the centre.
            const y0 = -t / 2 - g;
            const h = t + g * 2;
            for (let i = 0; i < 4; i++) {
              if (cfg.tStyle && cfg.style === 'cross' && i === 3) continue; // i=3 is the top arm
              ctx.save();
              ctx.rotate((i * Math.PI) / 2);
              rbox(ctx, gap - g, y0, s + g * 2, h);
              ctx.restore();
            }
          }
        }
        break;
      }
      case 'circle':
        ctx.lineWidth = t + g * 2;
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(1, s + gap), 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'square': {
        const h2 = Math.max(1, s + gap);
        ctx.lineWidth = t + g * 2;
        ctx.lineJoin = roundAmt > 0 ? 'round' : 'miter';
        ctx.strokeRect(-h2, -h2, h2 * 2, h2 * 2);
        break;
      }
      case 'dot':
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(1, s / 4) + g, 0, Math.PI * 2);
        ctx.fill();
        break;
      default:
        if (SHAPES[cfg.style]) SHAPES[cfg.style](ctx, cfg, gap, g);
    }
    if (cfg.dot && cfg.style !== 'dot') {
      ctx.beginPath();
      ctx.arc(0, 0, cfg.dotSize / 2 + g, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Draws a crosshair design (all visible layers) or a single layer config, centred on (cx, cy)
  // in the current canvas coordinate space. opts.noOffset ignores each layer's own offset.
  function draw(ctx, cfg, anim, cx, cy, zoom, opts) {
    if (cfg && Array.isArray(cfg.layers)) {
      const gap = dynGap(cfg, anim);
      const rules = cfg.rules && cfg.rules.length ? cfg.rules : null;
      const reactive = gap || rules ? Object.assign({}, opts, { dynGap: gap, rules: rules }) : opts;
      const list = activeLayers(cfg, anim);
      for (let i = 0; i < list.length; i++) {
        const l = list[i];
        if (l.visible === false) continue;
        let o = l.dynamic === false ? opts : reactive;
        if (l.dynOwn) o = Object.assign({}, opts, { dynGap: ownGap(l, cfg, anim), rules: l.dynamic === false ? null : rules });
        drawLayer(ctx, l, anim, cx, cy, zoom, o);
      }
      return;
    }
    drawLayer(ctx, cfg, anim, cx, cy, zoom, opts);
  }

  // ---------- images (decoded once, cached by data URL)
  const imageCache = new Map();
  const tintCache = new WeakMap();
  const assetListeners = [];

  function onAssetLoad(fn) { assetListeners.push(fn); }

  const MAX_FRAMES = 90;
  const MAX_FRAME_SIDE = 256;
  const notify = function () { assetListeners.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } }); };

  // Animated GIF/WebP: decoded once into frames with ImageDecoder (Chromium), then played by clock.
  function decodeFrames(src, rec) {
    if (typeof ImageDecoder === 'undefined' || typeof createImageBitmap === 'undefined') return;
    const m = /^data:(image\/(?:gif|webp));base64,(.+)$/.exec(src);
    if (!m) return;
    let bytes;
    try {
      const bin = atob(m[2]);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch (e) { return; }
    let dec;
    try { dec = new ImageDecoder({ data: bytes, type: m[1] }); } catch (e) { return; }
    dec.tracks.ready.then(function () {
      const count = Math.min(MAX_FRAMES, dec.tracks.selectedTrack ? dec.tracks.selectedTrack.frameCount : 1);
      if (count < 2) { dec.close(); return; }
      const frames = [];
      let chain = Promise.resolve();
      for (let i = 0; i < count; i++) {
        chain = chain.then(function () { return dec.decode({ frameIndex: i }); }).then(function (r) {
          const f = r.image;
          const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(f.displayWidth, f.displayHeight));
          const opts = scale < 1 ? { resizeWidth: Math.round(f.displayWidth * scale), resizeHeight: Math.round(f.displayHeight * scale) } : undefined;
          const dur = Math.max(20, (f.duration || 100000) / 1000);
          return createImageBitmap(f, opts).then(function (bmp) { f.close(); frames.push({ bmp: bmp, dur: dur }); });
        });
      }
      return chain.then(function () {
        rec.frames = frames;
        rec.total = frames.reduce(function (t, f) { return t + f.dur; }, 0);
        rec.t0 = performance.now();
        dec.close();
        notify();
      });
    }).catch(function () { try { dec.close(); } catch (e) { /* ignore */ } });
  }

  function getImage(src) {
    if (!src || typeof Image === 'undefined') return null;
    let rec = imageCache.get(src);
    if (!rec) {
      const img = new Image();
      rec = { img: img, ok: false, frames: null, total: 0, t0: 0 };
      img.onload = function () {
        rec.ok = img.naturalWidth > 0;
        notify();
        if (rec.ok) decodeFrames(src, rec);
      };
      img.src = src;
      imageCache.set(src, rec);
    }
    if (rec.frames && rec.total > 0) {
      let t = (performance.now() - rec.t0) % rec.total;
      for (let i = 0; i < rec.frames.length; i++) {
        if (t < rec.frames[i].dur) return rec.frames[i].bmp;
        t -= rec.frames[i].dur;
      }
      return rec.frames[0].bmp;
    }
    return rec.ok ? rec.img : null;
  }

  // True when a visible image layer is an animated GIF/WebP (the render loop must keep running).
  function hasMovingImage(c) {
    return layersOf(c).some(function (l) {
      if (!l || l.visible === false || l.kind !== 'image' || !l.src) return false;
      const rec = imageCache.get(l.src);
      return !!(rec && rec.frames && rec.frames.length > 1);
    });
  }

  function tinted(img, color) {
    let m = tintCache.get(img);
    if (!m) { m = new Map(); tintCache.set(img, m); }
    let c = m.get(color);
    if (!c) {
      c = document.createElement('canvas');
      c.width = img.naturalWidth || img.width;
      c.height = img.naturalHeight || img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = color;
      g.fillRect(0, 0, c.width, c.height);
      m.set(color, c);
    }
    return c;
  }

  function animValue(anim, cfg) {
    if (cfg.animation === 'none' || !anim || !anim.v) return 0;
    const id = cfg.animTrigger;
    const raw = (cfg.animMode === 'hold' ? anim.v[id] : anim.kick[id]) || 0;
    return cfg.animEase && cfg.animEase !== 'linear' ? ease(cfg.animEase, raw) : raw;
  }

  function drawStrokes(ctx, cfg, g) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = cfg.brush + g * 2;
    cfg.strokes.forEach(function (st) {
      ctx.beginPath();
      if (st.length === 1) {
        ctx.arc(st[0][0], st[0][1], ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.moveTo(st[0][0], st[0][1]);
      for (let i = 1; i < st.length; i++) ctx.lineTo(st[i][0], st[i][1]);
      ctx.stroke();
    });
  }

  function drawText(ctx, cfg, g) {
    if (!cfg.text) return;
    ctx.font = (cfg.bold ? '700 ' : '400 ') + cfg.fontSize + 'px ' + FONTS[cfg.font];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (g > 0) {
      ctx.lineWidth = g * 2;
      ctx.lineJoin = 'round';
      ctx.strokeText(cfg.text, 0, 0);
    }
    ctx.fillText(cfg.text, 0, 0);
  }

  function drawLayer(ctx, cfg, anim, cx, cy, zoom, opts) {
    const zoom0 = zoom || 1;
    if (!(opts && opts.noOffset)) {
      cx = Math.round(cx + cfg.offsetX * zoom0);
      cy = Math.round(cy + cfg.offsetY * zoom0);
    }
    const kind = cfg.kind || 'shape';
    const isShape = kind === 'shape';
    let gap = cfg.gap;
    let scale = 1;
    let color = cfg.color;
    let lineColor = cfg.outlineColor;
    if (opts && opts.rules) {
      for (let i = 0; i < opts.rules.length; i++) {
        const r = opts.rules[i];
        const t = ruleAmount(anim, r);
        if (t > 0) { color = mixHex(color, r.color, t); if (r.outline) lineColor = mixHex(lineColor, r.color, t); }
      }
    }
    let alpha = 1; // animation multiplier; the fill and outline opacities are applied per pass
    let spin = 0;
    const list = animsOf(cfg);
    for (let ai = 0; ai < list.length; ai++) {
      const an = list[ai];
      const av = animValue(anim, an);
      const I = an.animIntensity;
      switch (an.animation) {
        case 'expand': if (isShape) gap += av * I; else scale *= 1 + av * I / 30; break;
        case 'shrink': if (isShape) gap = Math.max(0, gap - av * I); else scale = Math.max(0.1, scale * (1 - av * I / 30)); break;
        case 'pulse': scale *= 1 + av * (I / 30); break;
        case 'flash': color = mixHex(color, invertHex(color), av); break;
        case 'spin': spin += av * I * 12; break;
        case 'fade': alpha *= 1 - av; break;
        case 'hide': alpha *= 1 - av; break;
        case 'show': alpha *= av; break;
      }
    }
    if (opts && opts.dynGap) {
      if (isShape) gap = Math.max(0, gap + opts.dynGap); else scale = Math.max(0.1, scale * (1 + opts.dynGap / 30));
    }
    alpha = Math.max(0, alpha);
    const fillA = Math.min(1, cfg.opacity * alpha);
    const lineA = Math.min(1, cfg.outlineOpacity * alpha);
    if (fillA <= 0.001 && (lineA <= 0.001 || !(cfg.outline && kind !== 'image'))) return;
    const o = cfg.outline && kind !== 'image' ? cfg.outlineThickness : 0;
    const rot = ((cfg.rotation + spin) * Math.PI) / 180 + (isShape && cfg.style === 'x' ? Math.PI / 4 : 0);
    const z = zoom0 * scale;

    const base = (ctx.getTransform && ctx.getTransform().a) || 1; // includes devicePixelRatio

    let img = null;
    if (kind === 'image') {
      img = getImage(cfg.src);
      if (!img) return;
      if (cfg.tint) img = tinted(img, color);
    }

    ctx.save();
    ctx.globalAlpha = fillA;
    if (cfg.blur > 0) ctx.filter = 'blur(' + cfg.blur * z * base + 'px)';
    ctx.translate(cx, cy);
    if (cfg.flipX || cfg.flipY) ctx.scale(cfg.flipX ? -1 : 1, cfg.flipY ? -1 : 1);
    ctx.scale(z, z);
    ctx.rotate(rot);
    for (let pass = o > 0 ? 0 : 1; pass < 2; pass++) {
      const g = pass === 0 ? o : 0;
      const paint = pass === 0 ? lineColor : color;
      ctx.globalAlpha = pass === 0 ? lineA : fillA;
      ctx.fillStyle = paint;
      ctx.strokeStyle = paint;
      if (pass === 1 && cfg.glow > 0) {
        ctx.shadowColor = color;
        ctx.shadowBlur = cfg.glow * z * base;
      }
      roundAmt = isShape ? Math.max(0, Math.min(1, (cfg.rounded || 0) / 100)) : 0;
      if (isShape) shape(ctx, cfg, gap, g);
      else if (kind === 'text') drawText(ctx, cfg, g);
      else if (kind === 'draw') drawStrokes(ctx, cfg, g);
      else if (img) {
        const w = cfg.imgSize;
        const h = (w * img.height) / img.width;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      }
    }
    ctx.restore();
  }

  // Binds a crosshair to a canvas (used by the overlay and the editor preview).
  function createController(canvas, opts) {
    opts = opts || {};
    let logical = opts.size || 600;
    let zoom = opts.zoom || 1;
    let minFrame = 0;
    const ctx = canvas.getContext('2d');
    let cfg = sanitizeDesign(null);
    const anim = newAnim();
    let raf = 0;
    let last = 0;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(logical * dpr);
      canvas.height = Math.round(logical * dpr);
      canvas.style.width = logical + 'px';
      canvas.style.height = logical + 'px';
    }

    function render() {
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(ctx, cfg, anim, Math.round(logical / 2), Math.round(logical / 2), zoom);
    }

    function tick(now) {
      raf = 0;
      if (minFrame && now - last < minFrame - 1.5) { raf = requestAnimationFrame(tick); return; }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const more = stepAnim(anim, cfg, dt);
      render();
      if (more || hasMovingImage(cfg)) schedule();
    }

    function schedule() {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }

    resize();
    render();
    onAssetLoad(function () { render(); if (hasMovingImage(cfg)) schedule(); });
    window.addEventListener('resize', function () { resize(); render(); });

    return {
      setConfig: function (c) { cfg = sanitizeDesign(c); render(); if (hasMovingImage(cfg)) schedule(); },
      setZoom: function (z) { zoom = z; render(); },
      setSize: function (px) {
        px = Math.max(16, Math.round(px));
        if (px === logical) return;
        logical = px;
        resize();
        render();
      },
      setFpsCap: function (fps) { minFrame = fps > 0 ? 1000 / fps : 0; },
      render: render,
      input: function (e) {
        if (!e || !hasAnimation(cfg)) return;
        if (!applyInput(anim, e)) return;
        schedule();
      }
    };
  }

  return {
    STYLES: STYLES,
    STYLE_LABELS: STYLE_LABELS,
    SHAPE_GROUPS: SHAPE_GROUPS,
    ANIMS: ANIMS,
    ANIM_LABELS: ANIM_LABELS,
    EASES: EASES,
    EASE_LABELS: EASE_LABELS,
    ease: ease,
    hasMovingImage: hasMovingImage,
    KINDS: KINDS,
    FONTS: FONTS,
    FONT_LABELS: FONT_LABELS,
    TRIGGER_IDS: TRIGGER_IDS,
    TRIGGER_LABELS: TRIGGER_LABELS,
    TRIGGER_DEFAULTS: TRIGGER_DEFAULTS,
    sanitizeTriggers: sanitizeTriggers,
    canonKey: canonKey,
    domKeyName: domKeyName,
    domMouseName: domMouseName,
    actionsFor: actionsFor,
    applyInput: applyInput,
    releaseAll: releaseAll,
    onAssetLoad: onAssetLoad,
    DEFAULTS: DEFAULTS,
    RANGES: RANGES,
    MAX_LAYERS: MAX_LAYERS,
    sanitize: sanitize,
    baseExtent: baseExtent,
    designRadius: designRadius,
    sanitizeDesign: sanitizeDesign,
    DEFAULT_DESIGN: DEFAULT_DESIGN,
    DYN_KEYS: DYN_KEYS,
    STATE_IDS: STATE_IDS,
    MAX_EXTRA_ANIMS: MAX_EXTRA_ANIMS,
    animsOf: animsOf,
    activeLayers: activeLayers,
    DYN_DEFAULT: DYN_DEFAULT,
    MAX_RULES: MAX_RULES,
    dynGap: dynGap,
    dynGrowth: dynGrowth,
    newLayer: newLayer,
    hasAnimation: hasAnimation,
    newAnim: newAnim,
    stepAnim: stepAnim,
    draw: draw,
    createController: createController
  };
});
