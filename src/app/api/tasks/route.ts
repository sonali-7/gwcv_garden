import { getStore } from "@/lib/db";
import { json, noContent } from "@/lib/http";
import { buildTasks } from "@/lib/priority";
import { gardenTz } from "@/lib/time";
import { gardenRain } from "@/lib/weather";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function OPTIONS() {
  return noContent();
}

export async function GET() {
  const store = await getStore();
  const [beds, plantings, sessions] = await Promise.all([
    store.listBeds(),
    store.listPlantings(),
    store.listSessions(),
  ]);
  const tasks = buildTasks({ now: new Date(), beds, plantings, sessions, timeZone: gardenTz(), rain: await gardenRain(store) });
  await store.saveTasks(tasks);
  return json(tasks);
}
