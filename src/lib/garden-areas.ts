import { overlaps } from "./bed-space";
import type { Bed, GardenArea, GardenLayout } from "./types";

/**
 * Growing areas: two or more separately outlined patches of soil on one map, each with a name.
 * Plots aren't tied to an area by id; they belong to whichever area they sit in, so moving a plot into
 * another area just works.
 */

type Rect = { x: number; y: number; w: number; h: number };

/** Space left between a new area and the ones already there, in feet. */
const GAP_FT = 4;
const MIN_FT = 3;

const r1 = (n: number) => Math.round(n * 10) / 10;

/** The areas on the map; none means the classic single garden (its outline, or the whole rectangle). */
export function areasOf(layout: GardenLayout): GardenArea[] {
  return layout.areas?.length ? layout.areas : [];
}

/** The corners of an area's shape, in feet. */
export function areaPolygon(area: GardenArea): Array<[number, number]> {
  if (area.outline && area.outline.length >= 3) return area.outline;
  return [
    [area.x, area.y],
    [area.x + area.w, area.y],
    [area.x + area.w, area.y + area.h],
    [area.x, area.y + area.h],
  ];
}

function centerIn(rect: Rect, area: GardenArea): boolean {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return cx >= area.x && cx <= area.x + area.w && cy >= area.y && cy <= area.y + area.h;
}

/** The area a plot sits in (by its middle), or null if it's outside them all. */
export function areaOfBed(bed: Bed, areas: GardenArea[]): GardenArea | null {
  if (!bed.geometry) return null;
  return areas.find((area) => centerIn(bed.geometry!, area)) ?? null;
}

/** The plots sitting in an area. */
export function bedsInArea(beds: Bed[], area: GardenArea): Bed[] {
  return beds.filter((bed) => bed.geometry && centerIn(bed.geometry, area));
}

/** Whether a point (in feet) is inside a polygon (ray casting). */
export function insidePolygon(x: number, y: number, polygon: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether a whole rectangle sits inside an area's shape (all four corners in it). */
export function rectInArea(rect: Rect, area: GardenArea): boolean {
  const shape = areaPolygon(area);
  const corners: Array<[number, number]> = [
    [rect.x + 0.05, rect.y + 0.05],
    [rect.x + rect.w - 0.05, rect.y + 0.05],
    [rect.x + rect.w - 0.05, rect.y + rect.h - 0.05],
    [rect.x + 0.05, rect.y + rect.h - 0.05],
  ];
  return corners.every(([x, y]) => insidePolygon(x, y, shape));
}

/** A box around some points, rounded to a tenth of a foot. */
export function bounds(points: Array<[number, number]>): Rect {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x: r1(x), y: r1(y), w: r1(Math.max(...xs) - x), h: r1(Math.max(...ys) - y) };
}

function newId(taken: GardenArea[]): string {
  let n = taken.length + 1;
  while (taken.some((area) => area.id === `area-${n}`)) n++;
  return `area-${n}`;
}

function nextName(taken: GardenArea[]): string {
  let n = taken.length + 1;
  while (taken.some((area) => area.name === `Area ${n}`)) n++;
  return `Area ${n}`;
}

/**
 * Add an area to the right of everything on the map, growing the map to fit. The first time, the garden
 * that's already there becomes Area 1 (keeping its outline), so nothing moves.
 */
export function addArea(layout: GardenLayout): Pick<GardenLayout, "areas" | "widthFt" | "lengthFt" | "outline"> {
  let areas = areasOf(layout);
  if (!areas.length) {
    const outline = layout.outline && layout.outline.length >= 3 ? layout.outline : null;
    const box = outline ? bounds(outline) : { x: 0, y: 0, w: layout.widthFt, h: layout.lengthFt };
    areas = [{ id: "area-1", name: "Area 1", ...box, outline }];
  }
  const right = Math.max(...areas.map((area) => area.x + area.w));
  const w = r1(Math.min(20, Math.max(8, layout.widthFt / 3)));
  const h = r1(Math.min(15, Math.max(8, layout.lengthFt / 3)));
  const area: GardenArea = { id: newId(areas), name: nextName(areas), x: r1(right + GAP_FT), y: 0, w, h, outline: null };
  return {
    areas: [...areas, area],
    widthFt: r1(Math.max(layout.widthFt, area.x + area.w)),
    lengthFt: r1(Math.max(layout.lengthFt, area.y + area.h)),
    // Areas replace the single outline.
    outline: null,
  };
}

/** Move an area by (dx, dy) feet, shape and all. */
export function shiftArea(area: GardenArea, dx: number, dy: number): GardenArea {
  return {
    ...area,
    x: r1(area.x + dx),
    y: r1(area.y + dy),
    outline: area.outline ? area.outline.map(([x, y]) => [r1(x + dx), r1(y + dy)] as [number, number]) : null,
  };
}

/** Resize an area to w × h feet from its top-left corner, stretching an odd shape to match. */
export function resizeArea(area: GardenArea, w: number, h: number): GardenArea {
  const kx = w / area.w;
  const ky = h / area.h;
  return {
    ...area,
    w: r1(w),
    h: r1(h),
    outline: area.outline
      ? area.outline.map(([x, y]) => [r1(area.x + (x - area.x) * kx), r1(area.y + (y - area.y) * ky)] as [number, number])
      : null,
  };
}

