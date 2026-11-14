import { getStore } from "@/lib/db";
import { json, noContent } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function OPTIONS() {
  return noContent();
}

export async function GET() {
  return json(await (await getStore()).listSessions());
}
