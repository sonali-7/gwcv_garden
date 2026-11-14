import { buildTasks } from "./priority";
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
};

export async function loadGarden(store: Store, now = new Date()): Promise<GardenData> {
  const timeZone = gardenTz();
  const [layout, people, beds, plantings, sessions, photos] = await Promise.all([
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
    beds,
    plantings,
    sessions,
    photos,
    tasks: buildTasks({ now, beds, plantings, sessions, timeZone }),
  };
}
