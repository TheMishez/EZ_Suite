/*
 * CS2 crosshair share-code decoder (new "CS..." format, plus legacy "CSGO-xxxxx-..." v1/v3/v4),
 * plus a mapper from the decoded CS2 fields to this app's crosshair config.
 * Byte layouts follow the public format notes in akiver/csgo-sharecode (MIT).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShareCode = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DICT = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789';
  const STYLE_NAMES = [
    'Dynamic Cross', 'Dynamic Circle', 'Dynamic Cross (Legacy)', 'Static Circle', 'Static Cross',
    'Static Cross (Shot Feedback)', 'Dot Only', 'Dynamic Quad', 'Static Square', 'Static Quad'
  ];

  const s8 = (b) => (b > 127 ? b - 256 : b);

  function toBytes(body, length) {
    let n = 0n;
    const chars = body.split('').reverse();
    for (const c of chars) {
      const i = DICT.indexOf(c);
      if (i < 0) throw new Error('Invalid character "' + c + '" in code');
      n = n * 57n + BigInt(i);
    }
    const bytes = new Array(length).fill(0);
    for (let i = length - 1; i >= 0; i--) {
      bytes[i] = Number(n & 0xffn);
      n >>= 8n;
    }
    if (n !== 0n) throw new Error('Code is too long');
    return bytes;
  }

  function decode(input) {
    const raw = String(input || '').trim();
    let bytes;
    let kind;
    if (/^CSGO(-[A-Za-z0-9]{5}){5}$/.test(raw)) {
      bytes = toBytes(raw.replace(/^CSGO/, '').replace(/-/g, ''), 18);
      kind = 'legacy';
    } else if (/^CS[A-Za-z0-9]{44}$/.test(raw)) {
      bytes = toBytes(raw.slice(2), 32);
      kind = 'cs2';
    } else {
      throw new Error('Not a CS2 crosshair code');
    }
    let sum = 0;
    for (let i = 1; i < bytes.length; i++) sum += bytes[i];
    if (sum % 256 !== bytes[0]) throw new Error('Code failed its checksum (typo or corrupted)');

    const version = bytes[1];
    const out = { format: kind + '-v' + version, version: version, splitDistance: 0 };

    if (kind === 'legacy' && version === 1) {
      out.gap = s8(bytes[2]) / 10;
      out.outlineThickness = bytes[3] / 2;
      out.outlineEnabled = !!(bytes[10] & 8);
      out.rgb = [bytes[4], bytes[5], bytes[6]];
      out.alpha = bytes[7];
      out.colorMode = bytes[10] & 7;
      out.thickness = bytes[12] / 10;
      out.style = (bytes[13] >> 1) & 7;
      out.dot = !!(bytes[13] & 16);
      out.tStyle = !!(bytes[13] & 128);
      out.length = bytes[14] / 10;
      out.units = 'game'; // tenths of game units: scales with screen height
    } else if (kind === 'legacy' && (version === 3 || version === 4)) {
      out.style = bytes[2] & 15;
      out.dot = !!(bytes[2] & 64);
      out.tStyle = !!(bytes[2] & 128);
      out.rgb = [bytes[3], bytes[4], bytes[5]];
      out.alpha = bytes[6];
      out.gap = s8(bytes[7]);
      out.length = bytes[8];
      const f = (bytes[10] | (bytes[11] << 8) | (bytes[12] << 16) | (bytes[13] << 24)) >>> 0;
      out.thickness = (f >>> 23) & 31;
      if (version === 3) out.outlineEnabled = !!(bytes[2] & 32);
      else out.outlineEnabled = ((f >>> 28) & 3) !== 0;
      out.outlineThickness = out.outlineEnabled ? 1 : 0;
      out.screenHeight = bytes[14] | (bytes[15] << 8);
      out.colorMode = 5;
      out.units = 'px';
    } else if (kind === 'cs2' && version === 1) {
      const u16 = (i) => bytes[i] | (bytes[i + 1] << 8);
      out.screenHeight = u16(2) || 1080;
      out.style = 4; // the new format's style bits are not fully mapped; treat as a static cross
      out.dot = !!(bytes[4] & 1);
      out.tStyle = false;
      out.rgb = [bytes[5], bytes[6], bytes[7]];
      out.alpha = bytes[8];
      out.outlineRgb = [bytes[9], bytes[10], bytes[11]];
      out.outlineAlpha = bytes[12];
      out.thickness = bytes[13] & 63;
      out.outlineEnabled = (bytes[13] >> 6) !== 0;
      out.outlineThickness = 1;
      out.gap = (u16(14) << 16) >> 16;
      out.length = bytes[16];
      out.spreadLimit = bytes[17];
      out.splitDistance = bytes[18];
      const f = (bytes[19] | (bytes[20] << 8) | (bytes[21] << 16)) >>> 0;
      out.innerSplitAlpha = (f & 127) / 50;
      out.outerSplitAlpha = 0.3 + ((f >>> 7) & 127) / 50;
      out.splitSizeRatio = ((f >>> 14) & 127) / 50;
      out.scopeDotColor = !!((f >>> 21) & 1);
      out.scopeDotScale = 0.1 + bytes[22] / 100;
      out.colorMode = 5;
      out.units = 'cs2'; // gap / length / thickness are pixels at screenHeight
    } else {
      throw new Error('Unsupported crosshair code version (' + kind + ' v' + version + ')');
    }
    out.styleName = STYLE_NAMES[out.style] || 'Style ' + out.style;
    return out;
  }

  const PRESET_COLORS = [
    [250, 50, 50], // 0 red
    [50, 250, 50], // 1 green
    [250, 250, 50], // 2 yellow
    [50, 50, 250], // 3 blue
    [50, 250, 250] // 4 cyan
  ];

  function hex2(n) {
    return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  }

  function rgbOf(d) {
    if (d.colorMode >= 0 && d.colorMode <= 4) return PRESET_COLORS[d.colorMode];
    return d.rgb;
  }

  // Maps decoded CS2 fields to this app's config.
  //   opts.screenHeight: height (physical px) the game runs at; default 1080
  //   opts.dpr: devicePixelRatio of the display that shows the overlay; default 1
  //   opts.scale: manual size calibration multiplier; default 1
  // Console values (size/gap/thickness) are "game units"; 1 unit = screenHeight/600 physical px.
  function toConfig(d, opts) {
    opts = opts || {};
    const gameH = opts.screenHeight || 1080;
    const dpr = opts.dpr || 1;
    const extra = opts.scale || 1;
    // Pixel-based formats store console values at the height they were authored at.
    const toUnits = (v) => (d.units === 'game' ? v : (v * 1080) / (d.screenHeight || 1080));
    // The game rounds to whole physical pixels, so do the same, then convert to overlay (DIP) units.
    const px = (units) => Math.round(units * (gameH / 600) * extra) / dpr;
    const rgb = rgbOf(d);

    if (d.units === 'cs2') {
      // New-format values are pixels at the code's screen height; scale to the height the game runs at.
      const k = ((gameH / (d.screenHeight || 1080)) * extra) / dpr;
      const q = (v) => Math.round(v * k * dpr) / dpr;
      let inner = d.gap * k;
      let arm = d.length * k;
      if (inner < 0) { arm = Math.max(-inner, inner + arm); inner = 0; }
      const thick = Math.max(1, q(d.thickness));
      const cfg2 = {
        style: 'cross',
        color: '#' + hex2(rgb[0]) + hex2(rgb[1]) + hex2(rgb[2]),
        opacity: d.alpha === undefined ? 1 : Math.max(0.1, d.alpha / 255),
        size: Math.max(0, q(arm)),
        gap: Math.max(0, q(inner)),
        thickness: thick,
        rotation: 0,
        tStyle: !!d.tStyle,
        dot: !!d.dot,
        dotSize: thick,
        outline: !!d.outlineEnabled,
        outlineColor: d.outlineRgb ? '#' + hex2(d.outlineRgb[0]) + hex2(d.outlineRgb[1]) + hex2(d.outlineRgb[2]) : '#000000',
        outlineOpacity: d.outlineAlpha === undefined ? 1 : d.outlineAlpha / 255,
        outlineThickness: d.outlineEnabled ? Math.max(1, q(1)) : 0,
        offsetX: 0,
        offsetY: 0,
        animation: 'none'
      };
      return cfg2;
    }

    const length = toUnits(d.length);
    const thickness = toUnits(d.thickness);
    let inner = toUnits(d.gap) + 4; // arms start (gap + 4) units from the center
    let arm = length;
    if (inner < 0) {
      // Opposite arms overlap through the center: the union reaches max(|inner|, inner + length).
      arm = Math.max(-inner, inner + length);
      inner = 0;
    }
    arm = Math.max(0, arm);

    const cfg = {
      style: 'cross',
      color: '#' + hex2(rgb[0]) + hex2(rgb[1]) + hex2(rgb[2]),
      opacity: d.alpha === undefined ? 1 : Math.max(0.1, d.alpha / 255),
      size: px(arm),
      gap: px(inner),
      thickness: Math.max(1, px(thickness)),
      rotation: 0,
      tStyle: !!d.tStyle,
      dot: !!d.dot,
      dotSize: Math.max(1, px(Math.max(thickness, 1))),
      outline: !!d.outlineEnabled,
      outlineOpacity: d.outlineAlpha === undefined ? 1 : d.outlineAlpha / 255,
      outlineColor: d.outlineRgb ? '#' + hex2(d.outlineRgb[0]) + hex2(d.outlineRgb[1]) + hex2(d.outlineRgb[2]) : '#000000',
      outlineThickness: d.outlineEnabled ? Math.max(1, px(Math.max(d.outlineThickness, 1))) : 0,
      offsetX: 0,
      offsetY: 0,
      animation: 'none'
    };
    if (d.style === 1 || d.style === 3) cfg.style = 'circle';
    else if (d.style === 8) cfg.style = 'square';
    else if (d.style === 6) cfg.style = 'dot';
    return cfg;
  }

  const clampI = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
  const parseHex = (h) => {
    const m = /^#?([0-9a-f]{6})/i.exec(h || '');
    const n = m ? parseInt(m[1], 16) : 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  // Reverse of toConfig for one plain cross layer. Returns fields in console units (whole numbers).
  function fromConfig(layer, opts) {
    opts = opts || {};
    const gameH = opts.screenHeight || 1080;
    const dpr = opts.dpr || 1;
    const extra = opts.scale || 1;
    const unit = (px) => (px * dpr) / extra; // pixels at the game's screen height
    return {
      screenHeight: gameH,
      rgb: parseHex(layer.color),
      alpha: clampI((layer.opacity === undefined ? 1 : layer.opacity) * 255, 0, 255),
      outlineEnabled: !!layer.outline,
      outlineRgb: parseHex(layer.outlineColor),
      outlineAlpha: clampI((layer.outlineOpacity === undefined ? 1 : layer.outlineOpacity) * 255, 0, 255),
      thickness: clampI(unit(layer.thickness || 1), 1, 63),
      gap: clampI(unit(layer.gap || 0), -32768, 32767),
      length: clampI(unit(layer.size || 0), 0, 255),
      dot: !!layer.dot,
      tStyle: !!layer.tStyle
    };
  }

  function encode(f) {
    const b = new Array(32).fill(0);
    b[1] = 1;
    b[2] = f.screenHeight & 255; b[3] = (f.screenHeight >> 8) & 255;
    b[4] = 4 | (f.dot ? 1 : 0);
    b[5] = f.rgb[0]; b[6] = f.rgb[1]; b[7] = f.rgb[2]; b[8] = f.alpha;
    const o = f.outlineRgb || [0, 0, 0];
    b[9] = o[0]; b[10] = o[1]; b[11] = o[2]; b[12] = f.outlineAlpha === undefined ? 255 : f.outlineAlpha;
    b[13] = (f.thickness & 63) | ((f.outlineEnabled ? 1 : 0) << 6);
    b[14] = f.gap & 255; b[15] = (f.gap >> 8) & 255;
    b[16] = f.length;
    b[17] = 255;
    b[18] = 7;
    const fld = 50 | (10 << 7) | (25 << 14); // inner 1.0, outer 0.5, ratio 0.5
    b[19] = fld & 255; b[20] = (fld >> 8) & 255; b[21] = (fld >> 16) & 255;
    b[22] = 90;
    let sum = 0;
    for (let i = 1; i < 32; i++) sum += b[i];
    b[0] = sum % 256;
    let n = 0n;
    for (const x of b) n = (n << 8n) | BigInt(x);
    let s = '';
    for (let i = 0; i < 44; i++) { s += DICT[Number(n % 57n)]; n /= 57n; }
    return 'CS' + s;
  }

  function toConsole(f) {
    const o = f.outlineRgb || [0, 0, 0];
    return [
      'cl_crosshairstyle 4',
      'cl_crosshaircolor_r ' + f.rgb[0], 'cl_crosshaircolor_g ' + f.rgb[1], 'cl_crosshaircolor_b ' + f.rgb[2],
      'cl_crosshaircolor_a ' + f.alpha,
      'cl_crosshairdot ' + (f.dot ? 1 : 0),
      'cl_crosshair_screen_height ' + f.screenHeight,
      'cl_crosshair_gap ' + f.gap, 'cl_crosshair_length ' + f.length, 'cl_crosshair_thickness ' + f.thickness,
      'cl_crosshair_drawoutline ' + (f.outlineEnabled ? 1 : 0),
      'cl_crosshairoutline_r ' + o[0], 'cl_crosshairoutline_g ' + o[1], 'cl_crosshairoutline_b ' + o[2],
      'cl_crosshairoutline_a ' + (f.outlineAlpha === undefined ? 255 : f.outlineAlpha),
      'cl_crosshair_t ' + (f.tStyle ? 1 : 0)
    ].join('; ');
  }

  return { decode: decode, toConfig: toConfig, fromConfig: fromConfig, encode: encode, toConsole: toConsole, STYLE_NAMES: STYLE_NAMES, DICT: DICT };
});
