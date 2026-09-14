/**
 * Renders the PNG brand assets in `public/` from code.
 *
 *   node scripts/generate-assets.mjs
 *
 * The outputs are committed so the build needs no image toolchain. Everything
 * is drawn from primitives (rounded rectangles, capsules, rings) and a small
 * stroke alphabet, which keeps each file a few kilobytes instead of shipping
 * a design export into the repo.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

const INK = [0x2c, 0x3d, 0x2c];
const LEAF = [0x37, 0x4b, 0x37];
const LEAF_DEEP = [0x2a, 0x3a, 0x2a];
const SPROUT = [0xd8, 0xed, 0xb8];
const PAPER = [0xf3, 0xf6, 0xef];

/* --------------------------------------------------------------- raster ops */

function createCanvas(width, height) {
  return { width, height, data: new Float64Array(width * height * 4) };
}

/** Source-over composite of `color` at `alpha` onto one pixel. */
function blend(canvas, x, y, color, alpha) {
  if (alpha <= 0) return;
  const i = (y * canvas.width + x) * 4;
  const d = canvas.data;
  const out = alpha + d[i + 3] * (1 - alpha);
  if (out <= 0) return;
  for (let c = 0; c < 3; c++)
    d[i + c] = (color[c] * alpha + d[i + c] * d[i + 3] * (1 - alpha)) / out;
  d[i + 3] = out;
}

const SAMPLES = 4;

/** Paint `shape` (an inside-test) with 4x4 supersampled coverage. */
function paint(canvas, shape, color, box, alpha = 1) {
  const x0 = Math.max(0, Math.floor(box[0]));
  const y0 = Math.max(0, Math.floor(box[1]));
  const x1 = Math.min(canvas.width - 1, Math.ceil(box[2]));
  const y1 = Math.min(canvas.height - 1, Math.ceil(box[3]));
  const step = 1 / SAMPLES;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++)
        for (let sx = 0; sx < SAMPLES; sx++)
          if (shape(x + (sx + 0.5) * step, y + (sy + 0.5) * step)) hits++;
      if (hits) blend(canvas, x, y, color, (hits / (SAMPLES * SAMPLES)) * alpha);
    }
  }
}

const roundedRect = (x, y, w, h, r) => {
  const rx = Math.min(r, w / 2);
  const ry = Math.min(r, h / 2);
  return (px, py) => {
    if (px < x || py < y || px > x + w || py > y + h) return false;
    const dx = Math.max(x + rx - px, px - (x + w - rx), 0);
    const dy = Math.max(y + ry - py, py - (y + h - ry), 0);
    return (dx / rx) ** 2 + (dy / ry) ** 2 <= 1 || (dx === 0 && dy === 0);
  };
};

const ellipse = (cx, cy, rx, ry) => (px, py) =>
  ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 <= 1;

function segmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

const capsule = (x1, y1, x2, y2, r) => (px, py) =>
  segmentDistance(px, py, x1, y1, x2, y2) <= r;

const capsuleBox = (x1, y1, x2, y2, r) => [
  Math.min(x1, x2) - r - 1,
  Math.min(y1, y2) - r - 1,
  Math.max(x1, x2) + r + 1,
  Math.max(y1, y2) + r + 1,
];

/** Elliptical outline of thickness `width`, so round glyphs fill the grid. */
const ellipseRing = (cx, cy, rx, ry, width) => {
  const outer = ellipse(cx, cy, rx + width / 2, ry + width / 2);
  const inner = ellipse(cx, cy, Math.max(rx - width / 2, 0.01), Math.max(ry - width / 2, 0.01));
  return (px, py) => outer(px, py) && !inner(px, py);
};

function strokePath(canvas, points, color, r, closed = false) {
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    paint(canvas, capsule(x1, y1, x2, y2, r), color, capsuleBox(x1, y1, x2, y2, r));
  }
  if (closed && points.length > 2) {
    const [x1, y1] = points[points.length - 1];
    const [x2, y2] = points[0];
    paint(canvas, capsule(x1, y1, x2, y2, r), color, capsuleBox(x1, y1, x2, y2, r));
  }
}

/* ------------------------------------------------------------- stroke font */

