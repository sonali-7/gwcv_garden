import { reconcilePriorityTasks } from "./planner";
import { toPublicPerson, type DashboardData } from "./types";
import { gardenTz, startOfWeekYmd, todayYmd } from "./time";
import type { Store } from "./store";

export async function loadDashboard(store: Store, weekStart: string | null, now = new Date()): Promise<DashboardData> {
  const timeZone = gardenTz();
  const today = todayYmd(now, timeZone);
  const week = weekStart && /^\d{4}-\d{2}-\d{2}$/.test(weekStart) ? weekStart : startOfWeekYmd(now, timeZone);
  // On calendar open (and week reload): rebuild from the garden, drop stale DB task rows.
  const tasks = await reconcilePriorityTasks(store, now);
  const [people, beds, plantings, sessions, photos] = await Promise.all([
    store.listPeople(),
    store.listBeds(),
    store.listPlantings(),
    store.listSessions(),
    store.listPhotos(),
  ]);

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
