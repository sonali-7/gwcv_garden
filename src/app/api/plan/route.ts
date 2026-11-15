import { getStore } from "@/lib/db";
import { json } from "@/lib/http";
import { approveAndSendPlan, liveTasks, proposeWeekPlan } from "@/lib/planner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const store = await getStore();
  const tasks = await liveTasks(store);
  return json({ tasks });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const store = await getStore();

  if (action === "propose") {
    const plan = await proposeWeekPlan(store);
    return json(plan);
  }
  if (action === "approve") {
    const plan = await approveAndSendPlan(store);
    return json(plan);
  }
  return json({ error: 'Send { "action": "propose" } or { "action": "approve" }.' }, 400);
}
