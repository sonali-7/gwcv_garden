import { canonicalCrop, familyOf } from "./crops";
import { explainGeminiError, geminiModels, geminiText } from "./gemini";

export type LabeledBed = { n: number; name: string | null; crops: string[]; skip: boolean };
export type MissedBed = { name: string; crops: string[]; box: [number, number, number, number] };
export type EdgeDimension = { edge: string; value: number; unit: "m" | "ft" };

export type SketchLabels = {
  ai: boolean;
  beds: LabeledBed[];
  /** Beds the model can see that have no numbered box, with a rough box as fractions of the image (x0, y0, x1, y1). */
  missed: MissedBed[];
  /** Measurements written along the lettered sides of the garden's outline. */
  dimensions: EdgeDimension[];
  units: "m" | "ft" | null;
  /** Overall size, when the drawing writes it as one (like "40 x 30 ft"), in feet. */
  widthFt: number | null;
  lengthFt: number | null;
  /** Only when no boxes were found: the garden's outer edge as fractions of the image (x0, y0, x1, y1). */
  garden: [number, number, number, number] | null;
};

const PROMPT = (count: number, edges: string[]) => `These two images are the same plan of a community garden. In the second, I've marked the ${count} beds I found with red numbers to the left of red boxes${edges.length ? `, and lettered the longer sides of the garden's outline in blue (${edges.join(", ")})` : ""}.

For each red number, read the label written in or right next to that bed:
- "name": the label, cleaned up and kept short (e.g. "Kale / Peas", "Sweet potatoes", "Some herbs"). If it has no label, null.
- "crops": every plant the label names, as simple lowercase singular names (e.g. ["kale", "peas"], ["sweet potato"], ["marigold", "forget-me-not", "flowers"], ["herbs"]). Use [] for "nothing", "empty", or no label.
- "skip": true only if it's clearly not a growing bed (a pond, water tank, shed, path, compost, legend or title box).

"missed": any beds with a label that have NO red box, with a rough box as fractions of the image width and height: [x0, y0, x1, y1].

"dimensions": every measurement written along a ${edges.length ? "lettered blue side" : "side of the garden"}, e.g. {"edge": "A", "value": 9, "unit": "m"}. ${edges.length ? "Match each to the nearest lettered side it describes." : "Use edge \"\" if there are no letters."}

"units": "m" or "ft", whichever the drawing uses, else null.
"widthFt" / "lengthFt": only if the drawing states the whole garden's size in one place (like "40 x 30 ft"), converted to feet; else null.

Reply with JSON only:
{"beds":[{"n":1,"name":"...","crops":[],"skip":false}],"missed":[],"dimensions":[],"units":null,"widthFt":null,"lengthFt":null}`;

/**
 * For drawings where the browser found no closed boxes (often sketches whose corners don't quite meet),
 * Gemini finds the beds itself. Its boxes are rough; people check them before building.
 */
const FIND_PROMPT = `This image is a hand-drawn plan of a community garden. Find every growing bed drawn on it.

"missed": one entry per bed:
- "name": the label written in or right next to it, cleaned up and kept short (e.g. "Kale / Peas"), or "Bed" if it has none.
- "crops": every plant the label names, as simple lowercase singular names (e.g. ["kale", "peas"]). Use [] for "nothing", "empty", or no label.
- "box": where the bed's lines are, as fractions of the image width and height: [x0, y0, x1, y1]. Follow the drawn lines closely, even where they don't quite meet at the corners. Boxes must not overlap each other: for an L-shaped or curved bed, box only its biggest straight part, so it doesn't cover the beds beside it.
Leave out things that clearly aren't growing beds (a pond, water tank, shed, path, compost, legend or title).

"garden": the garden's outer edge as [x0, y0, x1, y1] fractions of the image. If no outer edge is drawn, the box around all the beds.

"units": "m" or "ft", whichever the drawing uses, else null.
"widthFt" / "lengthFt": the width and length of the "garden" box in feet, worked out from measurements written on the drawing (e.g. a bed side marked "4 m" tells you the scale). Null if nothing is measured.

