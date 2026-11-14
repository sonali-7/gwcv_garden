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
export type Point = { x: number; y: number };
export type Edge = { label: string; a: Point; b: Point; length: number };
export type Detection = {
  width: number;
  height: number;
  frame: Rect;
  frameFromBorder: boolean;
  beds: DetectedBed[];
  /** The garden's outer shape, when it was drawn as a closed line around the beds. */
  outline: Point[] | null;
  /** The outline's longer sides, lettered, so dimensions written along them can be matched. */
  edges: Edge[];
};
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

  // Writing is ink too, and a label that fills its box would break the box's inside into slivers.
  // Lift out small separate marks (letters, numbers) before looking for shapes.
  const textMax = Math.max(6, Math.round(Math.max(W, H) * 0.03));
  eraseSmallMarks(ink, colorful, W, H, textMax);

  // Thicken lines a little so small gaps at hand-drawn corners close up.
  const r = Math.max(1, Math.round(Math.min(W, H) / 450));
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
  // The thick lines kept "outside" a few pixels away from every line. Walk those last pixels
  // (through thin, undilated ink only) so writing inside a box can't split the box apart.
  {
    const dist = new Uint8Array(N);
    const q2 = new Int32Array(N);
    let h2 = 0;
    let t2 = 0;
    for (let i = 0; i < N; i++) if (outside[i]) q2[t2++] = i;
    while (h2 < t2) {
      const i = q2[h2++];
      if (dist[i] > r + 1) continue;
      const x = i % W;
      const next = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < N - W ? i + W : -1];
      for (const j of next) {
        if (j >= 0 && !outside[j] && !ink[j]) {
          outside[j] = 1;
          dist[j] = dist[i] + 1;
          q2[t2++] = j;
        }
      }
    }
  }

  const minArea = Math.max(30, N * 0.00015);
  // Light areas that are enclosed by lines: the insides of drawn boxes.
  const enclosed = mergeCut(
    regions(W, H, (i) => !ink[i] && !outside[i]).filter((g) => g.area >= minArea),
    W,
    H,
    r,
  );
  // Solid color blocks.
  const fills = regions(W, H, (i) => colorful[i] === 1).filter(
    (g) => g.area >= minArea && g.area / ((g.maxX - g.minX + 1) * (g.maxY - g.minY + 1)) >= 0.55,
  );

  // Measure the pen width so rectangles land on the middle of the drawn lines.
  const pad = Math.ceil(lineWidth(enclosed, ink, W, H, r) / 2);
  // Slivers (between a doubled line, say) are too thin to be beds.
  const minSide = Math.max(5, Math.round(Math.max(W, H) * 0.005));
  type Candidate = { region: Region; source: "outline" | "fill"; rect: Rect };
  const candidates: Candidate[] = [
    ...enclosed.map((region) => ({ region, source: "outline" as const, rect: grow(bbox(region), pad, W, H) })),
    ...fills.map((region) => ({ region, source: "fill" as const, rect: bbox(region) })),
  ].filter((c) => c.rect.w >= minSide && c.rect.h >= minSide);

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
  let groupCount = 0;
  beds
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
    .forEach((c) => {
      const color = c.source === "fill" ? meanColor(c.region, colorful, data, W) : null;
      const pieces = c.source === "outline" ? splitStepped(c.region, pad, W, H) : [c.rect];
      // A triangle or sliver that isn't an L either is leftover space between other shapes, not a bed.
      const fill = c.region.area / (bbox(c.region).w * bbox(c.region).h);
      if (c.source === "outline" && pieces.length === 1 && fill < 0.7) return;
      const group = groupCount++;
      pieces.forEach((rect, part) => out.push({ rect, source: c.source, group, part, parts: pieces.length, color }));
    });

  let finalFrame: Rect;
  let fromBorder = false;
  let outline: Point[] | null = null;
  if (frame) {
    // The whole drawn garden: its edge line, the beds, and anything touching them.
    const f = deduped[frameIndex].region;
    const seedY = Math.round((f.minY + f.maxY) / 2);
    const seed = f.rowMin[seedY] >= 0 ? seedY * W + f.rowMin[seedY] : -1;
    const garden = seed >= 0 ? componentAt(W, H, seed, (i) => !outside[i]) : null;
    if (garden) {
      finalFrame = bbox(garden);
      outline = simplify(spanPolygon(garden), Math.max(2, Math.max(W, H) * 0.006));
    } else {
      finalFrame = frame;
    }
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

  return {
    width: W,
    height: H,
    frame: finalFrame,
    frameFromBorder: fromBorder,
    beds: out,
    outline,
    edges: outline ? letteredEdges(outline) : [],
  };
}

