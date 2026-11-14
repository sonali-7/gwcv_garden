import { canonicalCrop, familyOf } from "./crops";

export type LabeledBed = { n: number; name: string | null; crops: string[]; skip: boolean };
export type MissedBed = { name: string; crops: string[]; box: [number, number, number, number] };
export type EdgeDimension = { edge: string; value: number; unit: "m" | "ft" };

export type SketchLabels = {
  ai: boolean;
  beds: LabeledBed[];
  /** Beds Claude can see that have no numbered box, with a rough box as fractions of the image (x0, y0, x1, y1). */
  missed: MissedBed[];
  /** Measurements written along the lettered sides of the garden's outline. */
  dimensions: EdgeDimension[];
  units: "m" | "ft" | null;
  /** Overall size, when the drawing writes it as one (like "40 x 30 ft"), in feet. */
  widthFt: number | null;
  lengthFt: number | null;
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

type Image = { base64: string; mime: string };

/** Ask Claude to read a drawing. Returns ai:false (and nothing read) without an API key or on any failure. */
export async function readSketchLabels(original: Image, marked: Image, count: number, edges: string[]): Promise<SketchLabels> {
  const empty: SketchLabels = { ai: false, beds: [], missed: [], dimensions: [], units: null, widthFt: null, lengthFt: null };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || count < 1) return empty;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: key });
    const result = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: original.mime as "image/jpeg", data: original.base64 } },
            { type: "image", source: { type: "base64", media_type: marked.mime as "image/jpeg", data: marked.base64 } },
            { type: "text", text: PROMPT(count, edges) },
          ],
        },
      ],
    });
    const block = result.content.find((item) => item.type === "text");
    if (!block || block.type !== "text") return empty;
    return { ...parseLabels(block.text, count, edges), ai: true };
  } catch (error) {
    console.error("[sketch] couldn't read labels", error);
    return empty;
  }
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

export function parseLabels(text: string, count: number, edges: string[] = []): Omit<SketchLabels, "ai"> {
  const out: Omit<SketchLabels, "ai"> = { beds: [], missed: [], dimensions: [], units: null, widthFt: null, lengthFt: null };
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
    for (const item of (raw.missed as Array<Record<string, unknown>>).slice(0, 20)) {
      const box = Array.isArray(item?.box) ? item.box.map(Number) : [];
      const name = cleanName(item?.name);
      if (!name || box.length !== 4 || box.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) continue;
      const [x0, y0, x1, y1] = box;
      if (x1 - x0 < 0.005 || y1 - y0 < 0.005) continue;
      out.missed.push({ name, crops: cleanCrops(item.crops), box: [x0, y0, x1, y1] });
    }
  }
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