/**
 * Each glyph is a list of polylines on a 3-wide by 5-tall grid, plus optional
 * rings. Only the characters used by the OG copy are defined; `draw` throws on
 * anything else so a typo cannot silently render a blank.
 */
const GLYPHS = {
  " ": { strokes: [] },
  ".": { strokes: [], dots: [[1.5, 4.7]] },
  "-": { strokes: [[[0.4, 2.5], [2.6, 2.5]]] },
  A: { strokes: [[[0, 5], [1.5, 0], [3, 5]], [[0.75, 2.9], [2.25, 2.9]]] },
  B: { strokes: [[[0, 0], [0, 5]], [[0, 0], [2.1, 0], [2.9, 0.8], [2.1, 2.4], [0, 2.4]], [[2.1, 2.4], [3, 3.4], [2.2, 5], [0, 5]]] },
  C: { strokes: [[[3, 0.9], [2, 0], [1, 0], [0, 1.2], [0, 3.8], [1, 5], [2, 5], [3, 4.1]]] },
  D: { strokes: [[[0, 0], [0, 5]], [[0, 0], [1.6, 0], [3, 1.5], [3, 3.5], [1.6, 5], [0, 5]]] },
  E: { strokes: [[[3, 0], [0, 0], [0, 5], [3, 5]], [[0, 2.5], [2.4, 2.5]]] },
  F: { strokes: [[[3, 0], [0, 0], [0, 5]], [[0, 2.4], [2.3, 2.4]]] },
  G: { strokes: [[[3, 0.9], [2, 0], [1, 0], [0, 1.2], [0, 3.8], [1, 5], [2, 5], [3, 4.1], [3, 2.9], [1.8, 2.9]]] },
  H: { strokes: [[[0, 0], [0, 5]], [[3, 0], [3, 5]], [[0, 2.5], [3, 2.5]]] },
  I: { strokes: [[[1.5, 0], [1.5, 5]]] },
  J: { strokes: [[[3, 0], [3, 3.8], [2, 5], [1, 5], [0, 3.9]]] },
  K: { strokes: [[[0, 0], [0, 5]], [[3, 0], [0.2, 2.7]], [[1.1, 2], [3, 5]]] },
  L: { strokes: [[[0, 0], [0, 5], [3, 5]]] },
  M: { strokes: [[[0, 5], [0, 0], [1.5, 2.4], [3, 0], [3, 5]]] },
  N: { strokes: [[[0, 5], [0, 0], [3, 5], [3, 0]]] },
  O: { strokes: [], rings: [[1.5, 2.5, 1.5, 2.5]] },
  0: { strokes: [], rings: [[1.5, 2.5, 1.3, 2.5]] },
  1: { strokes: [[[0.5, 0.9], [1.5, 0], [1.5, 5]], [[0.5, 5], [2.5, 5]]] },
  2: { strokes: [[[0, 1], [1, 0], [2.1, 0], [3, 1.2], [0, 5], [3, 5]]] },
  3: { strokes: [[[0, 0.6], [1, 0], [2.2, 0], [3, 1.1], [2, 2.4], [1.1, 2.4]], [[2, 2.4], [3, 3.6], [2.2, 5], [1, 5], [0, 4.4]]] },
  4: { strokes: [[[2.4, 5], [2.4, 0], [0, 3.5], [3, 3.5]]] },
  5: { strokes: [[[3, 0], [0, 0], [0, 2.2], [2, 2], [3, 3.3], [2.2, 5], [1, 5], [0, 4.4]]] },
  6: { strokes: [[[2.8, 0.4], [1.7, 0], [0.6, 0.6], [0, 2.4], [0, 4], [1.2, 5], [2.2, 4.9], [3, 3.8], [2.2, 2.6], [1, 2.5], [0, 3.2]]] },
  7: { strokes: [[[0, 0], [3, 0], [1.2, 5]]] },
  8: { strokes: [], rings: [[1.5, 1.2, 1.2, 1.2], [1.5, 3.6, 1.45, 1.4]] },
  9: { strokes: [[[0.2, 4.6], [1.3, 5], [2.4, 4.4], [3, 2.6], [3, 1], [1.8, 0], [0.8, 0.1], [0, 1.2], [0.8, 2.4], [2, 2.5], [3, 1.8]]] },
  P: { strokes: [[[0, 5], [0, 0], [2.1, 0], [3, 1.3], [2.1, 2.6], [0, 2.6]]] },
  Q: { strokes: [[[1.9, 3.7], [3.1, 5.2]]], rings: [[1.5, 2.5, 1.5, 2.5]] },
  R: { strokes: [[[0, 5], [0, 0], [2.1, 0], [3, 1.3], [2.1, 2.6], [0, 2.6]], [[1.5, 2.6], [3, 5]]] },
  S: { strokes: [[[3, 0.8], [2, 0], [1, 0], [0, 1], [0.8, 2.3], [2.2, 2.7], [3, 3.9], [2, 5], [1, 5], [0, 4.2]]] },
  T: { strokes: [[[0, 0], [3, 0]], [[1.5, 0], [1.5, 5]]] },
  U: { strokes: [[[0, 0], [0, 3.7], [1.2, 5], [1.8, 5], [3, 3.7], [3, 0]]] },
  V: { strokes: [[[0, 0], [1.5, 5], [3, 0]]] },
  W: { strokes: [[[0, 0], [0.75, 5], [1.5, 2], [2.25, 5], [3, 0]]] },
  X: { strokes: [[[0, 0], [3, 5]], [[3, 0], [0, 5]]] },
  Y: { strokes: [[[0, 0], [1.5, 2.6], [3, 0]], [[1.5, 2.6], [1.5, 5]]] },
  Z: { strokes: [[[0, 0], [3, 0], [0, 5], [3, 5]]] },
};

