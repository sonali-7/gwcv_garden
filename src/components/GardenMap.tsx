"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { allowedMove, allowedResize } from "@/lib/bed-space";
import { spriteDataUrl, spriteUrl, TILES } from "@/lib/pixel-sprites";
import { fromFt, gridStepFt, showSize, toFt, type Units } from "@/lib/units";
import { isPermanentPlot } from "@/lib/perennials";
import { inGroundOn, plannedAfter } from "@/lib/plantings";
import type { Bed, GardenLayout, Planting, Task } from "@/lib/types";

type Geometry = NonNullable<Bed["geometry"]>;
type Drag = { id: string; mode: "move" | "resize"; startX: number; startY: number; origin: Geometry; current: Geometry };

export const CROP_MIME = "application/x-garden-crop";

/** Page height taken by the header, timeline, map toolbar, and footer, so the garden at Fit fits in the rest. */
const SPACE_ABOVE_AND_BELOW = 80;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));

/** Beds saved before the map existed have no geometry. Stack them down the left edge. */
export function placed(beds: Bed[], layout: GardenLayout): Array<Bed & { geometry: Geometry }> {
  let slot = 0;
  return beds.map((bed) => {
    if (bed.geometry) return bed as Bed & { geometry: Geometry };
    const h = Math.max(2, Math.floor(layout.lengthFt / 8));
    const geometry = { x: 1, y: Math.min(1 + slot * (h + 1), layout.lengthFt - h), w: Math.min(8, layout.widthFt - 1), h };
    slot += 1;
    return { ...bed, geometry };
  });
}

