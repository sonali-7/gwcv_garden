import { buildTasks } from "./priority";
import { toPublicPerson, type DashboardData } from "./types";
import { gardenTz, startOfWeekYmd, todayYmd } from "./time";
import type { Store } from "./store";
import { gardenRain } from "./weather";

export async function loadDashboard(store: Store, weekStart: string | null, now = new Date()): Promise<DashboardData> {
  const timeZone = gardenTz();
  const today = todayYmd(now, timeZone);
  const week = weekStart && /^\d{4}-\d{2}-\d{2}$/.test(weekStart) ? weekStart : startOfWeekYmd(now, timeZone);
  const [people, beds, plantings, sessions, photos] = await Promise.all([
    store.listPeople(),
    store.listBeds(),
    store.listPlantings(),
    store.listSessions(),
    store.listPhotos(),
  ]);
  // Tasks are derived from plantings/sessions; no need to write them on every page load
  // (that raced with other tabs on Mongo _id). GET /api/tasks still persists when asked.
  const tasks = buildTasks({ now, beds, plantings, sessions, timeZone, rain: await gardenRain(store) });

  const threads: DashboardData["threads"] = {};
  for (const person of people) {
    threads[person.id] = await store.getThread(person.phone);
  }

  const demoPhones = await store.listDemoPhones();
  let newThread: DashboardData["newSender"]["thread"] = [];
  let available = true;
  for (const phone of demoPhones) {
    const person = people.find((item) => item.phone === phone);
    const conversation = await store.getConversation(phone);
    if (!person || conversation.pending?.kind === "name") {
      newThread = await store.getThread(phone);
      available = true;
      break;
    }
  }

  return {
    weekStart: week,
    today,
    timezone: timeZone,
    people: people.map(toPublicPerson),
    beds,
    plantings,
    sessions,
    tasks,
    photos,
    threads,
    newSender: { available, thread: newThread },
  };
}