function textWidth(text, size, tracking) {
  if (!text.length) return 0;
  return text.length * (size * 0.6 + tracking) - tracking;
}

/**
 * Largest size at or below `maxSize` whose rendered width fits `maxWidth`.
 * Tracking scales with the size so letterfit stays constant.
 */
function fitSize(text, maxWidth, maxSize, trackingRatio) {
  const width = textWidth(text, 1, trackingRatio);
  return Math.min(maxSize, maxWidth / width);
}

function drawText(canvas, text, x, y, { size, weight, color, tracking = 0 }) {
  const unit = size / 5;
  const advance = size * 0.6 + tracking;
  let cursor = x;
  for (const char of text.toUpperCase()) {
    const glyph = GLYPHS[char];
    if (!glyph) throw new Error(`No glyph for ${JSON.stringify(char)}`);
    const at = (gx, gy) => [cursor + gx * unit, y + gy * unit];
    for (const stroke of glyph.strokes)
      strokePath(canvas, stroke.map(([gx, gy]) => at(gx, gy)), color, weight / 2);
    for (const [cx, cy, rx, ry] of glyph.rings ?? []) {
      const [px, py] = at(cx, cy);
      const ex = rx * unit;
      const ey = ry * unit;
      paint(canvas, ellipseRing(px, py, ex, ey, weight), color, [
        px - ex - weight, py - ey - weight, px + ex + weight, py + ey + weight,
      ]);
    }
    for (const [dx, dy] of glyph.dots ?? []) {
      const [px, py] = at(dx, dy);
      paint(canvas, ellipse(px, py, weight * 0.62, weight * 0.62), color, [
        px - weight, py - weight, px + weight, py + weight,
      ]);
    }
    cursor += advance;
  }
}

/* ------------------------------------------------------------------ brand */

/** The fork-and-knife mark, expressed in the same 24-unit box as the UI icon. */
function drawUtensils(canvas, originX, originY, scale, color, weight) {
  const p = (x, y) => [originX + x * scale, originY + y * scale];
  const r = (weight * scale) / 2;
  strokePath(canvas, [p(4, 3), p(4, 8), p(5.6, 9.6), p(7, 10), p(8.4, 9.6), p(10, 8), p(10, 3)], color, r);
  strokePath(canvas, [p(7, 3), p(7, 21)], color, r);
  strokePath(canvas, [p(18, 3), p(16.4, 5.2), p(16.4, 8.8), p(18, 11), p(20, 11)], color, r);
  strokePath(canvas, [p(20, 3), p(20, 21)], color, r);
}

