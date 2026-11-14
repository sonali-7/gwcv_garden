import { json, noContent } from "@/lib/http";
import { readSketchLabels } from "@/lib/sketch-labels";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function OPTIONS() {
  return noContent();
}

function image(value: unknown) {
  const match = typeof value === "string" ? /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(value) : null;
  if (!match || match[2].length > 5_000_000) return null;
  return { mime: match[1], base64: match[2] };
}

/** Read the writing on a garden drawing. The browser has already found the boxes and numbered them on a copy. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const original = image(body?.original);
  const marked = image(body?.marked);
  const count = Number(body?.count);
  const edges = Array.isArray(body?.edges)
    ? (body.edges as unknown[]).filter((e): e is string => typeof e === "string" && /^[A-Z]$/.test(e)).slice(0, 26)
    : [];
  if (!original || !marked || !Number.isInteger(count) || count < 1 || count > 80) {
    return json({ error: "Send the drawing and the marked-up copy." }, 400);
  }
  return json(await readSketchLabels(original, marked, count, edges));
}
