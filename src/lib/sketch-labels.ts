import { canonicalCrop, familyOf } from "./crops";

export type SketchLabels = {
  ai: boolean;
  beds: Array<{ n: number; name: string | null; crop: string | null; skip: boolean }>;
  widthFt: number | null;
  lengthFt: number | null;
};

const PROMPT = (count: number) => `This is a hand-drawn plan of a community garden. I've drawn ${count} numbered red boxes over the shapes I detected as beds.

For each number, read what is written inside or right next to that box:
- "name": a short name for the bed, using the writing (e.g. "Carrot row", "Space X", "North border"). If nothing is written, null.
- "crop": the plant growing there if the writing names one (e.g. "carrots", "sweet potato", "trees"), else null.
- "skip": true only if the box is clearly not a bed (a legend, a title box, a compass, a path).

If the drawing writes the overall garden size in feet (like "40 x 30 ft", width first), return it; otherwise null.

Reply with JSON only, no other text:
{"beds":[{"n":1,"name":"...","crop":null,"skip":false}],"widthFt":null,"lengthFt":null}`;

/** Ask Claude to read the labels in a drawing. Returns ai:false (and no labels) when no API key is set or anything fails. */
export async function readSketchLabels(base64: string, mime: string, count: number): Promise<SketchLabels> {
  const empty: SketchLabels = { ai: false, beds: [], widthFt: null, lengthFt: null };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || count < 1) return empty;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: key });
    const result = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
      max_tokens: 1200,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mime as "image/jpeg", data: base64 } },
            { type: "text", text: PROMPT(count) },
          ],
        },
      ],
    });
    const block = result.content.find((item) => item.type === "text");
    if (!block || block.type !== "text") return empty;
    return { ...parseLabels(block.text, count), ai: true };
  } catch (error) {
    console.error("[sketch] couldn't read labels", error);
    return empty;
  }
}

export function parseLabels(text: string, count: number): Omit<SketchLabels, "ai"> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const out: Omit<SketchLabels, "ai"> = { beds: [], widthFt: null, lengthFt: null };
  if (start < 0 || end <= start) return out;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return out;
  }
  const obj = raw as { beds?: unknown; widthFt?: unknown; lengthFt?: unknown };
  const size = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 5 && n <= 1000 ? Math.round(n) : null;
  };
  out.widthFt = size(obj.widthFt);
  out.lengthFt = size(obj.lengthFt);
  if (!Array.isArray(obj.beds)) return out;
  for (const item of obj.beds as Array<Record<string, unknown>>) {
    const n = Number(item?.n);
    if (!Number.isInteger(n) || n < 1 || n > count || out.beds.some((b) => b.n === n)) continue;
    const name = typeof item.name === "string" && item.name.trim() ? item.name.replace(/\s+/g, " ").trim().slice(0, 60) : null;
    let crop: string | null = null;
    if (typeof item.crop === "string" && item.crop.trim()) {
      const c = canonicalCrop(item.crop.toLowerCase().trim());
      crop = familyOf(c) ? c : null;
    }
    out.beds.push({ n, name, crop, skip: item.skip === true });
  }
  return out;
}
