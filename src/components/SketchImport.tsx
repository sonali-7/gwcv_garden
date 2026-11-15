"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isPdf, pdfFirstPage } from "@/lib/pdf-page";
import { canonicalCrop, knownCrops } from "@/lib/crops";
import {
  boxDownscale,
  detectBest,
  detectSketch,
  outlineToFeet,
  scaleFromDimensions,
  toFeet,
  type DetectedBed,
  type Detection,
} from "@/lib/sketch-detect";
import type { SketchLabels } from "@/lib/sketch-labels";
import type { GardenLayout } from "@/lib/types";
import { fromFt, toFt, type Units } from "@/lib/units";

type Row = { name: string; crops: string; include: boolean };
type Result = { created: number; moved: number; removed: number; planted: number; archived: string[] };

const DETECT_PX = 1600;
const COLORS = ["#d4433a", "#3e6fd8", "#1f9a8a", "#c4579c", "#b8912a", "#8a63c4", "#c2410c", "#4f9a3c"];

function loadImage(file: Blob): Promise<HTMLImageElement> {
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

function splitCrops(text: string): string[] {
  return text
    .split(/[,/;+&]| and /i)
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c && c !== "nothing");
}

/** Repeated names ("Kale", "Kale") get numbers so each bed can be told apart. */
function uniqueNames(names: string[]): string[] {
  const total = new Map<string, number>();
  for (const n of names) total.set(n.toLowerCase(), (total.get(n.toLowerCase()) ?? 0) + 1);
  const seen = new Map<string, number>();
  return names.map((n) => {
    const key = n.toLowerCase();
    if ((total.get(key) ?? 0) < 2) return n;
    const k = (seen.get(key) ?? 0) + 1;
    seen.set(key, k);
    return k === 1 ? n : `${n} ${k}`;
  });
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
  const [missed, setMissed] = useState<DetectedBed[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [units, setUnits] = useState<Units>(props.layout.units);
  const [width, setWidth] = useState(fromFt(props.layout.widthFt, props.layout.units));
  const [length, setLength] = useState(fromFt(props.layout.lengthFt, props.layout.units));
  const [lengthTouched, setLengthTouched] = useState(false);
  const [mode, setMode] = useState<"replace" | "add">("replace");
  // "Using page 1 of 3 from the PDF", or "Opening the PDF…" while it's being drawn.
  const [pdfNote, setPdfNote] = useState("");
  const [reading, setReading] = useState<"idle" | "busy" | "done" | "off">("idle");
  const [scaleNote, setScaleNote] = useState("");
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
    setMissed([]);
    setRows([]);
    setReading("idle");
    setScaleNote("");
    setPdfNote("");
    setError("");
    setLengthTouched(false);
    setUnits(props.layout.units);
    setWidth(fromFt(props.layout.widthFt, props.layout.units));
    setLength(fromFt(props.layout.lengthFt, props.layout.units));
  }

  // The picture at detection size, shrunk by averaging so thin lines survive. Made once per picture.
  const raster = useMemo(() => {
    if (!img) return null;
    const big = scaled(img, 4000);
    const full = big.getContext("2d")!.getImageData(0, 0, big.width, big.height);
    const k = Math.min(1, DETECT_PX / Math.max(big.width, big.height));
    return boxDownscale(
      { width: full.width, height: full.height, data: full.data },
      Math.max(1, Math.round(big.width * k)),
      Math.max(1, Math.round(big.height * k)),
    );
  }, [img]);

  // Find the beds whenever the picture or the sensitivity changes.
  // A new picture tries a few sensitivities and keeps the best; moving the slider overrides it.
  const tuned = useRef<unknown>(null);
  const skipNext = useRef(false);
  useEffect(() => {
    if (!raster) return;
    let found: Detection;
    if (tuned.current !== raster) {
      tuned.current = raster;
      const best = detectBest(raster);
      found = best.detection;
      if (best.sensitivity !== sensitivity) {
        skipNext.current = true;
        setSensitivity(best.sensitivity);
      }
    } else if (skipNext.current) {
      skipNext.current = false;
      return;
    } else {
      found = detectSketch(raster, { sensitivity });
    }
    setDetection(found);
    setMissed([]);
    const groups = new Set(found.beds.map((b) => b.group)).size;
    setRows((prev) => Array.from({ length: groups }, (_, i) => prev[i] ?? { name: `Plot ${i + 1}`, crops: "", include: true }));
    if (!lengthTouched && found.frame.w > 0) setLength(Math.max(1, Math.round(((width * found.frame.h) / found.frame.w) * 10) / 10));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raster, sensitivity]);

  async function pick(file: Blob | undefined) {
    if (!file) return;
    reset();
    try {
      // A PDF plan is drawn to an image first (page 1), then treated like a photo.
      let source: Blob = file;
      if (isPdf(file)) {
        setPdfNote("Opening the PDF…");
        const { image: page, pages } = await pdfFirstPage(file);
        source = page;
        setPdfNote(pages > 1 ? `Using page 1 of ${pages} from the PDF.` : "");
      }
      const image = await loadImage(source);
      setImg(image);
      setPreviewUrl(scaled(image, 1400).toDataURL("image/jpeg", 0.85));
    } catch (err) {
      setPdfNote("");
      setError(
        isPdf(file)
          ? "Couldn't open that PDF. If it's password-protected or damaged, export the plan as a PNG or JPG instead."
          : err instanceof Error
            ? err.message
            : "Couldn't open that image.",
      );
    }
  }

  /** Number the beds and letter the outline's sides on a copy, then ask Gemini to read both. */
  async function readLabels() {
    if (!img || !detection || !detection.beds.length) return;
    setReading("busy");
    setError("");
    const marked = scaled(img, 1600);
    const ctx = marked.getContext("2d")!;
    const k = marked.width / detection.width;
    const tag = Math.max(16, Math.round(marked.width / 70));
    ctx.font = `bold ${Math.round(tag * 0.8)}px sans-serif`;
    ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(2, marked.width / 600);
    for (const bed of detection.beds) {
      const { x, y, w, h } = bed.rect;
      ctx.strokeStyle = "#ff1a1a";
      ctx.strokeRect(x * k, y * k, w * k, h * k);
      if (bed.part !== 0) continue;
      const label = String(bed.group + 1);
      const tw = ctx.measureText(label).width + 8;
      const tx = Math.max(0, x * k - tw - 2);
      const ty = Math.max(0, y * k + Math.min(h * k, tag) / 2 - tag / 2);
      ctx.fillStyle = "#ff1a1a";
      ctx.fillRect(tx, ty, tw, tag);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, tx + 4, ty + tag / 2);
    }
    if (detection.outline) {
      ctx.strokeStyle = "rgba(30, 90, 220, 0.8)";
      ctx.beginPath();
      detection.outline.forEach((p, i) => (i ? ctx.lineTo(p.x * k, p.y * k) : ctx.moveTo(p.x * k, p.y * k)));
      ctx.closePath();
      ctx.stroke();
      const cx = detection.frame.x + detection.frame.w / 2;
      const cy = detection.frame.y + detection.frame.h / 2;
      for (const edge of detection.edges) {
        const mx = (edge.a.x + edge.b.x) / 2;
        const my = (edge.a.y + edge.b.y) / 2;
        // Put the letter just outside the garden, away from the middle.
        const d = Math.hypot(mx - cx, my - cy) || 1;
        const lx = (mx + ((mx - cx) / d) * tag * 0.9) * k;
        const ly = (my + ((my - cy) / d) * tag * 0.9) * k;
        ctx.fillStyle = "#1e5adc";
        ctx.fillRect(lx - tag / 2, ly - tag / 2, tag, tag);
        ctx.fillStyle = "#fff";
        ctx.fillText(edge.label, lx - tag / 4, ly);
      }
    }
    try {
      const response = await fetch("/api/layout/sketch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          original: scaled(img, 1600).toDataURL("image/jpeg", 0.85),
          marked: marked.toDataURL("image/jpeg", 0.85),
          count: rows.length,
          edges: detection.edges.map((e) => e.label),
        }),
      });
      const labels = (await response.json()) as SketchLabels & { error?: string };
      if (!response.ok) throw new Error(labels.error || "Couldn't read the drawing.");
      if (!labels.ai) {
        setReading("off");
        return;
      }
      applyLabels(labels);
      setReading("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read the drawing.");
      setReading("idle");
    }
  }

  function applyLabels(labels: SketchLabels) {
    if (!detection) return;
    const extra: DetectedBed[] = labels.missed.map((m, i) => ({
      rect: {
        x: m.box[0] * detection.width,
        y: m.box[1] * detection.height,
        w: (m.box[2] - m.box[0]) * detection.width,
        h: (m.box[3] - m.box[1]) * detection.height,
      },
      source: "outline",
      group: rows.length + i,
      part: 0,
      parts: 1,
      color: null,
    }));
    setMissed(extra);
    // Plots are named Plot 1, Plot 2, … (not after their crops); what's written in each box fills in its crops.
    // Rename them here, or later by double-clicking a plot.
    setRows((current) => [
      ...current.map((row, i) => {
        const found = labels.beds.find((b) => b.n === i + 1);
        if (!found) return row;
        return { name: row.name, crops: found.crops.join(", "), include: !found.skip };
      }),
      ...labels.missed.map((m, j) => ({ name: `Plot ${current.length + j + 1}`, crops: m.crops.join(", "), include: true })),
    ]);

    // Scale: measurements on the outline's sides beat an overall size, which beats keeping the current one.
    const nextUnits: Units = labels.units ?? units;
    const perUnit = scaleFromDimensions(
      detection,
      labels.dimensions.filter((d) => d.unit === nextUnits),
    );
    if (perUnit) {
      setUnits(nextUnits);
      setWidth(Math.round((detection.frame.w / perUnit) * 10) / 10);
      setLength(Math.round((detection.frame.h / perUnit) * 10) / 10);
      setLengthTouched(true);
      setScaleNote(
        `Size worked out from ${labels.dimensions.map((d) => `${d.value} ${d.unit}`).join(", ")} written on the drawing.`,
      );
    } else if (labels.widthFt && labels.lengthFt) {
      setUnits(nextUnits);
      setWidth(fromFt(labels.widthFt, nextUnits));
      setLength(fromFt(labels.lengthFt, nextUnits));
      setLengthTouched(true);
      setScaleNote("Size read from the drawing.");
    } else if (labels.units) {
      setUnits(labels.units);
    }
  }

  // Read labels automatically once beds are found in a new picture.
  useEffect(() => {
    if (detection && detection.beds.length && reading === "idle") void readLabels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detection]);

  const all = useMemo<Detection | null>(
    () => (detection ? { ...detection, beds: [...detection.beds, ...missed] } : null),
    [detection, missed],
  );
  const widthFt = toFt(width, units);
  const lengthFt = toFt(length, units);
  const feet = useMemo(() => (all ? toFeet(all, widthFt, lengthFt) : []), [all, widthFt, lengthFt]);
  const included = all ? all.beds.filter((b) => rows[b.group]?.include) : [];
  const cropOptions = useMemo(() => [...new Set(knownCrops().map(canonicalCrop))].sort(), []);

  async function create() {
    if (!all || !detection) return;
    setSaving(true);
    setError("");
    const names = uniqueNames(rows.map((r, i) => r.name.trim() || `Plot ${i + 1}`));
    const beds = all.beds.flatMap((bed, i) => {
      const row = rows[bed.group];
      if (!row?.include) return [];
      const base = names[bed.group];
      const name = bed.parts > 1 && bed.part > 0 ? `${base} (part ${bed.part + 1})` : base;
      return [{ name, crops: splitCrops(row.crops), geometry: feet[i], group: bed.group }];
    });
    try {
      const response = await fetch("/api/beds/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          units,
          widthFt,
          lengthFt,
          outline: outlineToFeet(detection, widthFt, lengthFt),
          beds,
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
  const groupCount = rows.length;
  const unitLabel = units === "m" ? "m" : "ft";

  return (
    <dialog ref={dialog} className="sketch-dialog" onClose={props.onClose} onCancel={() => props.onClose()} aria-labelledby="sketch-title">
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
            <path d="M4 4h50v30h62v42H40C25 70 12 60 4 52z" fill="#fffdf6" stroke="#2b1d14" strokeWidth="2.5" />
            <rect x="10" y="9" width="38" height="7" fill="none" stroke="#2b1d14" strokeWidth="1.6" />
            <rect x="10" y="20" width="38" height="7" fill="none" stroke="#2b1d14" strokeWidth="1.6" />
            <rect x="58" y="40" width="50" height="8" fill="none" stroke="#2b1d14" strokeWidth="1.6" />
            <rect x="58" y="54" width="22" height="14" fill="#8a63c4" />
            <text x="14" y="15" fontSize="5" fontFamily="sans-serif">
              kale / peas
            </text>
            <text x="60" y="3" fontSize="6" fontFamily="sans-serif">
              7 m
            </text>
          </svg>
          <div>
            <p>
              <strong>Drop in a drawing or diagram of the garden:</strong> a photo of a sketch, an image from a drawing app, or a PDF.
            </p>
            <ul>
              <li>Draw each bed as a closed box, or a solid block of color.</li>
              <li>Draw the garden's edge around the beds. Curves and odd shapes are fine.</li>
              <li>Write what's in each bed inside its box (“Kale / Peas”, “Nothing”).</li>
              <li>Write lengths along the edges (“7 m”, “40 ft”) to set the size.</li>
            </ul>
            <div className="sketch-buttons">
              <button type="button" className="pill on" onClick={() => fileInput.current?.click()}>
                Choose a drawing
              </button>
              <button
                type="button"
                className="texty"
                onClick={async () => void pick(await (await fetch("/sample-garden-drawing.png")).blob())}
              >
                Try a sample drawing
              </button>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*,application/pdf,.pdf"
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
              {all ? (
                <svg viewBox={`0 0 ${all.width} ${all.height}`} preserveAspectRatio="none">
                  {all.outline ? (
                    <polygon
                      points={all.outline.map((p) => `${p.x},${p.y}`).join(" ")}
                      fill="rgba(63,125,58,0.08)"
                      stroke="#2b1d14"
                      strokeDasharray="6 4"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : (
                    <rect
                      x={all.frame.x}
                      y={all.frame.y}
                      width={all.frame.w}
                      height={all.frame.h}
                      fill="none"
                      stroke="#2b1d14"
                      strokeDasharray="6 4"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {all.beds.map((bed, i) => {
                    const row = rows[bed.group];
                    const color = COLORS[bed.group % COLORS.length];
                    const on = row?.include !== false;
                    const guessed = bed.group >= (detection ? new Set(detection.beds.map((b) => b.group)).size : 0);
                    const tag = all.width / 40;
                    return (
                      <g key={i} opacity={on ? 1 : 0.3}>
                        <rect
                          x={bed.rect.x}
                          y={bed.rect.y}
                          width={bed.rect.w}
                          height={bed.rect.h}
                          fill={color}
                          fillOpacity={hover === bed.group ? 0.35 : 0.14}
                          stroke={color}
                          strokeDasharray={guessed ? "5 4" : undefined}
                          strokeWidth={hover === bed.group ? 4 : 2.5}
                          vectorEffect="non-scaling-stroke"
                        />
                        {bed.part === 0 ? (
                          <g transform={`translate(${Math.max(0, bed.rect.x - tag * 1.1)} ${bed.rect.y})`}>
                            <rect width={tag * 1.05} height={tag} fill={color} />
                            <text x={tag * 0.52} y={tag * 0.74} fill="#fff" fontSize={tag * 0.66} fontFamily="sans-serif" fontWeight="700" textAnchor="middle">
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
                <input type="range" min={0} max={1} step={0.05} value={sensitivity} onChange={(event) => setSensitivity(Number(event.target.value))} />
              </label>
              <button type="button" className="texty" onClick={() => fileInput.current?.click()}>
                Use a different drawing
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/*,application/pdf,.pdf"
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
                  : `Found ${groupCount} bed${groupCount === 1 ? "" : "s"}${detection.outline ? " and the garden's edge" : detection.frameFromBorder ? " inside the garden edge" : ""}.`}
              {reading === "busy" ? " Reading the writing…" : null}
              {missed.length ? ` ${missed.length} more found by reading the labels (dashed). Check their size and position.` : null}
              {reading === "done" ? (
                <button type="button" className="texty small" onClick={() => void readLabels()}>
                  Read the writing again
                </button>
              ) : null}
            </p>
            {reading === "off" ? (
              <p className="sketch-note">
                Type the names in. To read handwriting and sizes automatically, add <code>GEMINI_API_KEY</code> to <code>.env.local</code>.
              </p>
            ) : null}

            {rows.length ? (
              <ol className="sketch-rows">
                <datalist id="crop-names">
                  {cropOptions.map((crop) => (
                    <option key={crop} value={crop} />
                  ))}
                </datalist>
                {rows.map((row, i) => {
                  const parts = all?.beds.filter((b) => b.group === i) ?? [];
                  const ft = parts.map((p) => feet[all!.beds.indexOf(p)]).filter(Boolean);
                  return (
                    <li key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className={row.include ? "" : "off"}>
                      <span className="num" style={{ background: COLORS[i % COLORS.length] }}>
                        {i + 1}
                      </span>
                      <div className="fields">
                        <input
                          aria-label={`Name for bed ${i + 1}`}
                          value={row.name}
                          disabled={!row.include}
                          onChange={(event) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, name: event.target.value } : r)))}
                        />
                        <input
                          aria-label={`Crops in bed ${i + 1}`}
                          placeholder="What's growing (kale, peas)"
                          list="crop-names"
                          value={row.crops}
                          disabled={!row.include}
                          onChange={(event) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, crops: event.target.value } : r)))}
                        />
                        <small>
                          {ft.map((g) => `${fromFt(g.w, units)}×${fromFt(g.h, units)} ${unitLabel}`).join(" + ")}
                          {parts.length > 1 ? " (L-shape, saved as two beds)" : ""}
                        </small>
                      </div>
                      <label className="keep">
                        <input
                          type="checkbox"
                          checked={row.include}
                          onChange={(event) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, include: event.target.checked } : r)))}
                        />
                        Bed
                      </label>
                    </li>
                  );
                })}
              </ol>
            ) : null}

            <fieldset className="sketch-size">
              <legend>Garden size (outer edges)</legend>
              <label>
                Width
                <input
                  type="number"
                  min={1}
                  step={0.5}
                  value={width}
                  onChange={(event) => {
                    const w = Number(event.target.value);
                    setWidth(w);
                    if (!lengthTouched && detection && w > 0) setLength(Math.round(((w * detection.frame.h) / detection.frame.w) * 10) / 10);
                  }}
                />
              </label>
              <label>
                Length
                <input
                  type="number"
                  min={1}
                  step={0.5}
                  value={length}
                  onChange={(event) => {
                    setLength(Number(event.target.value));
                    setLengthTouched(true);
                  }}
                />
              </label>
              <select
                aria-label="Units"
                value={units}
                onChange={(event) => {
                  const next = event.target.value as Units;
                  setWidth(fromFt(toFt(width, units), next));
                  setLength(fromFt(toFt(length, units), next));
                  setUnits(next);
                }}
              >
                <option value="ft">feet</option>
                <option value="m">meters</option>
              </select>
              {scaleNote ? <small>{scaleNote}</small> : null}
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
                A drawn bed with the same name as a current one moves it and keeps its history. Replaced beds with planting history are
                archived: off the map, history kept.
              </small>
            </fieldset>
            {pdfNote ? <p className="sketch-note">{pdfNote}</p> : null}
            {error ? <p className="banner">{error}</p> : null}
            <button
              type="button"
              className="pill on wide"
              onClick={create}
              disabled={saving || !included.length || !(width > 0) || !(length > 0) || reading === "busy"}
            >
              {saving ? "Building…" : `Build garden (${new Set(included.map((b) => b.group)).size} beds)`}
            </button>
          </div>
        </div>
      )}
      {!img && pdfNote ? <p className="sketch-note">{pdfNote}</p> : null}
      {!img && error ? <p className="banner">{error}</p> : null}
    </dialog>
  );
}
