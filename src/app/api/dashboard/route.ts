import { loadDashboard } from "@/lib/dashboard-data";
import { getStore } from "@/lib/db";
import { json, noContent } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function OPTIONS() {
  return noContent();
}

export async function GET(request: Request) {
  const week = new URL(request.url).searchParams.get("week");
  const data = await loadDashboard(await getStore(), week);
  return json(data);
}
