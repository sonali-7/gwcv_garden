import { getStore } from "@/lib/db";
import { json, noContent } from "@/lib/http";
import { buildSeed } from "@/lib/seed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function OPTIONS() {
  return noContent();
}

export async function POST() {
  const store = await getStore();
  await store.replaceAll(buildSeed(new Date()));
  return json({ ok: true });
}