export function GardenMap(props: {
  layout: GardenLayout;
  beds: Bed[];
  plantings: Planting[];
  tasks: Task[];
  today: string;
  /** The date shown, from the timeline. */
  day: string;
  sprites: Record<string, string>;
  selectedId: string | null;
  editing: boolean;
  busy: boolean;
  onSelect: (id: string | null) => void;
  /** Double-click on a plot: select it and start renaming it in the plant list. */
  onStartRename: (id: string) => void;
  onMove: (bed: Bed, geometry: Geometry) => void;
  onDropCrop: (bedId: string, crop: string) => void;
  onAddBed: () => void;
  onImport: () => void;
  onLayout: (patch: Partial<GardenLayout> & { imageDataUrl?: string | null }) => void;
}) {
  const { layout, editing } = props;
  const surface = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [pxPerFt, setPxPerFt] = useState(20);
  // Zoom makes the map wider than its card; the viewport around it scrolls.
  const viewport = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  // Keeps the spot under the pointer (or the middle of the view) in place while zooming.
  // `contentX/Y` is that spot on the map before the zoom; `x/y` is where it sits in the viewport.
  const anchor = useRef<{ contentX: number; contentY: number; x: number; y: number; from: number } | null>(null);

  function zoomTo(next: number, at?: { x: number; y: number }) {
    const el = viewport.current;
    const target = clampZoom(next);
    if (!el || target === zoomRef.current) return;
    const point = at ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 };
    anchor.current = { contentX: el.scrollLeft + point.x, contentY: el.scrollTop + point.y, ...point, from: zoomRef.current };
    zoomRef.current = target;
    setZoom(target);
  }

  // Runs after the map has its new size, before the browser paints, so the view doesn't jump.
  useLayoutEffect(() => {
    const el = viewport.current;
    const a = anchor.current;
    if (!el || !a) return;
    const ratio = zoom / a.from;
    el.scrollLeft = a.contentX * ratio - a.x;
    el.scrollTop = a.contentY * ratio - a.y;
    anchor.current = null;
  }, [zoom]);

  // Ctrl/Cmd + scroll, or a trackpad pinch (which browsers send as ctrl + wheel), zooms around the pointer.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = el!.getBoundingClientRect();
      zoomTo(zoomRef.current * Math.exp(-event.deltaY * 0.01), { x: event.clientX - rect.left, y: event.clientY - rect.top });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // zoomTo only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const measure = () => setPxPerFt(el.getBoundingClientRect().width / layout.widthFt);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [layout.widthFt]);

  // About one plant drawing per 2.5 ft, kept between 18 and 44 px so it stays readable. The count per patch is worked
  // out at normal size (basePxPerFt) and then scaled, so zooming in makes the drawings bigger instead of adding more.
  const basePxPerFt = pxPerFt / zoom;
  const spritePx = Math.round(Math.min(44, Math.max(18, basePxPerFt * 2.5)) / 2) * 2;

  const beds = placed(props.beds, layout);
  // Plots holding only perennials stay put year to year and look mulched.
  const permanentIds = new Set(
    props.beds
      .filter((bed) => isPermanentPlot(props.plantings.filter((p) => p.bed_id === bed.id && inGroundOn(p, props.day, props.today))))
      .map((bed) => bed.id),
  );
  const legend = new Map<string, string>();
  for (const bed of beds) {
    for (const p of props.plantings) {
      if (p.bed_id === bed.id && inGroundOn(p, props.day, props.today) && !legend.has(p.crop)) legend.set(p.crop, spriteUrl(p.crop, props.sprites));
    }
  }

  function feetPerPixel() {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect) return { fx: 0, fy: 0 };
    return { fx: layout.widthFt / rect.width, fy: layout.lengthFt / rect.height };
  }

  function startDrag(event: ReactPointerEvent, bed: Bed & { geometry: Geometry }, mode: Drag["mode"]) {
    if (!editing) return;
    event.preventDefault();
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    props.onSelect(bed.id);
    setDrag({ id: bed.id, mode, startX: event.clientX, startY: event.clientY, origin: bed.geometry, current: bed.geometry });
  }

  function onPointerMove(event: ReactPointerEvent) {
    if (!drag) return;
    const { fx, fy } = feetPerPixel();
    const dx = (event.clientX - drag.startX) * fx;
    const dy = (event.clientY - drag.startY) * fy;
    const snap = (n: number) => Math.round(n * 2) / 2;
    const o = drag.origin;
    let next: Geometry;
    if (drag.mode === "move") {
      next = {
        ...o,
        x: Math.min(Math.max(snap(o.x + dx), 0), layout.widthFt - o.w),
        y: Math.min(Math.max(snap(o.y + dy), 0), layout.lengthFt - o.h),
      };
    } else {
      next = {
        ...o,
        w: Math.min(Math.max(snap(o.w + dx), 1), layout.widthFt - o.x),
        h: Math.min(Math.max(snap(o.h + dy), 1), layout.lengthFt - o.y),
      };
    }
    // Patches can't share ground: stop at neighbors (sliding along the free direction).
    const others = placed(props.beds, layout)
      .filter((bed) => bed.id !== drag.id)
      .map((bed) => bed.geometry);
    const allowed = drag.mode === "move" ? allowedMove(next, drag.current, others) : allowedResize(next, drag.current, others);
    setDrag({ ...drag, current: allowed });
  }

  function endDrag() {
    if (!drag) return;
    const bed = props.beds.find((item) => item.id === drag.id);
    const moved = JSON.stringify(drag.current) !== JSON.stringify(drag.origin);
    setDrag(null);
    if (bed && moved) props.onMove(bed, drag.current);
  }

  const units: Units = layout.units ?? "ft";
  const step = gridStepFt(units);
  const gridX = (step / layout.widthFt) * 100;
  const gridY = (step / layout.lengthFt) * 100;
  // The whole garden is one bed of soil, with a faint grid; grass only outside an odd-shaped garden's edge.
  const ground: CSSProperties = {
    backgroundImage: `linear-gradient(to right, rgba(255, 236, 200, 0.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(255, 236, 200, 0.07) 1px, transparent 1px), ${TILES.soil}`,
    backgroundSize: `${gridX}% ${gridY}%, ${gridX}% ${gridY}%, 24px 24px`,
  };
  const shape = layout.outline && layout.outline.length >= 3 ? layout.outline : null;
  const shapePct = shape?.map(([x, y]) => [(x / layout.widthFt) * 100, (y / layout.lengthFt) * 100]) ?? null;
  // A grass border around the garden, so its soil fills about 80% of the map section.
  const margin = Math.max(2, 0.1 * Math.max(layout.widthFt, layout.lengthFt));
  const frameW = layout.widthFt + margin * 2;
  const frameH = layout.lengthFt + margin * 2;
  const ratio = (frameW / frameH).toFixed(4);
  // The grass fills the card's width. Its height fits the whole garden on screen: what the card's width
  // would need, but no more than the window has room for below the header and timeline (and never tiny).
  // 100cqw is the card's width (.map-viewport is a size container). Zooming grows both.
  const frameStyle: CSSProperties = {
    width: `${zoom * 100}%`,
    height: `calc(${zoom} * min(100cqw / ${ratio}, max(${Math.round(320 / Number(ratio))}px, 100vh - ${SPACE_ABOVE_AND_BELOW}px)))`,
    backgroundImage: TILES.grass,
    backgroundSize: "24px 24px",
  };
  const surfaceStyle: CSSProperties = {
    left: `${(margin / frameW) * 100}%`,
    top: `${(margin / frameH) * 100}%`,
    width: `${(layout.widthFt / frameW) * 100}%`,
    height: `${(layout.lengthFt / frameH) * 100}%`,
    ...(shapePct ? {} : ground),
  };

  return (
    <section className="map-card" aria-label="Garden map">
      <div className="map-head">
        <div className="map-heading">
        <h2 className="map-title">Garden</h2>
        <div className="map-legend" aria-label="Legend">
          {[...legend.entries()].map(([crop, url]) => (
            <span key={crop}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="sprite" src={url} alt="" width={20} height={20} />
              {crop}
            </span>
          ))}
          <span>
            <i className="swatch-empty" />
            open
          </span>
          <span>
            <i className="swatch-planned" />
            planned
          </span>
          {permanentIds.size ? (
            <span>
              <i className="swatch-perennial" />
              perennial
            </span>
          ) : null}
        </div>
        </div>
        <div className="map-tools">
          <div className="zoom" role="group" aria-label="Zoom">
            <button type="button" className="icon-btn" onClick={() => zoomTo(zoomRef.current / 1.5)} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out" title="Zoom out (or Ctrl/⌘ + scroll, or pinch)">
              −
            </button>
            <button type="button" className="icon-btn zoom-level" onClick={() => zoomTo(1)} disabled={zoom === 1} title="Fit the whole garden">
              {zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`}
            </button>
            <button type="button" className="icon-btn" onClick={() => zoomTo(zoomRef.current * 1.5)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in" title="Zoom in (or Ctrl/⌘ + scroll, or pinch)">
              +
            </button>
          </div>
          <button
            type="button"
            className="icon-btn"
            title="Turn a drawing of the garden into beds"
            onClick={props.onImport}
            disabled={props.busy}
          >
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <rect x="2.5" y="2.5" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <rect x="5" y="5" width="10" height="3" fill="currentColor" />
              <path d="M5 10.5h4v4.5H5zM11 10.5h4v4.5h-4z" fill="none" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            <span>Import drawing</span>
          </button>
        </div>
      </div>

      <div ref={viewport} className={`map-viewport${zoom > 1 ? " zoomed" : ""}`}>
      <div
        className="map-frame"
        style={frameStyle}
        onClick={(event) => {
          if (event.target === event.currentTarget) props.onSelect(null);
        }}
      >
      {/* The garden and its grass border, centred; any extra width is more grass. */}
      <div
        className="map-stage"
        style={{ aspectRatio: `${frameW} / ${frameH}` }}
        onClick={(event) => {
          if (event.target === event.currentTarget) props.onSelect(null);
        }}
      >
      <div
        ref={surface}
        className={`map-surface${editing ? " editing" : ""}${shapePct ? " shaped" : ""}`}
        style={surfaceStyle}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={(event) => {
          if (event.target === event.currentTarget) props.onSelect(null);
        }}
      >
        {shapePct ? (
          <>
            <div
              className="lawn"
              aria-hidden="true"
              style={{ ...ground, clipPath: `polygon(${shapePct.map(([x, y]) => `${x}% ${y}%`).join(", ")})` }}
            />
            <svg className="lawn-edge" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <polygon points={shapePct.map(([x, y]) => `${x},${y}`).join(" ")} />
            </svg>
          </>
        ) : null}
        <div className="scale" aria-hidden="true">
          <span className="scale-bar" style={{ width: `${gridX}%` }} />
          <span>{units === "m" ? "1 m" : "5 ft"}</span>
        </div>
        {beds.map((bed) => {
          const g = drag?.id === bed.id ? drag.current : bed.geometry;
          const current = props.plantings.filter((p) => p.bed_id === bed.id && inGroundOn(p, props.day, props.today));
          const planned = props.plantings
            .filter((p) => p.bed_id === bed.id && plannedAfter(p, props.day, props.today))
            .sort((a, b) => a.planted_date.localeCompare(b.planted_date));
          const crop = current[0]?.crop ?? null;
          // An empty bed shows everything planned for its next planting date, so plans made side by side show together.
          const nextPlanned = planned.filter((p) => p.planted_date === planned[0]?.planted_date);
          const shownCrops = [...new Set((current.length ? current : nextPlanned).map((p) => p.crop))];
          const cropText = current.length
            ? shownCrops.join(" + ")
            : nextPlanned.length
              ? `${shownCrops.join(" + ")} planned`
              : "open";
          const bedPxH = g.h * pxPerFt;
          const compact = bedPxH < 48;
          // Lay the drawings out at normal size, then scale by the zoom.
          const baseH = g.h * basePxPerFt;
          const baseW = g.w * basePxPerFt;
          const baseInset = baseH < 48 ? 3 : 5;
          const baseCell = Math.max(10, Math.min(spritePx, baseH - baseInset * 2, baseW - baseInset * 2));
          const cols = Math.max(1, Math.floor((baseW - baseInset * 2) / baseCell));
          const rowsN = Math.max(1, Math.floor((baseH - baseInset * 2) / baseCell));
          const cells = Math.min(cols * rowsN, 160);
          const cell = Math.round(baseCell * zoom);
          const inset = Math.round(baseInset * zoom);
          const tasks = props.tasks.filter((task) => task.bed_id === bed.id);
          const urgent = tasks.find((task) => task.severity === "urgent");
          const upcoming = tasks.find((task) => task.severity === "upcoming");
          const state = crop ? "growing" : planned.length ? "planned" : "open";
          return (
            <div
              key={bed.id}
              role="button"
              tabIndex={0}
              aria-pressed={props.selectedId === bed.id}
              aria-label={`${bed.name}: ${cropText}`}
              title={`${bed.name}: ${cropText}`}
              className={`bed ${state}${compact ? " compact" : ""}${permanentIds.has(bed.id) ? " perennial" : ""}${props.selectedId === bed.id ? " selected" : ""}${dropId === bed.id ? " drop" : ""}`}
              style={
                {
                  left: `${(g.x / layout.widthFt) * 100}%`,
                  top: `${(g.y / layout.lengthFt) * 100}%`,
                  width: `${(g.w / layout.widthFt) * 100}%`,
                  height: `${(g.h / layout.lengthFt) * 100}%`,
                } as CSSProperties
              }
              onClick={(event) => {
                event.stopPropagation();
                if (!drag) props.onSelect(bed.id);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                props.onStartRename(bed.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  props.onSelect(bed.id);
                }
                if (event.key === "F2") {
                  event.preventDefault();
                  props.onStartRename(bed.id);
                }
              }}
              onPointerDown={(event) => startDrag(event, bed, "move")}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(CROP_MIME) || props.day < props.today) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                setDropId(bed.id);
              }}
              onDragLeave={() => setDropId((id) => (id === bed.id ? null : id))}
              onDrop={(event) => {
                const dropped = event.dataTransfer.getData(CROP_MIME);
                setDropId(null);
                if (dropped) {
                  event.preventDefault();
                  props.onDropCrop(bed.id, dropped);
                }
              }}
            >
              {shownCrops.length ? (
                <span
                  className="bed-crops"
                  aria-hidden="true"
                  style={{ inset, gridTemplateColumns: `repeat(${cols}, ${cell}px)`, gridAutoRows: `${cell}px` }}
                >
                  {Array.from({ length: cells }, (_, i) => {
                    const r = Math.floor(i / cols);
                    const c = i % cols;
                    // Mixed beds alternate their crops in a checker pattern.
                    const which = shownCrops[(r + c) % shownCrops.length];
                    return (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={spriteUrl(which, props.sprites)} alt="" width={cell} height={cell} draggable={false} />
                    );
                  })}
                </span>
              ) : null}
              {/* Same size tag on every plot: just the name. The crops show in the tooltip and the plant list. */}
              <span className="bed-label">
                <strong>{bed.name}</strong>
              </span>
              <span className="bed-flags">
                {urgent ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="sprite flag" src={spriteDataUrl(urgent.type === "water" ? "drop" : "sprout")} alt={urgent.title} title={urgent.title} />
                ) : null}
                {upcoming ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="sprite flag" src={spriteDataUrl("basket")} alt={upcoming.title} title={upcoming.title} />
                ) : null}
              </span>
              {editing ? (
                <>
                  <span className="bed-size">{showSize(g.w, g.h, units)}</span>
                  <span
                    className="resize"
                    aria-hidden="true"
                    onPointerDown={(event) => startDrag(event, bed, "resize")}
                  />
                </>
              ) : null}
            </div>
          );
        })}
      </div>
      </div>
      </div>
      </div>

      <div className="map-foot">
        {editing ? (
          <div className="dims">
            <label>
              Width
              <input
                type="number"
                min={1}
                step={0.5}
                defaultValue={fromFt(layout.widthFt, units)}
                key={`w${layout.widthFt}${units}`}
                onBlur={(event) => {
                  const value = toFt(Number(event.target.value), units);
                  if (Math.abs(value - layout.widthFt) > 0.05) props.onLayout({ widthFt: value });
                }}
              />
            </label>
            <label>
              Length
              <input
                type="number"
                min={1}
                step={0.5}
                defaultValue={fromFt(layout.lengthFt, units)}
                key={`l${layout.lengthFt}${units}`}
                onBlur={(event) => {
                  const value = toFt(Number(event.target.value), units);
                  if (Math.abs(value - layout.lengthFt) > 0.05) props.onLayout({ lengthFt: value });
                }}
              />
            </label>
            <select aria-label="Units" value={units} onChange={(event) => props.onLayout({ units: event.target.value as Units })}>
              <option value="ft">ft</option>
              <option value="m">m</option>
            </select>
            {shape ? (
              <button type="button" className="texty" onClick={() => props.onLayout({ outline: null })}>
                Make it a rectangle
              </button>
            ) : null}
            <label className="wide">
              Near
              <input
                type="text"
                placeholder="Town, for seed shops"
                defaultValue={layout.location}
                key={`loc${layout.location}`}
                onBlur={(event) => {
                  if (event.target.value.trim() !== layout.location) props.onLayout({ location: event.target.value });
                }}
              />
            </label>
            <button type="button" className="pill" onClick={props.onAddBed} disabled={props.busy}>
              + Add bed
            </button>
          </div>
        ) : (
          <p className="map-hint">
            {showSize(layout.widthFt, layout.lengthFt, units)} ·{" "}
            {props.day < props.today
              ? "looking back: this is what was in each bed on that day"
              : "click a bed for details, drag a suggestion onto a bed to plan it"}
          </p>
        )}
      </div>
    </section>
  );
}
