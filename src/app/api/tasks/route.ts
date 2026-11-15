import { getStore } from "@/lib/db";
import { json, noContent } from "@/lib/http";
import { reconcilePriorityTasks } from "@/lib/planner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function OPTIONS() {
  return noContent();
}

export async function GET() {
  const store = await getStore();
  return json(await reconcilePriorityTasks(store));
}