function segmentsCross(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const cross = (p: [number, number], q: [number, number], r: [number, number]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Whether two shapes share ground: their edges cross, or one sits inside the other. Touching edges don't count. */
export function polygonsOverlap(a: Array<[number, number]>, b: Array<[number, number]>): boolean {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segmentsCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
    }
  }
  const middle = (poly: Array<[number, number]>): [number, number] => {
    const box = bounds(poly);
    // A point just inside the first corner, so a shape wholly inside the other is caught.
    const [x, y] = poly[0];
    return [x + (box.x + box.w / 2 - x) * 0.01, y + (box.y + box.h / 2 - y) * 0.01];
  };
  return insidePolygon(...middle(a), b) || insidePolygon(...middle(b), a);
}

/** An outline whose edges cross itself (a bow tie) can't be drawn as soil sensibly. */
export function selfCrossing(points: Array<[number, number]>): boolean {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return true;
    }
  }
  return false;
}

/**
 * Where an area can go: inside the map, at least MIN_FT across, a shape that doesn't cross itself, and not on top
 * of another area (by their actual shapes, so odd shapes can tuck in close).
 */
export function areaFits(next: GardenArea, others: GardenArea[], widthFt: number, lengthFt: number): boolean {
  if (next.w < MIN_FT || next.h < MIN_FT) return false;
  if (next.x < -0.01 || next.y < -0.01 || next.x + next.w > widthFt + 0.01 || next.y + next.h > lengthFt + 0.01) return false;
  const shape = areaPolygon(next);
  if (selfCrossing(shape)) return false;
  return !others.some((other) => other.id !== next.id && overlaps(next, other) && polygonsOverlap(shape, areaPolygon(other)));
}

/** An area given a new outline (corners moved, added or removed); its box follows the shape. */
export function reshapeArea(area: GardenArea, points: Array<[number, number]>): GardenArea {
  const outline = points.map(([x, y]) => [r1(x), r1(y)] as [number, number]);
  return { ...area, ...bounds(outline), outline };
}

/** Points sent to the server: 3 to 200 [x, y] pairs inside the map, rounded. Null if unusable. */
export function cleanPoints(value: unknown, widthFt: number, lengthFt: number): Array<[number, number]> | null {
  if (!Array.isArray(value) || value.length < 3 || value.length > 200) return null;
  const points: Array<[number, number]> = [];
  for (const p of value) {
    if (!Array.isArray(p) || p.length !== 2) return null;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    points.push([r1(Math.min(Math.max(x, 0), widthFt)), r1(Math.min(Math.max(y, 0), lengthFt))]);
  }
  return points;
}

/** Check areas sent to the server: well-formed, inside the map, named. Returns undefined to clear them. */
export function cleanAreas(value: unknown, widthFt: number, lengthFt: number): GardenArea[] | undefined {
  if (!Array.isArray(value) || !value.length) return undefined;
  const out: GardenArea[] = [];
  for (const raw of value.slice(0, 20)) {
    const a = raw as Record<string, unknown>;
    const nums = ["x", "y", "w", "h"].map((k) => Number(a?.[k]));
    if (nums.some((n) => !Number.isFinite(n))) continue;
    let [x, y, w, h] = nums.map(r1);
    w = Math.min(Math.max(w, MIN_FT), widthFt);
    h = Math.min(Math.max(h, MIN_FT), lengthFt);
    x = r1(Math.min(Math.max(x, 0), widthFt - w));
    y = r1(Math.min(Math.max(y, 0), lengthFt - h));
    const outline = Array.isArray(a.outline)
      ? (a.outline as unknown[]).flatMap((p) => {
          if (!Array.isArray(p) || p.length !== 2) return [];
          const px = Number(p[0]);
          const py = Number(p[1]);
          return Number.isFinite(px) && Number.isFinite(py)
            ? [[r1(Math.min(Math.max(px, 0), widthFt)), r1(Math.min(Math.max(py, 0), lengthFt))] as [number, number]]
            : [];
        })
      : [];
    const id = typeof a.id === "string" && /^[\w-]{1,40}$/.test(a.id) ? a.id : `area-${out.length + 1}`;
    const name = typeof a.name === "string" && a.name.trim() ? a.name.replace(/\s+/g, " ").trim().slice(0, 40) : `Area ${out.length + 1}`;
    if (out.some((area) => area.id === id)) continue;
    out.push({ id, name, x, y, w, h, outline: outline.length >= 3 ? outline : null });
  }
  return out.length ? out : undefined;
}

/** A change to the areas, as sent to /api/layout/areas. */
export type AreaAction =
  | { action: "add" }
  | { action: "move"; id: string; dx: number; dy: number }
  | { action: "resize"; id: string; w: number; h: number }
  | { action: "reshape"; id: string; outline: Array<[number, number]> }
  | { action: "rename"; id: string; name: string }
  | { action: "delete"; id: string };

/** How far right or down an area may reach; the map grows to fit it (the layout API caps sizes at 1000 ft). */
export const AREA_MAX_FT = 1000;

/** The map's size grown (never shrunk) so every area fits. */
export function mapFitting(areas: GardenArea[], widthFt: number, lengthFt: number): { widthFt: number; lengthFt: number } {
  return {
    widthFt: r1(Math.max(widthFt, ...areas.map((a) => a.x + a.w))),
    lengthFt: r1(Math.max(lengthFt, ...areas.map((a) => a.y + a.h))),
  };
}
