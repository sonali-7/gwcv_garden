/**
 * Finds garden beds in a simple drawing, with no AI and no network.
 *
 * What it understands:
 * - beds drawn as closed outlines (pen, pencil, marker) on light paper
 * - beds drawn as solid blocks of color
 * - an optional big outer box for the garden's edge, which sets the scale
 * - L-shaped (or stepped) beds, which become two or three rectangles
 * Writing inside or around the boxes is ignored here. Labels are read separately.
 */

export type Raster = { width: number; height: number; data: Uint8ClampedArray | Uint8Array };
export type Rect = { x: number; y: number; w: number; h: number };
export type DetectedBed = {
  rect: Rect;
  source: "outline" | "fill";
  /** Beds split from one L-shaped drawing share a group and number their parts. */
  group: number;
  part: number;
  parts: number;
  color: string | null;
};
export type Detection = { width: number; height: number; frame: Rect; frameFromBorder: boolean; beds: DetectedBed[] };
export type DetectOptions = { sensitivity?: number };

type Region = { area: number; minX: number; minY: number; maxX: number; maxY: number; rowMin: Int32Array; rowMax: Int32Array };

/** 0 = only very dark lines count as ink, 1 = faint pencil counts too. */
export function detectSketch(img: Raster, options: DetectOptions = {}): Detection {
  const { width: W, height: H, data } = img;
  const N = W * H;
  const sensitivity = Math.min(1, Math.max(0, options.sensitivity ?? 0.5));
  const lum = new Float32Array(N);
  const sat = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3] / 255;
    // Transparent pixels count as white paper.
    const rr = r * a + 255 * (1 - a);
    const gg = g * a + 255 * (1 - a);
    const bb = b * a + 255 * (1 - a);
    lum[i] = 0.299 * rr + 0.587 * gg + 0.114 * bb;
    sat[i] = Math.max(rr, gg, bb) - Math.min(rr, gg, bb);
  }

  // Compare each pixel with its neighbourhood, so shadows across a photo don't count as ink.
  const local = boxMean(lum, W, H, Math.max(4, Math.round(Math.min(W, H) / 12)));
  const delta = 55 - sensitivity * 40; // 35 at default, 15..55 across the slider
  const paperSat = percentile(sat, 0.5);
  const colorful = new Uint8Array(N);
  const ink = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const isColor = sat[i] > Math.max(55, paperSat + 40) && lum[i] < 245;
    colorful[i] = isColor ? 1 : 0;
    ink[i] = isColor || lum[i] < local[i] - delta || lum[i] < 70 ? 1 : 0;
  }

  // Thicken lines a little so small gaps at hand-drawn corners close up.
  const r = Math.max(1, Math.round(Math.min(W, H) / 220));
  const thick = dilate(ink, W, H, r);

  // Everything light that can be reached from the edge of the picture is "outside".
  const outside = new Uint8Array(N);
  const queue = new Int32Array(N);
  let head = 0;
  let tail = 0;
  const push = (i: number) => {
    if (!thick[i] && !outside[i]) {
      outside[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < W; x++) {
    push(x);
    push((H - 1) * W + x);
  }
  for (let y = 0; y < H; y++) {
    push(y * W);
    push(y * W + W - 1);
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % W;
    if (x > 0) push(i - 1);
    if (x < W - 1) push(i + 1);
    if (i >= W) push(i - W);
    if (i < N - W) push(i + W);
  }

  const minArea = Math.max(30, N * 0.0015);
  // Light areas that are enclosed by lines: the insides of drawn boxes.
  const enclosed = regions(W, H, (i) => !thick[i] && !outside[i]).filter((g) => g.area >= minArea);
  // Solid color blocks.
  const fills = regions(W, H, (i) => colorful[i] === 1).filter(
    (g) => g.area >= minArea && g.area / ((g.maxX - g.minX + 1) * (g.maxY - g.minY + 1)) >= 0.55,
  );

  // Measure the pen width so rectangles land on the middle of the drawn lines.
  const pad = r + Math.ceil(lineWidth(enclosed, ink, W, H, r) / 2);
  type Candidate = { region: Region; source: "outline" | "fill"; rect: Rect };
  const candidates: Candidate[] = [
    ...enclosed.map((region) => ({ region, source: "outline" as const, rect: grow(bbox(region), pad, W, H) })),
    ...fills.map((region) => ({ region, source: "fill" as const, rect: bbox(region) })),
  ].filter((c) => c.rect.w >= 4 && c.rect.h >= 4);

  // Drop color blocks that sit inside an outlined box we already found (a colored-in bed).
  const deduped = candidates.filter(
    (c) =>
      c.source === "outline" ||
      !candidates.some((o) => {
        if (o.source !== "outline" || overlap(o.rect, c.rect) < 0.5) return false;
        const ratio = (o.rect.w * o.rect.h) / (c.rect.w * c.rect.h);
        return ratio > 0.5 && ratio < 2.5;
      }),
  );

  // The garden's edge: a large outline that holds at least two other shapes (or one, if it fills most of the page).
  let frame: Rect | null = null;
  let frameIndex = -1;
  deduped.forEach((c, index) => {
    if (c.source !== "outline") return;
    const inside = deduped.filter((o) => o !== c && contains(c.rect, center(o.rect))).length;
    const big = (c.rect.w * c.rect.h) / N;
    if ((inside >= 2 || (inside >= 1 && big > 0.35)) && (!frame || c.rect.w * c.rect.h > frame.w * frame.h)) {
      frame = c.rect;
      frameIndex = index;
    }
  });
  const shapes = deduped.filter((_, index) => index !== frameIndex);
  // Shapes inside another bed (a label box, a doodle) aren't beds of their own.
  const beds = shapes.filter(
    (c) =>
      !shapes.some(
        (o) => o !== c && o.rect.w * o.rect.h > c.rect.w * c.rect.h * 2 && insideRegion(o, center(c.rect), pad),
      ),
  );

  const out: DetectedBed[] = [];
  beds
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
    .forEach((c, group) => {
      const color = c.source === "fill" ? meanColor(c.region, colorful, data, W) : null;
      const pieces = c.source === "outline" ? splitStepped(c.region, pad, W, H) : [c.rect];
      pieces.forEach((rect, part) => out.push({ rect, source: c.source, group, part, parts: pieces.length, color }));
    });

  let finalFrame: Rect;
  let fromBorder = false;
  if (frame) {
    finalFrame = frame;
    fromBorder = true;
  } else if (out.length) {
    const minX = Math.min(...out.map((b) => b.rect.x));
    const minY = Math.min(...out.map((b) => b.rect.y));
    const maxX = Math.max(...out.map((b) => b.rect.x + b.rect.w));
    const maxY = Math.max(...out.map((b) => b.rect.y + b.rect.h));
    const m = Math.round(Math.max(maxX - minX, maxY - minY) * 0.04);
    finalFrame = grow({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }, m, W, H);
  } else {
    finalFrame = { x: 0, y: 0, w: W, h: H };
  }

  return { width: W, height: H, frame: finalFrame, frameFromBorder: fromBorder, beds: out };
}

/** Turn a detection into bed rectangles in feet, rounded to half a foot. */
export function toFeet(detection: Detection, widthFt: number, lengthFt: number) {
  const f = detection.frame;
  const half = (n: number) => Math.round(n * 2) / 2;
  return detection.beds.map((bed) => {
    let x = half(((bed.rect.x - f.x) / f.w) * widthFt);
    let y = half(((bed.rect.y - f.y) / f.h) * lengthFt);
    let w = half((bed.rect.w / f.w) * widthFt);
    let h = half((bed.rect.h / f.h) * lengthFt);
    w = Math.min(Math.max(w, 1), widthFt);
    h = Math.min(Math.max(h, 1), lengthFt);
    x = Math.min(Math.max(x, 0), widthFt - w);
    y = Math.min(Math.max(y, 0), lengthFt - h);
    return { x, y, w, h };
  });
}

function regions(W: number, H: number, test: (i: number) => boolean): Region[] {
  const N = W * H;
  const seen = new Uint8Array(N);
  const queue = new Int32Array(N);
  const out: Region[] = [];
  for (let start = 0; start < N; start++) {
    if (seen[start] || !test(start)) continue;
    const rowMin = new Int32Array(H).fill(-1);
    const rowMax = new Int32Array(H).fill(-1);
    let head = 0;
    let tail = 0;
    seen[start] = 1;
    queue[tail++] = start;
    const g: Region = { area: 0, minX: W, minY: H, maxX: 0, maxY: 0, rowMin, rowMax };
    while (head < tail) {
      const i = queue[head++];
      const x = i % W;
      const y = (i - x) / W;
      g.area++;
      if (x < g.minX) g.minX = x;
      if (x > g.maxX) g.maxX = x;
      if (y < g.minY) g.minY = y;
      if (y > g.maxY) g.maxY = y;
      if (rowMin[y] === -1 || x < rowMin[y]) rowMin[y] = x;
      if (x > rowMax[y]) rowMax[y] = x;
      const next = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const j of next) {
        if (j >= 0 && !seen[j] && test(j)) {
          seen[j] = 1;
          queue[tail++] = j;
        }
      }
    }
    out.push(g);
  }
  return out;
}