/** Convert the outline to feet, relative to the garden's top-left corner. */
export function outlineToFeet(detection: Detection, widthFt: number, lengthFt: number): Array<[number, number]> | null {
  if (!detection.outline) return null;
  const f = detection.frame;
  const round = (n: number) => Math.round(n * 10) / 10;
  return detection.outline.map((p) => [
    round(Math.min(widthFt, Math.max(0, ((p.x - f.x) / f.w) * widthFt))),
    round(Math.min(lengthFt, Math.max(0, ((p.y - f.y) / f.h) * lengthFt))),
  ]);
}

/**
 * Pixels per unit from dimensions written along the outline's edges.
 * Hand-drawn plans are rarely exactly to scale, so take the median.
 */
export function scaleFromDimensions(detection: Detection, dims: Array<{ edge: string; value: number }>): number | null {
  const ratios = dims
    .map((d) => {
      const edge = detection.edges.find((e) => e.label === d.edge);
      return edge && d.value > 0 ? edge.length / d.value : null;
    })
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
  if (!ratios.length) return null;
  return ratios[Math.floor(ratios.length / 2)];
}

function eraseSmallMarks(ink: Uint8Array, colorful: Uint8Array, W: number, H: number, max: number) {
  const N = W * H;
  const seen = new Uint8Array(N);
  const queue = new Int32Array(N);
  for (let start = 0; start < N; start++) {
    if (seen[start] || !ink[start] || colorful[start]) continue;
    let head = 0;
    let tail = 0;
    seen[start] = 1;
    queue[tail++] = start;
    let minX = W;
    let maxX = 0;
    let minY = H;
    let maxY = 0;
    while (head < tail) {
      const i = queue[head++];
      const x = i % W;
      const y = (i - x) / W;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      // 8-connected, so the pieces of one letter stay together.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if ((dx || dy) && xx >= 0 && yy >= 0 && xx < W && yy < H) {
            const j = yy * W + xx;
            if (!seen[j] && ink[j] && !colorful[j]) {
              seen[j] = 1;
              queue[tail++] = j;
            }
          }
        }
      }
    }
    if (maxX - minX < max && maxY - minY < max) for (let k = 0; k < tail; k++) ink[queue[k]] = 0;
  }
}

function componentAt(W: number, H: number, start: number, test: (i: number) => boolean): Region | null {
  if (!test(start)) return null;
  const N = W * H;
  const seen = new Uint8Array(N);
  const queue = new Int32Array(N);
  const rowMin = new Int32Array(H).fill(-1);
  const rowMax = new Int32Array(H).fill(-1);
  const g: Region = { area: 0, minX: W, minY: H, maxX: 0, maxY: 0, rowMin, rowMax };
  let head = 0;
  let tail = 0;
  seen[start] = 1;
  queue[tail++] = start;
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
  return g;
}

/** Outline from each row's leftmost and rightmost pixel: exact for shapes without inward pockets from the side. */
function spanPolygon(g: Region): Point[] {
  const left: Point[] = [];
  const right: Point[] = [];
  for (let y = g.minY; y <= g.maxY; y++) {
    if (g.rowMin[y] < 0) continue;
    left.push({ x: g.rowMin[y], y });
    right.push({ x: g.rowMax[y] + 1, y });
  }
  if (left.length) {
    left.unshift({ x: left[0].x, y: g.minY });
    right.unshift({ x: right[0].x, y: g.minY });
    left.push({ x: left[left.length - 1].x, y: g.maxY + 1 });
    right.push({ x: right[right.length - 1].x, y: g.maxY + 1 });
  }
  return [...left, ...right.reverse()];
}

/** Douglas-Peucker on a closed polygon. */
function simplify(points: Point[], eps: number): Point[] {
  if (points.length < 4) return points;
  const dp = (pts: Point[]): Point[] => {
    if (pts.length < 3) return pts;
    const a = pts[0];
    const b = pts[pts.length - 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let worst = 0;
    let index = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((b.x - a.x) * (a.y - pts[i].y) - (a.x - pts[i].x) * (b.y - a.y)) / len;
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (worst <= eps) return [a, b];
    const left = dp(pts.slice(0, index + 1));
    return [...left.slice(0, -1), ...dp(pts.slice(index))];
  };
  // Split at the point farthest from the first, so the closed ring simplifies evenly.
  let far = 0;
  let best = 0;
  points.forEach((p, i) => {
    const d = Math.hypot(p.x - points[0].x, p.y - points[0].y);
    if (d > best) {
      best = d;
      far = i;
    }
  });
  const first = dp(points.slice(0, far + 1));
  const second = dp([...points.slice(far), points[0]]);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

function letteredEdges(poly: Point[]): Edge[] {
  const all = poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    return { a, b, length: Math.hypot(b.x - a.x, b.y - a.y) };
  });
  const perimeter = all.reduce((sum, e) => sum + e.length, 0);
  return all
    .filter((e) => e.length >= perimeter * 0.05)
    .map((e, i) => ({ ...e, label: String.fromCharCode(65 + (i % 26)) }));
}

/**
 * A garden's edge line (often a curve) can run straight through a bed, cutting its inside into
 * pieces. Put the pieces back together when they sit right next to each other, at least one
 * is not a rectangle, and together they fill most of their combined box.
 */
