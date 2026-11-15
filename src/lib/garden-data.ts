import { readdir } from "node:fs/promises";
import path from "node:path";
import { spriteFileKey } from "./pixel-sprites";
import { reconcileGardenState } from "./planner";
import type { Store } from "./store";
import { gardenTz, todayYmd } from "./time";
import { toPublicPerson, type Bed, type CropProfile, type GardenLayout, type Photo, type Planting, type PublicPerson, type Task, type WorkSession } from "./types";

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
  /** Plants looked up with Gemini; the browser adds them to its crop tables too. */
  cropProfiles: CropProfile[];
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
  // Same reconcile as the calendar; reuse its beds/plantings/sessions instead of listing twice.
  const [garden, sprites, layout, people, photos, cropProfiles] = await Promise.all([
    reconcileGardenState(store, now),
    customSprites(),
    store.getLayout(),
    store.listPeople(),
    store.listPhotos(),
    store.listCropProfiles(),
  ]);
  return {
    today: todayYmd(now, timeZone),
    timezone: timeZone,
    layout,
    people: people.map(toPublicPerson),
    beds: garden.beds.filter((bed) => !bed.archived),
    plantings: garden.plantings,
    sessions: garden.sessions,
    photos,
    tasks: garden.tasks,
    sprites,
    cropProfiles,
  };
}
