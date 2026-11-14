import { json, noContent } from "@/lib/http";
import { readSketchLabels } from "@/lib/sketch-labels";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function OPTIONS() {
  return noContent();
}

/** Read the writing on a garden drawing. The browser has already found the boxes and numbered them on the image. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { image?: unknown; count?: unknown } | null;
  const match = typeof body?.image === "string" ? /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(body.image) : null;
  const count = Number(body?.count);
  if (!match || !Number.isInteger(count) || count < 1 || count > 60) return json({ error: "Send the marked-up drawing." }, 400);
  if (match[2].length > 6_000_000) return json({ error: "That image is too big." }, 400);
  return json(await readSketchLabels(match[2], match[1], count));
}
