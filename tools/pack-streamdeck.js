// Packs streamdeck/com.ezggco.ezsoundboard.sdPlugin into build/streamdeck/EZ-Soundboard.streamDeckPlugin
// (a .streamDeckPlugin is a zip with the .sdPlugin folder inside). Double-clicking it, or the
// "Install Stream Deck plugin" button in EZ Soundboard, installs it into the Stream Deck app.
// No dependencies: a tiny zip writer using Node's zlib.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const NAME = 'com.ezggco.ezsoundboard.sdPlugin';
const SRC = path.join(ROOT, 'streamdeck', NAME);
const OUT_DIR = path.join(ROOT, 'build', 'streamdeck');
const OUT = path.join(OUT_DIR, 'EZ-Soundboard.streamDeckPlugin');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  if (zlib.crc32) return zlib.crc32(buf) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.')) continue;
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

function zip(entries) {
  // Fixed timestamp (1 Jan 2020) so the same input always gives the same file.
  const dosTime = 0;
  const dosDate = ((2020 - 1980) << 9) | (1 << 5) | 1;
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
  const missing = [];
  const need = (p) => { if (!fs.existsSync(path.join(SRC, p))) missing.push(p); };
  need(manifest.CodePath);
  need(manifest.Icon + '.png');
  need(manifest.CategoryIcon + '.png');
  for (const a of manifest.Actions) {
    need(a.Icon + '.png');
    if (a.PropertyInspectorPath) need(a.PropertyInspectorPath);
    for (const s of a.States) need(s.Image + '.png');
  }
  if (missing.length) {
    console.error('Stream Deck plugin is missing:', missing.join(', '));
    process.exit(1);
  }
  const files = walk(SRC);
  const entries = files.map((rel) => ({ name: NAME + '/' + rel, data: fs.readFileSync(path.join(SRC, rel)) }));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, zip(entries));
  console.log(`packed ${files.length} files → ${path.relative(ROOT, OUT)} (${fs.statSync(OUT).size} bytes)`);
}

main();
