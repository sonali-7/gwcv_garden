"use client";

import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { cropColor } from "@/lib/crop-colors";
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
  selectedId: string | null;
  editing: boolean;
  busy: boolean;
  onSelect: (id: string | null) => void;
  onMove: (bed: Bed, geometry: Geometry) => void;
  onDropCrop: (bedId: string, crop: string) => void;
  onAddBed: () => void;
  onLayout: (patch: Partial<GardenLayout> & { imageDataUrl?: string | null }) => void;
}) {
  const { layout, editing } = props;
  const surface = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [showPhoto, setShowPhoto] = useState(true);

  const beds = placed(props.beds, layout);
  const legend = new Map<string, string>();
  for (const bed of beds) {
    const crop = props.plantings.find((p) => p.bed_id === bed.id && isActive(p, props.today))?.crop;
    if (crop && !legend.has(crop)) legend.set(crop, cropColor(crop));
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

  const gridX = (5 / layout.widthFt) * 100;
  const gridY = (5 / layout.lengthFt) * 100;
  const surfaceStyle: CSSProperties = {
    aspectRatio: `${layout.widthFt} / ${layout.lengthFt}`,
    backgroundSize: `${gridX}% ${gridY}%`,
  };

  return (
    <section className="map-card" aria-label="Garden map">
      <div className="map-head">
        <div className="map-legend" aria-label="Legend">
          {[...legend.entries()].map(([crop, color]) => (
            <span key={crop}>
              <i style={{ background: color }} />
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
        <div className="scale" aria-hidden="true">
          <span className="scale-bar" style={{ width: `${gridX}%` }} />
          <span>5 ft</span>
        </div>
        {beds.map((bed) => {
          const g = drag?.id === bed.id ? drag.current : bed.geometry;
          const current = props.plantings.filter((p) => p.bed_id === bed.id && isActive(p, props.today));
          const planned = props.plantings
            .filter((p) => p.bed_id === bed.id && p.planted_date > props.today && !p.removed_date)
            .sort((a, b) => a.planted_date.localeCompare(b.planted_date));
          const crop = current[0]?.crop ?? null;
          const color = crop ? cropColor(crop) : planned[0] ? cropColor(planned[0].crop) : "#9a8d7a";
          const tasks = props.tasks.filter((task) => task.bed_id === bed.id);
          const urgent = tasks.find((task) => task.severity === "urgent");
          const upcoming = tasks.find((task) => task.severity === "upcoming");
          const state = crop ? "growing" : planned.length ? "planned" : "open";
          const tall = g.h / layout.lengthFt > 0.12;
          return (
            <div
              key={bed.id}
              role="button"
              tabIndex={0}
              aria-pressed={props.selectedId === bed.id}
              aria-label={`${bed.name}: ${crop ?? (planned[0] ? `${planned[0].crop} planned` : "open")}`}
              className={`bed ${state}${props.selectedId === bed.id ? " selected" : ""}${dropId === bed.id ? " drop" : ""}`}
              style={
                {
                  left: `${(g.x / layout.widthFt) * 100}%`,
                  top: `${(g.y / layout.lengthFt) * 100}%`,
                  width: `${(g.w / layout.widthFt) * 100}%`,
                  height: `${(g.h / layout.lengthFt) * 100}%`,
                  "--bed": color,
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
              <span className="bed-label">
                <strong>{bed.name}</strong>
                {tall || g.w / layout.widthFt > 0.3 ? (
                  <em>{crop ?? (planned[0] ? `${planned[0].crop} planned` : "open")}</em>
                ) : null}
              </span>
              <span className="bed-flags">
                {urgent ? <i className="flag urgent" title={urgent.title} /> : null}
                {upcoming ? <i className="flag upcoming" title={upcoming.title} /> : null}
              </span>
              {editing ? (
                <>
                  <span className="bed-size">
                    {g.w}×{g.h} ft
                  </span>
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
                min={5}
                max={1000}
                defaultValue={layout.widthFt}
                key={`w${layout.widthFt}`}
                onBlur={(event) => {
                  const value = Number(event.target.value);
                  if (value !== layout.widthFt) props.onLayout({ widthFt: value });
                }}
              />
              ft
            </label>
            <label>
              Length
              <input
                type="number"
                min={5}
                max={1000}
                defaultValue={layout.lengthFt}
                key={`l${layout.lengthFt}`}
                onBlur={(event) => {
                  const value = Number(event.target.value);
                  if (value !== layout.lengthFt) props.onLayout({ lengthFt: value });
                }}
              />
              ft
            </label>
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
            {layout.widthFt} × {layout.lengthFt} ft · click a bed for details, drag a suggestion onto a bed to plan it
          </p>
        )}
      </div>
    </section>
  );
}