Reply with JSON only:
{"missed":[{"name":"...","crops":[],"box":[0,0,0,0]}],"garden":null,"units":null,"widthFt":null,"lengthFt":null}`;

type Image = { base64: string; mime: string };

/** The first model gets this long before the backup model is tried; the backup gets READ_TIMEOUT_MS. */
const FIRST_TRY_MS = 40_000;
const READ_TIMEOUT_MS = 40_000;

/**
 * Ask Gemini to read a drawing. Returns ai:false (and nothing read) when there's no API key.
 * Throws a short, user-facing message when Gemini fails, is out of quota, or takes too long.
 */
export async function readSketchLabels(original: Image, marked: Image | null, count: number, edges: string[]): Promise<SketchLabels> {
  const empty: SketchLabels = { ai: false, beds: [], missed: [], dimensions: [], units: null, widthFt: null, lengthFt: null, garden: null };
  if (!process.env.GEMINI_API_KEY || (count > 0 && !marked)) return empty;
  const models = geminiModels().join(" / ");
  const started = Date.now();
  let text: string | null;
  try {
    text = await geminiText(
      count > 0 && marked
        ? [
            { inline_data: { mime_type: original.mime, data: original.base64 } },
            { inline_data: { mime_type: marked.mime, data: marked.base64 } },
            { text: PROMPT(count, edges) },
          ]
        : [{ inline_data: { mime_type: original.mime, data: original.base64 } }, { text: FIND_PROMPT }],
      { maxOutputTokens: 8000, responseMimeType: "application/json" },
      READ_TIMEOUT_MS,
      FIRST_TRY_MS,
    );
  } catch (error) {
    console.error(`[sketch] ${models} failed after ${Date.now() - started}ms:`, error instanceof Error ? error.message : error);
    throw new Error(explainGeminiError(error));
  }
  console.log(`[sketch] ${models} ${count ? `read ${count} beds` : "looked for beds"} in ${Date.now() - started}ms`);
  if (!text?.trim()) throw new Error("Gemini sent back an empty answer. Try again.");
  return { ...parseLabels(text, count, edges), ai: true };
}


function cleanCrops(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const raw = item.toLowerCase().replace(/[^a-z\- ']/g, " ").replace(/\s+/g, " ").trim();
    if (!raw || raw.length > 30 || raw === "nothing" || raw === "empty") continue;
    const known = canonicalCrop(raw);
    const crop = familyOf(known) ? known : raw;
    if (!out.includes(crop)) out.push(crop);
  }
  return out.slice(0, 4);
}

function cleanName(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim().slice(0, 60) : null;
}

/** [x0, y0, x1, y1] as fractions of the image, or null if it isn't a real box. */
function fractionBox(value: unknown): [number, number, number, number] | null {
  const box = Array.isArray(value) ? value.map(Number) : [];
  if (box.length !== 4 || box.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) return null;
  const [x0, y0, x1, y1] = box;
  return x1 - x0 < 0.005 || y1 - y0 < 0.005 ? null : [x0, y0, x1, y1];
}

type Box = [number, number, number, number];

/**
 * Trim boxes so none overlap (plots in the garden can't). For each overlapping pair, cut one box back to the
 * other's edge, choosing the cut that loses the least area. Returns new boxes in the same order.
 */
export function separateBoxes(boxes: Box[]): Box[] {
  const out = boxes.map((b) => [...b] as Box);
  const area = (b: Box) => (b[2] - b[0]) * (b[3] - b[1]);
  const MIN = 0.01;
  for (let pass = 0; pass < 50; pass++) {
    let changed = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        if (Math.min(a[2], b[2]) - Math.max(a[0], b[0]) <= 1e-9 || Math.min(a[3], b[3]) - Math.max(a[1], b[1]) <= 1e-9) continue;
        let best: { box: Box; to: Box; loss: number } | null = null;
        for (const [box, other] of [[a, b], [b, a]] as const) {
          const cuts: Box[] = [
            [box[0], box[1], other[0], box[3]], // pull its right side back
            [other[2], box[1], box[2], box[3]], // push its left side over
            [box[0], box[1], box[2], other[1]], // pull its bottom up
            [box[0], other[3], box[2], box[3]], // push its top down
          ];
          for (const to of cuts) {
            if (to[2] - to[0] < MIN || to[3] - to[1] < MIN) continue;
            const loss = area(box) - area(to);
            if (loss >= 0 && (!best || loss < best.loss)) best = { box, to, loss };
          }
        }
        if (!best) continue;
        best.box.splice(0, 4, ...best.to);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

export function parseLabels(text: string, count: number, edges: string[] = []): Omit<SketchLabels, "ai"> {
  const out: Omit<SketchLabels, "ai"> = { beds: [], missed: [], dimensions: [], units: null, widthFt: null, lengthFt: null, garden: null };
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return out;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return out;
  }
  const size = (v: unknown) => {
    const n = Number(v);
    return v !== null && Number.isFinite(n) && n >= 3 && n <= 1000 ? Math.round(n * 10) / 10 : null;
  };
  out.widthFt = size(raw.widthFt);
  out.lengthFt = size(raw.lengthFt);
  out.units = raw.units === "m" || raw.units === "ft" ? raw.units : null;

  if (Array.isArray(raw.beds)) {
    for (const item of raw.beds as Array<Record<string, unknown>>) {
      const n = Number(item?.n);
      if (!Number.isInteger(n) || n < 1 || n > count || out.beds.some((b) => b.n === n)) continue;
      out.beds.push({ n, name: cleanName(item.name), crops: cleanCrops(item.crops ?? item.crop), skip: item.skip === true });
    }
  }
  if (Array.isArray(raw.missed)) {
    for (const item of (raw.missed as Array<Record<string, unknown>>).slice(0, 30)) {
      const box = fractionBox(item?.box);
      const name = cleanName(item?.name);
      if (!name || !box) continue;
      out.missed.push({ name, crops: cleanCrops(item.crops), box });
    }
  }
  separateBoxes(out.missed.map((m) => m.box)).forEach((box, i) => (out.missed[i].box = box));
  out.garden = fractionBox(raw.garden);
  if (Array.isArray(raw.dimensions)) {
    for (const item of raw.dimensions as Array<Record<string, unknown>>) {
      const edge = typeof item?.edge === "string" ? item.edge.trim().toUpperCase() : "";
      const value = Number(item?.value);
      const unit = item?.unit === "m" || item?.unit === "ft" ? item.unit : out.units;
      if (!unit || !Number.isFinite(value) || value <= 0 || value > 2000) continue;
      if (edges.length && !edges.includes(edge)) continue;
      out.dimensions.push({ edge, value, unit });
    }
  }
  if (!out.units && out.dimensions.length) out.units = out.dimensions[0].unit;
  return out;
}
