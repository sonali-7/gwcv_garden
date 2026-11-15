import { getStore } from "@/lib/db";
import { addArea, AREA_MAX_FT, areaFits, areasOf, bedsInArea, cleanPoints, fitMap, mapFitting, reshapeArea, resizeArea, shiftArea } from "@/lib/garden-areas";
import { json, noContent } from "@/lib/http";
import type { GardenLayout } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function OPTIONS() {
  return noContent();
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Change the garden's growing areas:
 *   { action: "add" }                       a new area beside the others (the existing garden becomes Area 1)
 *   { action: "move", id, dx, dy }          move an area and the plots in it, in feet
 *   { action: "resize", id, w, h }          resize from its top-left corner
 *   { action: "reshape", id, outline }      new corners for its shape ([x, y] feet)
 *   { action: "rename", id, name }
 *   { action: "delete", id }                only when no plots are in it; the map then shrinks to what's left
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const store = await getStore();
  const layout = await store.getLayout();
  const areas = areasOf(layout);
  const area = areas.find((item) => item.id === body?.id);

  if (body?.action === "add") {
    const next = { ...layout, ...addArea(layout) };
    await store.saveLayout(next);
    return json(next);
  }
  if (!area) return json({ error: "That area isn't on the map anymore." }, 404);

  if (body?.action === "move") {
    const dx = r1(Number(body.dx));
    const dy = r1(Number(body.dy));
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return json({ error: "Move it by a number of feet." }, 400);
    const moved = shiftArea(area, dx, dy);
    if (!areaFits(moved, areas, AREA_MAX_FT, AREA_MAX_FT)) return json({ error: "That would overlap another area." }, 409);
    // The plots in the area move with it, exactly (no rounding), so they keep their spacing.
    const beds = await store.listBeds();
    for (const bed of bedsInArea(beds.filter((b) => !b.archived), area)) {
      const g = bed.geometry!;
      await store.updateBed({ ...bed, geometry: { ...g, x: r1(g.x + dx), y: r1(g.y + dy) } });
    }
    // Growing an area past the map's right or bottom edge grows the map with it.
    const nextAreas = areas.map((item) => (item.id === area.id ? moved : item));
    const next = { ...layout, areas: nextAreas, ...mapFitting(nextAreas, layout.widthFt, layout.lengthFt) };
    await store.saveLayout(next);
    return json(next);
  }

  if (body?.action === "resize") {
    const w = r1(Number(body.w));
    const h = r1(Number(body.h));
    const resized = resizeArea(area, w, h);
    if (!Number.isFinite(w) || !Number.isFinite(h) || !areaFits(resized, areas, AREA_MAX_FT, AREA_MAX_FT)) {
      return json({ error: "That size would overlap another area or leave the map." }, 409);
    }
    // Growing an area past the map's right or bottom edge grows the map with it.
    const nextAreas = areas.map((item) => (item.id === area.id ? resized : item));
    const next = { ...layout, areas: nextAreas, ...mapFitting(nextAreas, layout.widthFt, layout.lengthFt) };
    await store.saveLayout(next);
    return json(next);
  }

  if (body?.action === "reshape") {
    const points = cleanPoints(body.outline, AREA_MAX_FT, AREA_MAX_FT);
    const reshaped = points ? reshapeArea(area, points) : null;
    if (!reshaped || !areaFits(reshaped, areas, AREA_MAX_FT, AREA_MAX_FT)) {
      return json({ error: "That shape would cross itself, overlap another area, or be too small." }, 409);
    }
    // Growing an area past the map's right or bottom edge grows the map with it.
    const nextAreas = areas.map((item) => (item.id === area.id ? reshaped : item));
    const next = { ...layout, areas: nextAreas, ...mapFitting(nextAreas, layout.widthFt, layout.lengthFt) };
    await store.saveLayout(next);
    return json(next);
  }

  if (body?.action === "rename") {
    const name = typeof body.name === "string" ? body.name.replace(/\s+/g, " ").trim().slice(0, 40) : "";
    if (!name) return json({ error: "Give the area a name." }, 400);
    const next = { ...layout, areas: areas.map((item) => (item.id === area.id ? { ...item, name } : item)) };
    await store.saveLayout(next);
    return json(next);
  }

  if (body?.action === "delete") {
    const inside = bedsInArea((await store.listBeds()).filter((b) => !b.archived), area);
    if (inside.length) {
      return json({ error: `${area.name} still has ${inside.length} plot${inside.length === 1 ? "" : "s"} in it. Move or delete them first.` }, 409);
    }
    let rest = areas.filter((item) => item.id !== area.id);
    const next: GardenLayout = { ...layout, areas: rest };
    if (!rest.length) delete next.areas;
    // Trim the map to what's left so no empty grass remains where the area was: shift everything up/left if the
    // space was there, and shrink the size. With no areas left, the garden keeps its size.
    const fit = rest.length ? fitMap(rest, (await store.listBeds()).filter((b) => !b.archived)) : null;
    if (fit) {
      if (fit.dx || fit.dy) {
        rest = rest.map((item) => shiftArea(item, fit.dx, fit.dy));
        next.areas = rest;
        for (const bed of (await store.listBeds()).filter((b) => !b.archived && b.geometry)) {
          const g = bed.geometry!;
          await store.updateBed({ ...bed, geometry: { ...g, x: r1(g.x + fit.dx), y: r1(g.y + fit.dy) } });
        }
      }
      next.widthFt = fit.widthFt;
      next.lengthFt = fit.lengthFt;
    }
    await store.saveLayout(next);
    return json(next);
  }

  return json({ error: "Unknown change." }, 400);
}
