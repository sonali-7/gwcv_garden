"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CROP_GUIDE } from "@/lib/recommend";
import { detectSketch, toFeet, type Detection } from "@/lib/sketch-detect";
import type { SketchLabels } from "@/lib/sketch-labels";
import type { GardenLayout } from "@/lib/types";

type Row = { name: string; crop: string; include: boolean };
type Result = { created: number; moved: number; removed: number; planted: number; kept: string[] };

const CROPS = ["trees", ...CROP_GUIDE.map((item) => item.crop)];
const DETECT_PX = 520;
const PREVIEW_PX = 1100;
const COLORS = ["#d4433a", "#3e6fd8", "#1f9a8a", "#c4579c", "#b8912a", "#8a63c4", "#c2410c", "#4f9a3c"];

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't open that image. Try a JPG or PNG."));
    img.src = url;
  });
}

function scaled(img: HTMLImageElement, max: number): HTMLCanvasElement {
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function SketchImport(props: {
  open: boolean;
  layout: GardenLayout;
  onClose: () => void;
  onDone: (result: Result) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [sensitivity, setSensitivity] = useState(0.5);
  const [detection, setDetection] = useState<Detection | null>(null);
  const [groupRows, setGroupRows] = useState<Row[]>([]);
  const [widthFt, setWidthFt] = useState(props.layout.widthFt);
  const [lengthFt, setLengthFt] = useState(props.layout.lengthFt);
  const [lengthTouched, setLengthTouched] = useState(false);
  const [mode, setMode] = useState<"replace" | "add">("replace");
  const [background, setBackground] = useState(false);
  const [reading, setReading] = useState<"idle" | "busy" | "done" | "off">("idle");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (props.open && !el.open) el.showModal();
    if (!props.open && el.open) el.close();
  }, [props.open]);

  function reset() {
    setImg(null);
    setPreviewUrl("");
    setDetection(null);
    setGroupRows([]);
    setReading("idle");
    setError("");
    setLengthTouched(false);
    setWidthFt(props.layout.widthFt);
    setLengthFt(props.layout.lengthFt);
  }

  // Run detection whenever the picture or the sensitivity changes.
  useEffect(() => {
    if (!img) return;
    const canvas = scaled(img, DETECT_PX);
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    const found = detectSketch({ width: data.width, height: data.height, data: data.data }, { sensitivity });
    setDetection(found);
    const groups = new Set(found.beds.map((b) => b.group)).size;
    setGroupRows((prev) =>
      Array.from({ length: groups }, (_, i) => prev[i] ?? { name: `Bed ${i + 1}`, crop: "", include: true }),
    );
    if (!lengthTouched && found.frame.w > 0) setLengthFt(Math.max(5, Math.round((widthFt * found.frame.h) / found.frame.w)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, sensitivity]);

  async function pick(file: File | undefined) {
    if (!file) return;
    reset();
    try {
      const image = await loadImage(file);
      setImg(image);
      setPreviewUrl(scaled(image, PREVIEW_PX).toDataURL("image/jpeg", 0.85));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open that image.");
    }
  }

  /** Number the boxes on the picture and ask Claude to read the writing next to each. */
  async function readLabels() {
    if (!img || !detection || !detection.beds.length) return;
    setReading("busy");
    setError("");
    const canvas = scaled(img, 1200);
    const ctx = canvas.getContext("2d")!;
    const k = canvas.width / detection.width;
    ctx.lineWidth = Math.max(3, canvas.width / 300);
    ctx.font = `bold ${Math.round(canvas.width / 30)}px sans-serif`;
    ctx.textBaseline = "top";
    for (const bed of detection.beds) {
      const { x, y, w, h } = bed.rect;
      ctx.strokeStyle = "#ff1a1a";
      ctx.strokeRect(x * k, y * k, w * k, h * k);
      if (bed.part === 0) {
        const label = String(bed.group + 1);
        const tw = ctx.measureText(label).width + 10;
        ctx.fillStyle = "#ff1a1a";
        ctx.fillRect(x * k, y * k, tw, canvas.width / 26);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, x * k + 5, y * k + 3);
      }
    }
    try {
      const response = await fetch("/api/layout/sketch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: canvas.toDataURL("image/jpeg", 0.85), count: groupRows.length }),
      });
      const labels = (await response.json()) as SketchLabels & { error?: string };
      if (!response.ok) throw new Error(labels.error || "Couldn't read the drawing.");
      if (!labels.ai) {
        setReading("off");
        return;
      }
      setGroupRows((rows) =>
        rows.map((row, i) => {
          const found = labels.beds.find((b) => b.n === i + 1);
          if (!found) return row;
          return {
            name: found.name ?? row.name,
            crop: found.crop && CROPS.includes(found.crop) ? found.crop : row.crop,
            include: !found.skip,
          };
        }),
      );
      if (labels.widthFt) setWidthFt(labels.widthFt);
      if (labels.lengthFt) {
        setLengthFt(labels.lengthFt);
        setLengthTouched(true);
      }
      setReading("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read the drawing.");
      setReading("idle");
    }
  }

  // Read labels automatically once boxes are found for a new picture.
  useEffect(() => {
    if (detection && detection.beds.length && reading === "idle") void readLabels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detection]);

  const feet = useMemo(() => (detection ? toFeet(detection, widthFt, lengthFt) : []), [detection, widthFt, lengthFt]);
  const included = detection ? detection.beds.filter((b) => groupRows[b.group]?.include) : [];

  async function create() {
    if (!detection) return;
    setSaving(true);
    setError("");
    const beds = detection.beds.flatMap((bed, i) => {
      const row = groupRows[bed.group];
      if (!row?.include) return [];
      const name = bed.parts > 1 && bed.part > 0 ? `${row.name} (part ${bed.part + 1})` : row.name;
      return [{ name, crop: row.crop || null, geometry: feet[i], group: bed.group }];
    });
    try {
      const response = await fetch("/api/beds/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          widthFt,
          lengthFt,
          beds,
          backgroundDataUrl: background ? cropToFrame() : undefined,
        }),
      });
      const result = (await response.json()) as Result & { error?: string };
      if (!response.ok) throw new Error(result.error || "Couldn't build the garden.");
      props.onDone(result);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't build the garden.");
    } finally {
      setSaving(false);
    }
  }

  /** The drawing cut to the garden's edge, so it lines up behind the beds. */
  function cropToFrame(): string | undefined {
    if (!img || !detection) return undefined;
    const k = img.naturalWidth / detection.width;
    const f = detection.frame;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1400 / (f.w * k));
    canvas.width = Math.round(f.w * k * scale);
    canvas.height = Math.round(f.h * k * scale);
    canvas.getContext("2d")!.drawImage(img, f.x * k, f.y * k, f.w * k, f.h * k, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  }

  return (
    <dialog
      ref={dialog}
      className="sketch-dialog"
      onClose={props.onClose}
      onCancel={() => props.onClose()}
      aria-labelledby="sketch-title"
    >
      <header className="sketch-head">
        <h2 id="sketch-title">Build the garden from a drawing</h2>
        <button type="button" className="texty" onClick={props.onClose} aria-label="Close">
          ✕
        </button>
      </header>

      {!img ? (
        <div
          className={dragging ? "sketch-drop over" : "sketch-drop"}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void pick(event.dataTransfer.files?.[0]);
          }}
        >
          <svg viewBox="0 0 120 80" width="150" aria-hidden="true" className="sketch-example">
            <rect x="4" y="4" width="112" height="72" fill="#fffdf6" stroke="#2b1d14" strokeWidth="2.5" />
            <rect x="12" y="10" width="96" height="14" fill="none" stroke="#2b1d14" strokeWidth="2" />
            <rect x="12" y="30" width="22" height="20" fill="none" stroke="#2b1d14" strokeWidth="2" />
            <rect x="12" y="55" width="22" height="16" fill="#8a63c4" />
            <path d="M42 30h66v12H62v29H42z" fill="none" stroke="#2b1d14" strokeWidth="2" />
            <text x="16" y="20" fontSize="7" fontFamily="sans-serif">
              trees
            </text>
            <text x="14" y="42" fontSize="6" fontFamily="sans-serif">
              carrots
            </text>
          </svg>
          <div>
            <p>
              <strong>Draw the garden on plain paper</strong>, take a photo, and drop it here.
            </p>
            <ul>
              <li>Draw each bed as a closed box, or color it in solid.</li>
              <li>Draw a box around the whole garden to set the scale.</li>
              <li>Write the bed's name or crop inside it, and the size somewhere (like “40 x 30 ft”).</li>
            </ul>
            <div className="sketch-buttons">
              <button type="button" className="pill on" onClick={() => fileInput.current?.click()}>
                Choose a drawing
              </button>
              <button
                type="button"
                className="texty"
                onClick={async () => {
                  const blob = await (await fetch("/sample-garden-drawing.png")).blob();
                  void pick(new File([blob], "sample.png", { type: blob.type }));
                }}
              >
                Try a sample drawing
              </button>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="sr"
              onChange={(event) => {
                void pick(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>
        </div>
      ) : (
        <div className="sketch-review">
          <div className="sketch-preview">
            <div className="sketch-stage">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="Your garden drawing" />
              {detection ? (
                <svg viewBox={`0 0 ${detection.width} ${detection.height}`} preserveAspectRatio="none">
                  <rect
                    x={detection.frame.x}
                    y={detection.frame.y}
                    width={detection.frame.w}
                    height={detection.frame.h}
                    fill="none"
                    stroke="#2b1d14"
                    strokeDasharray="6 4"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                  {detection.beds.map((bed, i) => {
                    const row = groupRows[bed.group];
                    const color = COLORS[bed.group % COLORS.length];
                    const on = row?.include !== false;
                    return (
                      <g key={i} opacity={on ? 1 : 0.3}>
                        <rect
                          x={bed.rect.x}
                          y={bed.rect.y}
                          width={bed.rect.w}
                          height={bed.rect.h}
                          fill={color}
                          fillOpacity={hover === bed.group ? 0.35 : 0.15}
                          stroke={color}
                          strokeWidth={hover === bed.group ? 4 : 2.5}
                          vectorEffect="non-scaling-stroke"
                        />
                        {bed.part === 0 ? (
                          <g transform={`translate(${bed.rect.x} ${bed.rect.y})`}>
                            <rect width={detection.width / 22} height={detection.width / 22} fill={color} />
                            <text
                              x={detection.width / 44}
                              y={detection.width / 32}
                              fill="#fff"
                              fontSize={detection.width / 32}
                              fontFamily="sans-serif"
                              fontWeight="700"
                              textAnchor="middle"
                            >
                              {bed.group + 1}
                            </text>
                          </g>
                        ) : null}
                      </g>
                    );
                  })}
                </svg>
              ) : null}
            </div>
            <div className="sketch-controls">
              <label>
                Missing faint lines? Pick up lighter lines
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={sensitivity}
                  onChange={(event) => setSensitivity(Number(event.target.value))}
                />
              </label>
              <button type="button" className="texty" onClick={() => fileInput.current?.click()}>
                Use a different drawing
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                className="sr"
                onChange={(event) => {
                  void pick(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </div>
          </div>

          <div className="sketch-side">
            <p className="sketch-status" role="status">
              {!detection
                ? "Looking for beds…"
                : detection.beds.length === 0
                  ? "No beds found. Try the slider, or make sure each box is closed at the corners."
                  : `Found ${groupRows.length} bed${groupRows.length === 1 ? "" : "s"}${detection.frameFromBorder ? " inside the garden edge" : ""}.`}
              {reading === "busy" ? " Reading the writing…" : null}
              {reading === "done" ? (
                <button type="button" className="texty small" onClick={() => void readLabels()}>
                  Read the writing again
                </button>
              ) : null}
            </p>
            {reading === "off" ? (
              <p className="sketch-note">
                Type the names in. To read handwriting automatically, add <code>ANTHROPIC_API_KEY</code> to <code>.env</code>.
              </p>
            ) : null}

            {groupRows.length ? (
              <ol className="sketch-rows">
                {groupRows.map((row, i) => {
                  const parts = detection?.beds.filter((b) => b.group === i) ?? [];
                  const ft = parts.map((p) => feet[detection!.beds.indexOf(p)]);
                  return (
                    <li
                      key={i}
                      onMouseEnter={() => setHover(i)}
                      onMouseLeave={() => setHover(null)}
                      className={row.include ? "" : "off"}
                    >
                      <span className="num" style={{ background: COLORS[i % COLORS.length] }}>
                        {i + 1}
                      </span>
                      <div className="fields">
                        <input
                          aria-label={`Name for bed ${i + 1}`}
                          value={row.name}
                          disabled={!row.include}
                          onChange={(event) =>
                            setGroupRows((rows) => rows.map((r, j) => (j === i ? { ...r, name: event.target.value } : r)))
                          }
                        />
                        <select
                          aria-label={`Crop for bed ${i + 1}`}
                          value={row.crop}
                          disabled={!row.include}
                          onChange={(event) =>
                            setGroupRows((rows) => rows.map((r, j) => (j === i ? { ...r, crop: event.target.value } : r)))
                          }
                        >
                          <option value="">Nothing growing</option>
                          {CROPS.map((crop) => (
                            <option key={crop} value={crop}>
                              {crop}
                            </option>
                          ))}
                        </select>
                        <small>
                          {ft.map((g) => `${g.w}×${g.h} ft`).join(" + ")}
                          {parts.length > 1 ? " (L-shape, saved as two beds)" : ""}
                        </small>
                      </div>
                      <label className="keep">
                        <input
                          type="checkbox"
                          checked={row.include}
                          onChange={(event) =>
                            setGroupRows((rows) => rows.map((r, j) => (j === i ? { ...r, include: event.target.checked } : r)))
                          }
                        />
                        Bed
                      </label>
                    </li>
                  );
                })}
              </ol>
            ) : null}

            <fieldset className="sketch-size">
              <legend>Garden size</legend>
              <label>
                Width
                <input
                  type="number"
                  min={5}
                  max={1000}
                  value={widthFt}
                  onChange={(event) => {
                    const w = Number(event.target.value);
                    setWidthFt(w);
                    if (!lengthTouched && detection && w > 0) setLengthFt(Math.max(5, Math.round((w * detection.frame.h) / detection.frame.w)));
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
                  value={lengthFt}
                  onChange={(event) => {
                    setLengthFt(Number(event.target.value));
                    setLengthTouched(true);
                  }}
                />
                ft
              </label>
            </fieldset>

            <fieldset className="sketch-mode">
              <legend>Your current beds</legend>
              <label>
                <input type="radio" name="mode" checked={mode === "replace"} onChange={() => setMode("replace")} />
                Replace them with the drawing
              </label>
              <label>
                <input type="radio" name="mode" checked={mode === "add"} onChange={() => setMode("add")} />
                Keep them and add these
              </label>
              <small>
                A drawn bed with the same name as a current one moves it and keeps its history. Beds with planting history are never deleted.
              </small>
            </fieldset>
            <label className="sketch-bg">
              <input type="checkbox" checked={background} onChange={(event) => setBackground(event.target.checked)} />
              Show the drawing behind the map
            </label>

            {error ? <p className="banner">{error}</p> : null}
            <button
              type="button"
              className="pill on wide"
              onClick={create}
              disabled={saving || !included.length || !widthFt || !lengthFt || reading === "busy"}
            >
              {saving ? "Building…" : `Build garden (${new Set(included.map((b) => b.group)).size} beds)`}
            </button>
          </div>
        </div>
      )}
      {!img && error ? <p className="banner">{error}</p> : null}
    </dialog>
  );
}
