import { reconcileGardenState } from "./planner";
import { toPublicPerson, type DashboardData } from "./types";
import { gardenTz, startOfWeekYmd, todayYmd } from "./time";
import type { Store } from "./store";

export async function loadDashboard(store: Store, weekStart: string | null, now = new Date()): Promise<DashboardData> {
  const timeZone = gardenTz();
  const today = todayYmd(now, timeZone);
  const week = weekStart && /^\d{4}-\d{2}-\d{2}$/.test(weekStart) ? weekStart : startOfWeekYmd(now, timeZone);
  // One reconcile pass for tasks + garden rows; other dashboard bits load beside it.
  const [garden, people, photos, allThreads, demoPhones] = await Promise.all([
    reconcileGardenState(store, now),
    store.listPeople(),
    store.listPhotos(),
    store.listThreads(),
    store.listDemoPhones(),
  ]);

  const threads: DashboardData["threads"] = {};
  for (const person of people) {
    threads[person.id] = allThreads[person.phone] ?? [];
  }

  let newThread: DashboardData["newSender"]["thread"] = [];
  let available = true;
  if (demoPhones.length) {
    const conversations = await Promise.all(demoPhones.map((phone) => store.getConversation(phone)));
    for (let i = 0; i < demoPhones.length; i += 1) {
      const phone = demoPhones[i];
      const person = people.find((item) => item.phone === phone);
      if (!person || conversations[i].pending?.kind === "name") {
        newThread = allThreads[phone] ?? [];
        available = true;
        break;
      }
    }
  }

  return {
    weekStart: week,
    today,
    timezone: timeZone,
    people: people.map(toPublicPerson),
    beds: garden.beds,
    plantings: garden.plantings,
    sessions: garden.sessions,
    tasks: garden.tasks,
    photos,
    threads,
    newSender: { available, thread: newThread },
  };
}