/** Split an L-shaped or stepped outline into rectangles, one per band of rows with the same left and right edges. */
function splitStepped(g: Region, pad: number, W: number, H: number): Rect[] {
  const box = bbox(g);
  const whole = grow(box, pad, W, H);
  if (g.area / (box.w * box.h) > 0.85) return [whole];
  const tol = Math.max(3, Math.round(Math.min(box.w, box.h) * 0.12));
  type Band = { y0: number; y1: number; left: number; right: number };
  const bands: Band[] = [];
  for (let y = g.minY; y <= g.maxY; y++) {
    if (g.rowMin[y] < 0) continue;
    const left = g.rowMin[y];
    const right = g.rowMax[y];
    const band = bands.at(-1);
    if (band && Math.abs(left - band.left) <= tol && Math.abs(right - band.right) <= tol) {
      band.y1 = y;
    } else {
      bands.push({ y0: y, y1: y, left, right });
    }
  }
  // Fold slivers (a wobbly corner) into the band above or below.
  const merged: Band[] = [];
  for (const band of bands) {
    const prev = merged.at(-1);
    if (prev && band.y1 - band.y0 + 1 < tol) {
      prev.y1 = band.y1;
      continue;
    }
    if (prev && prev.y1 - prev.y0 + 1 < tol) {
      merged[merged.length - 1] = { ...band, y0: prev.y0 };
      continue;
    }
    merged.push({ ...band });
  }
  if (merged.length < 2 || merged.length > 3) return [whole];
  return merged.map((band, index) =>
    grow(
      {
        x: band.left,
        y: band.y0,
        w: band.right - band.left + 1,
        h: band.y1 - band.y0 + 1,
      },
      pad,
      W,
      H,
      { top: index === 0, bottom: index === merged.length - 1 },
    ),
  );
}