/** Square app icon: green tile, sprout-coloured blob, utensils mark. */
function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const u = size / 64;
  paint(canvas, roundedRect(0, 0, size, size, 15 * u), LEAF, [0, 0, size, size]);
  paint(
    canvas,
    roundedRect(14 * u, 10 * u, 36 * u, 44 * u, 18 * u),
    SPROUT,
    [13 * u, 9 * u, 51 * u, 55 * u],
  );
  drawUtensils(canvas, 14.6 * u, 14.6 * u, 1.45 * u, INK, 2);
  return canvas;
}

/** 1200x630 social card: brand mark, wordmark, tagline, honesty strip. */
function drawOpenGraph() {
  const width = 1200;
  const height = 630;
  const canvas = createCanvas(width, height);
  paint(canvas, () => true, LEAF, [0, 0, width, height]);

  // Soft depth: two large translucent discs behind the card.
  paint(canvas, ellipse(1080, 90, 320, 320), LEAF_DEEP, [740, -260, 1420, 430], 0.55);
  paint(canvas, ellipse(120, 620, 280, 280), LEAF_DEEP, [-180, 320, 420, 920], 0.5);

  const card = [64, 56, width - 128, height - 112];
  paint(canvas, roundedRect(card[0], card[1], card[2], card[3], 44), PAPER, [
    card[0] - 2, card[1] - 2, card[0] + card[2] + 2, card[1] + card[3] + 2,
  ]);

  // Brand mark.
  const markX = 116;
  const markY = 116;
  paint(canvas, roundedRect(markX, markY, 116, 116, 30), LEAF, [
    markX - 2, markY - 2, markX + 118, markY + 118,
  ]);
  paint(canvas, roundedRect(markX + 25, markY + 18, 66, 80, 33), SPROUT, [
    markX + 20, markY + 14, markX + 96, markY + 102,
  ]);
  drawUtensils(canvas, markX + 26.5, markY + 26.5, 2.63, INK, 2);

  const wordmark = "halalfood.world";
  const wordmarkSize = fitSize(wordmark, 620, 54, 0.135);
  drawText(canvas, wordmark, 262, 142, {
    size: wordmarkSize,
    weight: wordmarkSize * 0.21,
    color: INK,
    tracking: wordmarkSize * 0.135,
  });

  const lines = ["FIND HALAL FOOD", "ANYWHERE IN THE WORLD"];
  const taglineSize = Math.min(
    ...lines.map((line) => fitSize(line, 968, 74, 0.145)),
  );
  lines.forEach((line, index) => {
    drawText(canvas, line, 116, 286 + index * taglineSize * 1.42, {
      size: taglineSize,
      weight: taglineSize * 0.2,
      color: LEAF,
      tracking: taglineSize * 0.145,
    });
  });

  // Honesty strip — the same disclaimer the product shows on every pin.
  const strip = "NEARLY 12000 HALAL PLACES - PIN LOCATIONS ARE APPROXIMATE";
  const stripY = 506;
  const stripHeight = 64;
  paint(canvas, roundedRect(116, stripY, width - 232, stripHeight, stripHeight / 2), [0xff, 0xf8, 0xe8], [
    114, stripY - 2, width - 114, stripY + stripHeight + 2,
  ]);
  const stripSize = fitSize(strip, 968 - 96, 24, 0.28);
  drawText(canvas, strip, (width - textWidth(strip, stripSize, stripSize * 0.28)) / 2, stripY + (stripHeight - stripSize) / 2, {
    size: stripSize,
    weight: stripSize * 0.22,
    color: [0x6b, 0x56, 0x24],
    tracking: stripSize * 0.28,
  });
  return canvas;
}

/* ---------------------------------------------------------------- encoding */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([head, typed, crc]);
}

function encodePng(canvas) {
  const { width, height, data } = canvas;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++)
        raw[offset++] = Math.max(0, Math.min(255, Math.round(data[i + c])));
      raw[offset++] = Math.max(0, Math.min(255, Math.round(data[i + 3] * 255)));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const assets = [
  ["favicon-32.png", drawIcon(32)],
  ["apple-touch-icon.png", drawIcon(180)],
  ["icon-512.png", drawIcon(512)],
  ["og.png", drawOpenGraph()],
];

for (const [name, canvas] of assets) {
  const bytes = encodePng(canvas);
  writeFileSync(path.join(OUT, name), bytes);
  console.log(`${name}: ${canvas.width}x${canvas.height}, ${(bytes.length / 1024).toFixed(1)} kB`);
}
