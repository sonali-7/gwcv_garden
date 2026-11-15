import type {
  Conversation,
  DatabaseShape,
  Person,
  Photo,
  Planting,
  Task,
  ThreadMessage,
  WorkSession,
  Bed,
  GardenLayout,
  CropProfile,
} from "./types";
import { blankConversation } from "./types";

export interface Store {
  dump(): Promise<DatabaseShape>;
  replaceAll(data: DatabaseShape): Promise<void>;
  listPeople(): Promise<Person[]>;
  getPerson(id: string): Promise<Person | null>;
  getPersonByPhone(phone: string): Promise<Person | null>;
  insertPerson(person: Person): Promise<void>;
  listBeds(): Promise<Bed[]>;
  insertBed(bed: Bed): Promise<void>;
  updateBed(bed: Bed): Promise<void>;
  deleteBed(id: string): Promise<void>;
  getLayout(): Promise<GardenLayout>;
  saveLayout(layout: GardenLayout): Promise<void>;
  /** Plants looked up with Gemini (crop-profiles.ts). */
  listCropProfiles(): Promise<CropProfile[]>;
  saveCropProfile(profile: CropProfile): Promise<void>;
  listPlantings(): Promise<Planting[]>;
  insertPlanting(planting: Planting): Promise<void>;
  updatePlanting(planting: Planting): Promise<void>;
  deletePlanting(id: string): Promise<void>;
  listSessions(): Promise<WorkSession[]>;
  insertSession(session: WorkSession): Promise<void>;
  updateSession(session: WorkSession): Promise<void>;
  deleteSession(id: string): Promise<void>;
  listPhotos(): Promise<Photo[]>;
  insertPhoto(photo: Photo): Promise<void>;
  updatePhoto(photo: Photo): Promise<void>;
  listTasks(): Promise<Task[]>;
  saveTasks(tasks: Task[]): Promise<void>;
  getThread(phone: string): Promise<ThreadMessage[]>;
  appendThread(phone: string, message: ThreadMessage): Promise<void>;
  getConversation(phone: string): Promise<Conversation>;
  saveConversation(phone: string, conversation: Conversation): Promise<void>;
  listDemoPhones(): Promise<string[]>;
  addDemoPhone(phone: string): Promise<void>;
  hasSeenEvent(id: string): Promise<boolean>;
  markEvent(id: string): Promise<void>;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function rememberedConversation(conversation: Conversation | undefined): Conversation {
  return clone(conversation ?? blankConversation());
}
