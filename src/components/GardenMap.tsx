"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { spriteDataUrl, spriteUrl, TILES } from "@/lib/pixel-sprites";
import { fromFt, gridStepFt, showSize, toFt, type Units } from "@/lib/units";
import { isActive } from "@/lib/plantings";
import type { Bed, GardenLayout, Planting, Task } from "@/lib/types";

type Geometry = NonNullable<Bed["geometry"]>;
type Drag = { id: string; mode: "move" | "resize"; startX: number; startY: number; origin: Geometry; current: Geometry };

export const CROP_MIME = "application/x-garden-crop";

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
  sprites: Record<string, string>;
  selectedId: string | null;
  editing: boolean;
  busy: boolean;
  onSelect: (id: string | null) => void;
  onMove: (bed: Bed, geometry: Geometry) => void;
  onDropCrop: (bedId: string, crop: string) => void;
  onAddBed: () => void;
  onImport: () => void;
  onLayout: (patch: Partial<GardenLayout> & { imageDataUrl?: string | null }) => void;
}) {
  const { layout, editing } = props;
  const surface = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [showPhoto, setShowPhoto] = useState(true);
  const [pxPerFt, setPxPerFt] = useState(20);

  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const measure = () => setPxPerFt(el.getBoundingClientRect().width / layout.widthFt);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [layout.widthFt]);

  // About one plant drawing per 2.5 ft, kept between 18 and 44 px so it stays readable.
  const spritePx = Math.round(Math.min(44, Math.max(18, pxPerFt * 2.5)) / 2) * 2;

  const beds = placed(props.beds, layout);
  const legend = new Map<string, string>();
  for (const bed of beds) {
    for (const p of props.plantings) {
      if (p.bed_id === bed.id && isActive(p, props.today) && !legend.has(p.crop)) legend.set(p.crop, spriteUrl(p.crop, props.sprites));
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
    setDrag({ ...drag, current: next });
  }

  function endDrag() {
    if (!drag) return;
    const bed = props.beds.find((item) => item.id === drag.id);
    const moved = JSON.stringify(drag.current) !== JSON.stringify(drag.origin);
    setDrag(null);
    if (bed && moved) props.onMove(bed, drag.current);
  }

  function pickPhoto(file: File | undefined) {
    if (!file) return;
    if (file.size > 4_000_000) {
      window.alert("Pick a photo under 4MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        props.onLayout({ imageDataUrl: reader.result });
        setShowPhoto(true);
      }
    };
    reader.readAsDataURL(file);
  }

  const units: Units = layout.units ?? "ft";
  const step = gridStepFt(units);
  const gridX = (step / layout.widthFt) * 100;
  const gridY = (step / layout.lengthFt) * 100;
  const lawn: CSSProperties = {
    backgroundImage: `linear-gradient(to right, rgba(43, 29, 20, 0.12) 2px, transparent 2px), linear-gradient(to bottom, rgba(43, 29, 20, 0.12) 2px, transparent 2px), ${TILES.grass}`,
    backgroundSize: `${gridX}% ${gridY}%, ${gridX}% ${gridY}%, 24px 24px`,
  };
  const shape = layout.outline && layout.outline.length >= 3 ? layout.outline : null;
  const shapePct = shape?.map(([x, y]) => [(x / layout.widthFt) * 100, (y / layout.lengthFt) * 100]) ?? null;
  const surfaceStyle: CSSProperties = shapePct
    ? { aspectRatio: `${layout.widthFt} / ${layout.lengthFt}`, backgroundImage: TILES.path, backgroundSize: "24px 24px" }
    : { aspectRatio: `${layout.widthFt} / ${layout.lengthFt}`, ...lawn };

  return (
    <section className="map-card" aria-label="Garden map">
      <div className="map-head">
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
        </div>
        <div className="map-tools">
          {layout.imageUrl ? (
            <button type="button" className="texty" onClick={() => setShowPhoto((v) => !v)}>
              {showPhoto ? "Hide photo" : "Show photo"}
            </button>
          ) : null}
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
          <button
            type="button"
            className="icon-btn"
            title="Upload a photo or aerial image of the garden"
            onClick={() => fileInput.current?.click()}
            disabled={props.busy}
          >
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <rect x="2.5" y="4.5" width="15" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="7" cy="9" r="1.6" fill="currentColor" />
              <path d="M3.5 14l4.5-4 3 3 2-2 4 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <span>{layout.imageUrl ? "Replace photo" : "Upload photo"}</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="sr"
            onChange={(event) => {
              pickPhoto(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>
      </div>

      <div
        ref={surface}
        className={`map-surface${editing ? " editing" : ""}`}
        style={surfaceStyle}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={(event) => {
          if (event.target === event.currentTarget) props.onSelect(null);
        }}
      >
        {layout.imageUrl && showPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="map-photo" src={layout.imageUrl} alt="" draggable={false} />
        ) : null}
        {shapePct ? (
          <>
            <div
              className="lawn"
              aria-hidden="true"
              style={{ ...lawn, clipPath: `polygon(${shapePct.map(([x, y]) => `${x}% ${y}%`).join(", ")})` }}
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
          const current = props.plantings.filter((p) => p.bed_id === bed.id && isActive(p, props.today));
          const planned = props.plantings
            .filter((p) => p.bed_id === bed.id && p.planted_date > props.today && !p.removed_date)
            .sort((a, b) => a.planted_date.localeCompare(b.planted_date));
          const crop = current[0]?.crop ?? null;
          const shownCrops = [...new Set((current.length ? current : planned.slice(0, 1)).map((p) => p.crop))];
          const cropText = current.length
            ? shownCrops.join(" + ")
            : planned[0]
              ? `${planned[0].crop} planned`
              : "open";
          // Beds drawn from a plan are often named after their crops; don't say it twice.
          const sayCrops = !shownCrops.length || !shownCrops.every((c) => bed.name.toLowerCase().includes(c.slice(0, 4)));
          const bedPxH = g.h * pxPerFt;
          const bedPxW = g.w * pxPerFt;
          const compact = bedPxH < 48;
          const inset = compact ? 4 : 8;
          const cell = Math.max(10, Math.min(spritePx, bedPxH - inset * 2, bedPxW - inset * 2));
          const cols = Math.max(1, Math.floor((bedPxW - inset * 2) / cell));
          const rowsN = Math.max(1, Math.floor((bedPxH - inset * 2) / cell));
          const cells = Math.min(cols * rowsN, 160);
          const tasks = props.tasks.filter((task) => task.bed_id === bed.id);
          const urgent = tasks.find((task) => task.severity === "urgent");
          const upcoming = tasks.find((task) => task.severity === "upcoming");
          const state = crop ? "growing" : planned.length ? "planned" : "open";
          const tall = !compact && (g.h / layout.lengthFt > 0.12 || g.w / layout.widthFt > 0.3);
          return (
            <div
              key={bed.id}
              role="button"
              tabIndex={0}
              aria-pressed={props.selectedId === bed.id}
              aria-label={`${bed.name}: ${cropText}`}
              title={`${bed.name}: ${cropText}`}
              className={`bed ${state}${compact ? " compact" : ""}${props.selectedId === bed.id ? " selected" : ""}${dropId === bed.id ? " drop" : ""}`}
              style={
                {
                  left: `${(g.x / layout.widthFt) * 100}%`,
                  top: `${(g.y / layout.lengthFt) * 100}%`,
                  width: `${(g.w / layout.widthFt) * 100}%`,
                  height: `${(g.h / layout.lengthFt) * 100}%`,
                  backgroundImage: TILES.soil,
                } as CSSProperties
              }
              onClick={(event) => {
                event.stopPropagation();
                if (!drag) props.onSelect(bed.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  props.onSelect(bed.id);
                }
              }}
              onPointerDown={(event) => startDrag(event, bed, "move")}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(CROP_MIME)) return;
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
              <span className="bed-label">
                <strong>{bed.name}</strong>
                {tall && sayCrops ? <em>{cropText}</em> : null}
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
            {layout.imageUrl ? (
              <button type="button" className="texty" onClick={() => props.onLayout({ imageDataUrl: null })}>
                Remove photo
              </button>
            ) : null}
            <button type="button" className="pill" onClick={props.onAddBed} disabled={props.busy}>
              + Add bed
            </button>
          </div>
        ) : (
          <p className="map-hint">
            {showSize(layout.widthFt, layout.lengthFt, units)} · click a bed for details, drag a suggestion onto a bed to plan it
          </p>
        )}
      </div>
    </section>
  );
}