function mergeCut(found: Region[], W: number, H: number, r: number): Region[] {
  const items = found.map((g) => ({ g, rect: bbox(g), fill: g.area / ((g.maxX - g.minX + 1) * (g.maxY - g.minY + 1)) }));
  const gap = r * 2 + 4;
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (a.fill > 0.8 && b.fill > 0.8) continue;
        const ux = Math.min(a.rect.x, b.rect.x);
        const uy = Math.min(a.rect.y, b.rect.y);
        const ux2 = Math.max(a.rect.x + a.rect.w, b.rect.x + b.rect.w);
        const uy2 = Math.max(a.rect.y + a.rect.h, b.rect.y + b.rect.h);
        // Pieces of one cut box overlap each other's bounding boxes; two separate boxes side by side don't.
        const ox = Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - Math.max(a.rect.x, b.rect.x);
        const oy = Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - Math.max(a.rect.y, b.rect.y);
        if (ox < gap || oy < gap) continue;
        const unionArea = (ux2 - ux) * (uy2 - uy);
        if ((a.g.area + b.g.area) / unionArea < 0.72) continue;
        // Don't swallow the garden itself: only merge pieces of bed size.
        if (unionArea > W * H * 0.12) continue;
        const g: Region = {
          area: a.g.area + b.g.area,
          minX: Math.min(a.g.minX, b.g.minX),
          minY: Math.min(a.g.minY, b.g.minY),
          maxX: Math.max(a.g.maxX, b.g.maxX),
          maxY: Math.max(a.g.maxY, b.g.maxY),
          rowMin: new Int32Array(H).fill(-1),
          rowMax: new Int32Array(H).fill(-1),
        };
        for (let y = g.minY; y <= g.maxY; y++) {
          const mins = [a.g.rowMin[y], b.g.rowMin[y]].filter((v) => v >= 0);
          const maxs = [a.g.rowMax[y], b.g.rowMax[y]].filter((v) => v >= 0);
          if (mins.length) {
            g.rowMin[y] = Math.min(...mins);
            g.rowMax[y] = Math.max(...maxs);
          }
        }
        const rect = bbox(g);
        items.splice(j, 1);
        items[i] = { g, rect, fill: g.area / (rect.w * rect.h) };
        merged = true;
        break outer;
      }
    }
  }
  return items.map((item) => item.g);
}

/**
 * Shrink an image by averaging every source pixel into the target pixel it lands in.
 * Browsers' own scaling can skip pixels, which breaks thin 1-pixel lines into dashes.
 */
export function boxDownscale(src: Raster, tw: number, th: number): Raster {
  const { width: sw, height: sh, data } = src;
  if (tw >= sw && th >= sh) return src;
  const out = new Uint8ClampedArray(tw * th * 4);
  const sums = new Float64Array(tw * 4);
  const counts = new Float64Array(tw);
  const xMap = new Int32Array(sw);
  for (let x = 0; x < sw; x++) xMap[x] = Math.min(tw - 1, Math.floor((x * tw) / sw));
  let ty = 0;
  for (let y = 0; y <= sh; y++) {
    const rowTarget = y < sh ? Math.min(th - 1, Math.floor((y * th) / sh)) : th;
    if (rowTarget !== ty) {
      for (let x = 0; x < tw; x++) {
        const n = counts[x] || 1;
        const o = (ty * tw + x) * 4;
        for (let c = 0; c < 4; c++) out[o + c] = sums[x * 4 + c] / n;
      }
      sums.fill(0);
      counts.fill(0);
      ty = rowTarget;
      if (ty >= th) break;
    }
    if (y === sh) break;
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4;
      const t = xMap[x];
      // Transparent pixels count as white paper.
      const a = data[i + 3] / 255;
      sums[t * 4] += data[i] * a + 255 * (1 - a);
      sums[t * 4 + 1] += data[i + 1] * a + 255 * (1 - a);
      sums[t * 4 + 2] += data[i + 2] * a + 255 * (1 - a);
      sums[t * 4 + 3] += 255;
      counts[t]++;
    }
  }
  return { width: tw, height: th, data: out };
}

/**
 * Pencil photos want strict settings and hairline diagrams want loose ones, so try a few and keep
 * the one that finds the most beds (a garden edge counts a little too). Ties go to the stricter one.
 */
export function detectBest(img: Raster, tries = [0.5, 0.6, 0.7, 0.8]): { sensitivity: number; detection: Detection } {
  let best: { sensitivity: number; detection: Detection; score: number } | null = null;
  for (const sensitivity of tries) {
    const detection = detectSketch(img, { sensitivity });
    const score = new Set(detection.beds.map((b) => b.group)).size + (detection.outline ? 0.5 : 0);
    if (!best || score > best.score) best = { sensitivity, detection, score };
  }
  return { sensitivity: best!.sensitivity, detection: best!.detection };
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
