import type { Bed } from "./types";

export type Rect = NonNullable<Bed["geometry"]>;

/** Rounding slack in feet, so patches that only touch don't count as overlapping. */
const EPS = 0.01;

/** True when two patches share ground. Touching edges is fine. */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
}

/** The first patch in `others` that `rect` would overlap, if any. */
export function firstOverlap<T extends { geometry?: Rect | null }>(rect: Rect, others: T[]): T | null {
  return others.find((other) => other.geometry && overlaps(rect, other.geometry)) ?? null;
}

/**
 * Where a dragged patch may go. Tries the spot asked for; if that overlaps a neighbor,
 * slides along one axis; otherwise stays where it last was (`last` is always clear).
 */
export function allowedMove(next: Rect, last: Rect, others: Rect[]): Rect {
  const candidates = [next, { ...next, y: last.y }, { ...next, x: last.x }];
  return candidates.find((rect) => !others.some((other) => overlaps(rect, other))) ?? last;
}

/** Same idea for resizing: grow in whichever direction still has room. */
export function allowedResize(next: Rect, last: Rect, others: Rect[]): Rect {
  const candidates = [next, { ...next, h: last.h }, { ...next, w: last.w }];
  return candidates.find((rect) => !others.some((other) => overlaps(rect, other))) ?? last;
}

/**
 * The first open spot (scanning rows from the top-left, in half-foot steps) for a new w×h patch
 * inside a widthFt×lengthFt garden. Shrinks the patch if nothing fits. Null if the garden is full.
 */
export function openSpot(others: Rect[], widthFt: number, lengthFt: number, w: number, h: number): Rect | null {
  const sizes: Array<[number, number]> = [
    [w, h],
    [Math.min(w, 4), Math.min(h, 2)],
    [Math.min(w, 2), Math.min(h, 1)],
  ];
  for (const [sw, sh] of sizes) {
    const pw = Math.min(sw, widthFt);
    const ph = Math.min(sh, lengthFt);
    for (let y = 0.5; y + ph <= lengthFt; y += 0.5) {
      for (let x = 0.5; x + pw <= widthFt; x += 0.5) {
        const rect = { x, y, w: pw, h: ph };
        if (!others.some((other) => overlaps(rect, other))) return rect;
      }
    }
  }
  return null;
}
