import { readdir } from "node:fs/promises";
import path from "node:path";
import { spriteFileKey } from "./pixel-sprites";
import { reconcilePriorityTasks } from "./planner";
import type { Store } from "./store";
import { gardenTz, todayYmd } from "./time";
import { toPublicPerson, type Bed, type GardenLayout, type Photo, type Planting, type PublicPerson, type Task, type WorkSession } from "./types";

export type GardenData = {
  today: string;
  timezone: string;
  layout: GardenLayout;
  people: PublicPerson[];
  beds: Bed[];
  plantings: Planting[];
  sessions: WorkSession[];
  photos: Photo[];
  tasks: Task[];
  /** Drawings dropped into public/sprites, keyed by crop or sprite name. */
  sprites: Record<string, string>;
};

async function customSprites(): Promise<Record<string, string>> {
  try {
    const files = await readdir(path.join(process.cwd(), "public", "sprites"));
    const out: Record<string, string> = {};
    for (const file of files) {
      if (!/\.(png|gif|webp|svg)$/i.test(file)) continue;
      out[spriteFileKey(file)] = `/sprites/${encodeURIComponent(file)}`;
    }
    return out;
  } catch {
    return {};
  }
}

export async function loadGarden(store: Store, now = new Date()): Promise<GardenData> {
  const timeZone = gardenTz();
  // Same reconcile as the calendar so map markers and the priority list share one source of truth.
  const tasks = await reconcilePriorityTasks(store, now);
  const [sprites, layout, people, beds, plantings, sessions, photos] = await Promise.all([
    customSprites(),
    store.getLayout(),
    store.listPeople(),
    store.listBeds(),
    store.listPlantings(),
    store.listSessions(),
    store.listPhotos(),
  ]);
  return {
    today: todayYmd(now, timeZone),
    timezone: timeZone,
    layout,
    people: people.map(toPublicPerson),
    beds: beds.filter((bed) => !bed.archived),
    plantings,
    sessions,
    photos,
    tasks,
    sprites,
  };
}
