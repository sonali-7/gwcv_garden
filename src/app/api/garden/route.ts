import { getStore } from "@/lib/db";
import { loadGarden } from "@/lib/garden-data";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return json(await loadGarden(await getStore()));
}