function lineWidth(found: Region[], ink: Uint8Array, W: number, H: number, r: number): number {
  const samples: number[] = [];
  const run = (x: number, y: number, dx: number, dy: number) => {
    // Step out from the region's edge through the dilation gap, then count ink pixels.
    let n = 0;
    let started = false;
    for (let k = 1; k < 40; k++) {
      const xx = x + dx * k;
      const yy = y + dy * k;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) break;
      if (ink[yy * W + xx]) {
        started = true;
        n++;
      } else if (started || k > r + 2) break;
    }
    if (n) samples.push(n);
  };
  for (const g of found.slice(0, 40)) {
    const my = Math.round((g.minY + g.maxY) / 2);
    const mx = Math.round((g.minX + g.maxX) / 2);
    if (g.rowMin[my] >= 0) {
      run(g.rowMin[my], my, -1, 0);
      run(g.rowMax[my], my, 1, 0);
    }
    run(mx, g.minY, 0, -1);
    run(mx, g.maxY, 0, 1);
  }
  if (!samples.length) return 2;
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

/** Is the point inside the drawn shape itself (not just its bounding box)? Handles L shapes. */
function insideRegion(c: { region: Region; rect: Rect }, p: { x: number; y: number }, pad: number): boolean {
  if (!contains(c.rect, p)) return false;
  const y = Math.round(p.y);
  const g = c.region;
  if (y < g.minY || y > g.maxY || g.rowMin[y] < 0) return false;
  return p.x >= g.rowMin[y] - pad && p.x <= g.rowMax[y] + pad;
}

