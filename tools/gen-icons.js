/* Generates icon-192.png / icon-512.png — dark rounded tile with a green barbell. Zero deps. */
'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixels) { // pixels: RGBA Buffer
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const bg = [13, 17, 23], green = [74, 222, 128], dark = [22, 132, 63];
  const S = size / 512; // design in 512 space
  const cornerR = 90 * S;
  const put = (x, y, c, a = 255) => {
    const i = (y * size + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = a;
  };
  const inRounded = (x, y) => {
    const r = cornerR, w = size;
    const cx = x < r ? r : x > w - r ? w - r : x;
    const cy = y < r ? r : y > w - r ? w - r : y;
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r || (x >= r && x <= w - r) || (y >= r && y <= w - r);
  };
  // bar geometry (512-space): horizontal bar y 236..276, plates at x 96..156 and 356..416 (y 146..366), inner plates 166..206 / 306..346 (y 176..336)
  const rects = [
    [70, 236, 442, 276, dark],    // bar
    [96, 146, 156, 366, green],   // outer plate L
    [356, 146, 416, 366, green],  // outer plate R
    [166, 176, 216, 336, green],  // inner plate L
    [296, 176, 346, 336, green],  // inner plate R
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inRounded(x, y)) { put(x, y, bg, 0); continue; }
      put(x, y, bg);
      const dx = x / S, dy = y / S;
      for (const [x1, y1, x2, y2, c] of rects) {
        if (dx >= x1 && dx <= x2 && dy >= y1 && dy <= y2) { put(x, y, c); break; }
      }
    }
  }
  return px;
}

const outDir = path.join(__dirname, '..', 'icons');
for (const size of [192, 512]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), png(size, draw(size)));
  console.log(`icon-${size}.png written`);
}
