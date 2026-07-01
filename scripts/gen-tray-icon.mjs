#!/usr/bin/env node
/**
 * Generates assets/tray-icon.png and assets/tray-icon@2x.png using only
 * Node.js built-ins (zlib for deflate, fs for writing).
 *
 * Design: filled blue circle (#3b82f6) with a white clock face (two hands
 * and a circle outline) on a transparent background.
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { deflateSync } from 'zlib';

// CRC32 lookup table
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const tag = Buffer.from(type, 'ascii');
  const chk = Buffer.alloc(4); chk.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([len, tag, data, chk]);
}

function makePng(size) {
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  // Raw scanlines: filter byte (0) + size*4 bytes per row
  const raw = Buffer.alloc((1 + size * 4) * size, 0);
  const cx = size / 2, cy = size / 2;
  const outerR = size * 0.42;
  const rimR = outerR * 0.88;     // inner edge of circle rim
  const handW = outerR * 0.08;    // half-width of clock hands

  for (let y = 0; y < size; y++) {
    const base = y * (1 + size * 4);
    raw[base] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const px = base + 1 + x * 4;
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > outerR) continue; // transparent

      // Blue fill
      raw[px] = 0x3b; raw[px + 1] = 0x82; raw[px + 2] = 0xf6; raw[px + 3] = 255;

      // White overlays (clock elements)
      const white = () => { raw[px] = 255; raw[px + 1] = 255; raw[px + 2] = 255; raw[px + 3] = 255; };

      // Rim ring
      if (dist > rimR) { white(); continue; }

      // Hour hand: 12 o'clock direction (up), length ~45% of radius
      // vector: (0, -1), so points with small |dx| and -rimR*0.45 < dy < 0
      if (Math.abs(dx) < handW && dy < 0 && dy > -outerR * 0.42) { white(); continue; }

      // Minute hand: 3 o'clock direction (right), length ~35% of radius
      if (Math.abs(dy) < handW && dx > 0 && dx < outerR * 0.35) { white(); continue; }

      // Center dot
      if (dist < outerR * 0.1) { white(); }
    }
  }

  const idat = deflateSync(raw, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

if (!existsSync('assets')) mkdirSync('assets', { recursive: true });
writeFileSync('assets/tray-icon.png', makePng(32));
writeFileSync('assets/tray-icon@2x.png', makePng(64));
console.log('Generated assets/tray-icon.png (32x32) and assets/tray-icon@2x.png (64x64)');
