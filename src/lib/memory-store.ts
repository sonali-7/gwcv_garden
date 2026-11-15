import { clone, rememberedConversation, type Store } from "./store";
import { defaultLayout, emptyDatabase, type Bed, type CropProfile, type GardenLayout, type Conversation, type DatabaseShape, type Person, type Photo, type Planting, type Task, type ThreadMessage, type WorkSession } from "./types";

export function createMemoryStore(initial?: DatabaseShape): Store {
  let db = clone(initial ?? emptyDatabase());

  return {
    async dump() {
      return clone(db);
    },
    async replaceAll(data) {
      db = clone(data);
    },
    async listPeople() {
      return clone(db.people);
    },
    async getPerson(id) {
      return clone(db.people.find((person) => person.id === id) ?? null);
    },
    async getPersonByPhone(phone) {
      return clone(db.people.find((person) => person.phone === phone) ?? null);
    },
    async insertPerson(person: Person) {
      db.people.push(clone(person));
    },
    async listBeds() {
      return clone(db.beds);
    },
    async insertBed(bed: Bed) {
      db.beds.push(clone(bed));
    },
    async updateBed(bed: Bed) {
      db.beds = db.beds.map((item) => (item.id === bed.id ? clone(bed) : item));
    },
    async deleteBed(id) {
      db.beds = db.beds.filter((item) => item.id !== id);
    },
    async getLayout() {
      return clone({ ...defaultLayout(), ...db.layout });
    },
    async saveLayout(layout: GardenLayout) {
      db.layout = clone(layout);
    },
    async listCropProfiles() {
      return clone(db.cropProfiles ?? []);
    },
    async saveCropProfile(profile: CropProfile) {
      db.cropProfiles = [...(db.cropProfiles ?? []).filter((item) => item.crop !== profile.crop), clone(profile)];
    },
    async listPlantings() {
      return clone(db.plantings);
    },
    async insertPlanting(planting: Planting) {
      db.plantings.push(clone(planting));
    },
    async updatePlanting(planting: Planting) {
      db.plantings = db.plantings.map((item) => (item.id === planting.id ? clone(planting) : item));
    },
    async deletePlanting(id) {
      db.plantings = db.plantings.filter((item) => item.id !== id);
    },
    async listSessions() {
      return clone(db.sessions);
    },
    async insertSession(session: WorkSession) {
      db.sessions.push(clone(session));
    },
    async updateSession(session: WorkSession) {
      db.sessions = db.sessions.map((item) => (item.id === session.id ? clone(session) : item));
    },
    async deleteSession(id) {
      db.sessions = db.sessions.filter((item) => item.id !== id);
    },
    async listPhotos() {
      return clone(db.photos);
    },
    async insertPhoto(photo: Photo) {
      db.photos.push(clone(photo));
    },
    async updatePhoto(photo: Photo) {
      db.photos = db.photos.map((item) => (item.id === photo.id ? clone(photo) : item));
    },
    async listTasks() {
      return clone(db.tasks);
    },
    async saveTasks(tasks: Task[]) {
      db.tasks = clone(tasks);
    },
    async getThread(phone) {
      return clone(db.threads[phone] ?? []);
    },
    async appendThread(phone, message: ThreadMessage) {
      const list = db.threads[phone] ?? [];
      list.push(clone(message));
      db.threads[phone] = list;
    },
    async getConversation(phone) {
      return rememberedConversation(db.conversations[phone]);
    },
    async saveConversation(phone, conversation: Conversation) {
      db.conversations[phone] = clone(conversation);
    },
    async listDemoPhones() {
      return clone(db.demoPhones);
    },
    async addDemoPhone(phone) {
      if (!db.demoPhones.includes(phone)) db.demoPhones.push(phone);
    },
    async hasSeenEvent(id) {
      return db.seenEvents.includes(id);
    },
    async markEvent(id) {
      if (!db.seenEvents.includes(id)) db.seenEvents.push(id);
      if (db.seenEvents.length > 500) db.seenEvents.splice(0, db.seenEvents.length - 500);
    },
  };
}