function bbox(g: Region): Rect {
  return { x: g.minX, y: g.minY, w: g.maxX - g.minX + 1, h: g.maxY - g.minY + 1 };
}

function grow(r: Rect, n: number, W: number, H: number, sides = { top: true, bottom: true }): Rect {
  const x = Math.max(0, r.x - n);
  const y = Math.max(0, r.y - (sides.top ? n : 0));
  const x2 = Math.min(W, r.x + r.w + n);
  const y2 = Math.min(H, r.y + r.h + (sides.bottom ? n : 0));
  return { x, y, w: x2 - x, h: y2 - y };
}

function center(r: Rect) {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

function contains(r: Rect, p: { x: number; y: number }) {
  return p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
}

/** Share of the smaller rectangle covered by the other. */
function overlap(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a.w * a.h, b.w * b.h);
}

function dilate(src: Uint8Array, W: number, H: number, r: number): Uint8Array {
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  for (let y = 0; y < H; y++) {
    let run = -1e9;
    for (let x = 0; x < W; x++) {
      if (src[y * W + x]) run = x;
      if (x - run <= r) tmp[y * W + x] = 1;
    }
    run = 1e9;
    for (let x = W - 1; x >= 0; x--) {
      if (src[y * W + x]) run = x;
      if (run - x <= r) tmp[y * W + x] = 1;
    }
  }
  for (let x = 0; x < W; x++) {
    let run = -1e9;
    for (let y = 0; y < H; y++) {
      if (tmp[y * W + x]) run = y;
      if (y - run <= r) out[y * W + x] = 1;
    }
    run = 1e9;
    for (let y = H - 1; y >= 0; y--) {
      if (tmp[y * W + x]) run = y;
      if (run - y <= r) out[y * W + x] = 1;
    }
  }
  return out;
}

function boxMean(src: Float32Array, W: number, H: number, r: number): Float32Array {
  const integral = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += src[y * W + x];
      integral[(y + 1) * (W + 1) + x + 1] = integral[y * (W + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(W, x + r + 1);
      const sum =
        integral[y1 * (W + 1) + x1] - integral[y0 * (W + 1) + x1] - integral[y1 * (W + 1) + x0] + integral[y0 * (W + 1) + x0];
      out[y * W + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

function percentile(values: Uint8Array, q: number): number {
  const counts = new Uint32Array(256);
  for (const v of values) counts[v]++;
  let seen = 0;
  const target = values.length * q;
  for (let v = 0; v < 256; v++) {
    seen += counts[v];
    if (seen >= target) return v;
  }
  return 255;
}

function meanColor(g: Region, mask: Uint8Array, data: Raster["data"], W: number): string {
  let r = 0;
  let gr = 0;
  let b = 0;
  let n = 0;
  for (let y = g.minY; y <= g.maxY; y += 2) {
    for (let x = g.minX; x <= g.maxX; x += 2) {
      const i = y * W + x;
      if (!mask[i]) continue;
      r += data[i * 4];
      gr += data[i * 4 + 1];
      b += data[i * 4 + 2];
      n++;
    }
  }
  if (!n) return "#888888";
  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(gr)}${hex(b)}`;
}
