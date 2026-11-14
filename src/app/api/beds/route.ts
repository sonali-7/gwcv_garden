import { randomUUID } from "node:crypto";
import { getStore } from "@/lib/db";
import { cleanGeometry, cleanName } from "@/lib/garden-api";
import { json, noContent } from "@/lib/http";
import type { Bed } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function OPTIONS() {
  return noContent();
}

export async function GET() {
  return json(await (await getStore()).listBeds());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const store = await getStore();
  const [beds, layout] = await Promise.all([store.listBeds(), store.getLayout()]);
  if (beds.length >= 60) return json({ error: "That's a lot of beds. Remove one first." }, 400);
  const bed: Bed = {
    id: `bed-${randomUUID().slice(0, 8)}`,
    name: cleanName(body?.name, `Bed ${beds.length + 1}`),
    row: cleanName(body?.row, ""),
    geometry: cleanGeometry(body?.geometry, layout.widthFt, layout.lengthFt) ?? {
      x: 1,
      y: 1,
      w: Math.min(8, layout.widthFt),
      h: Math.min(4, layout.lengthFt),
    },
  };
  await store.insertBed(bed);
  return json(bed, 201);
}
