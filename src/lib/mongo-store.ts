import { MongoClient, type Collection, type Db, type Document } from "mongodb";
import { buildSeed } from "./seed";
import { rememberedConversation, type Store } from "./store";
import { blankConversation, defaultLayout, type Conversation, type DatabaseShape, type GardenLayout, type ThreadMessage } from "./types";

type Meta = { demoPhones: string[]; seenEvents: string[] };
type Row = Document & { _id: string };

function rows(db: Db, name: string): Collection<Row> {
  return db.collection<Row>(name);
}

export type ConnectedStore = Store & { ping(): Promise<void> };

export function createMongoStore(uri: string, dbName: string): ConnectedStore {
  const client = new MongoClient(uri);
  let ready: Promise<Db> | null = null;

  async function database(): Promise<Db> {
    if (!ready) {
      ready = (async () => {
        await client.connect();
        const db = client.db(dbName);
        const count = await db.collection("people").countDocuments();
        if (count === 0) await writeAll(db, buildSeed(new Date()));
        return db;
      })();
    }
    return ready;
  }

  async function meta(db: Db): Promise<Meta> {
    const doc = await rows(db, "meta").findOne({ _id: "meta" });
    return { demoPhones: doc?.demoPhones ?? [], seenEvents: doc?.seenEvents ?? [] };
  }

  return {
    async ping() {
      const db = await database();
      await db.command({ ping: 1 });
    },
    async dump() {
      const db = await database();
      const [people, beds, plantings, sessions, photos, tasks, threads, conversations, info] = await Promise.all([
        docs(db, "people"),
        docs(db, "beds"),
        docs(db, "plantings"),
        docs(db, "workSessions"),
        docs(db, "photos"),
        docs(db, "tasks"),
        rows(db, "threads").find({}).toArray(),
        rows(db, "conversations").find({}).toArray(),
        meta(db),
      ]);
      const layout = await readLayout(db);
      return {
        people,
        beds,
        plantings,
        sessions,
        photos,
        tasks,
        threads: Object.fromEntries(threads.map((thread) => [String(thread._id), (thread.messages as ThreadMessage[]) ?? []])),
        conversations: Object.fromEntries(
          conversations.map((conversation) => {
            const { _id, ...rest } = conversation;
            return [String(_id), { ...blankConversation(), ...(rest as Conversation) }];
          }),
        ),
        demoPhones: info.demoPhones,
        seenEvents: info.seenEvents,
        layout,
      } as DatabaseShape;
    },
    async replaceAll(data) {
      const db = await database();
      await writeAll(db, data);
    },
    async listPeople() {
      return docs(await database(), "people");
    },
    async getPerson(id) {
      return one(await database(), "people", id);
    },
    async getPersonByPhone(phone) {
      const db = await database();
      const doc = await rows(db, "people").findOne({ phone });
      return doc ? strip(doc) : null;
    },
    async insertPerson(person) {
      await rows(await database(), "people").insertOne({ ...person, _id: person.id });
    },
    async listBeds() {
      return docs(await database(), "beds");
    },
    async insertBed(bed) {
      await rows(await database(), "beds").insertOne({ ...bed, _id: bed.id });
    },
    async updateBed(bed) {
      await rows(await database(), "beds").replaceOne({ _id: bed.id }, { ...bed, _id: bed.id });
    },
    async deleteBed(id) {
      await rows(await database(), "beds").deleteOne({ _id: id });
    },
    async getLayout() {
      return readLayout(await database());
    },
    async saveLayout(layout) {
      await rows(await database(), "gardenConfig").replaceOne({ _id: "layout" }, { _id: "layout", ...layout }, { upsert: true });
    },
    async listPlantings() {
      return docs(await database(), "plantings");
    },
    async insertPlanting(planting) {
      await rows(await database(), "plantings").insertOne({ ...planting, _id: planting.id });
    },
    async updatePlanting(planting) {
      await rows(await database(), "plantings").replaceOne({ _id: planting.id }, { ...planting, _id: planting.id });
    },
    async deletePlanting(id) {
      await rows(await database(), "plantings").deleteOne({ _id: id });
    },
    async listSessions() {
      return docs(await database(), "workSessions");
    },
    async insertSession(session) {
      await rows(await database(), "workSessions").insertOne({ ...session, _id: session.id });
    },
    async updateSession(session) {
      await rows(await database(), "workSessions").replaceOne({ _id: session.id }, { ...session, _id: session.id });
    },
    async deleteSession(id) {
      await rows(await database(), "workSessions").deleteOne({ _id: id });
    },
    async listPhotos() {
      return docs(await database(), "photos");
    },
    async insertPhoto(photo) {
      await rows(await database(), "photos").insertOne({ ...photo, _id: photo.id });
    },
    async updatePhoto(photo) {
      await rows(await database(), "photos").replaceOne({ _id: photo.id }, { ...photo, _id: photo.id });
    },
    async listTasks() {
      return docs(await database(), "tasks");
    },
    async saveTasks(tasks) {
      const unique = [...new Map(tasks.map((task) => [task.id, task])).values()];
      // One writer at a time in this process; retries cover Atlas races with another server.
      saveTasksTail = saveTasksTail.then(
        async () => writeTasks(rows(await database(), "tasks"), unique),
        async () => writeTasks(rows(await database(), "tasks"), unique),
      );
      await saveTasksTail;
    },
    async getThread(phone) {
      const doc = await rows(await database(), "threads").findOne({ _id: phone });
      return (doc?.messages as ThreadMessage[] | undefined) ?? [];
    },
    async appendThread(phone, message) {
      const threads = rows(await database(), "threads");
      const existing = await threads.findOne({ _id: phone });
      const messages = [...((existing?.messages as ThreadMessage[] | undefined) ?? []), message];
      await threads.replaceOne({ _id: phone }, { _id: phone, messages }, { upsert: true });
    },
    async getConversation(phone) {
      const doc = await rows(await database(), "conversations").findOne({ _id: phone });
      if (!doc) return blankConversation();
      const { _id, ...rest } = doc;
      return rememberedConversation(rest as Conversation);
    },
    async saveConversation(phone, conversation) {
      await rows(await database(), "conversations").replaceOne({ _id: phone }, { ...conversation, _id: phone }, { upsert: true });
    },
    async listDemoPhones() {
      return (await meta(await database())).demoPhones;
    },
    async addDemoPhone(phone) {
      const db = await database();
      const info = await meta(db);
      if (!info.demoPhones.includes(phone)) info.demoPhones.push(phone);
      await rows(db, "meta").replaceOne({ _id: "meta" }, { _id: "meta", ...info }, { upsert: true });
    },
    async hasSeenEvent(id) {
      return (await meta(await database())).seenEvents.includes(id);
    },
    async markEvent(id) {
      const db = await database();
      const info = await meta(db);
      if (!info.seenEvents.includes(id)) info.seenEvents.push(id);
      if (info.seenEvents.length > 500) info.seenEvents.splice(0, info.seenEvents.length - 500);
      await rows(db, "meta").replaceOne({ _id: "meta" }, { _id: "meta", ...info }, { upsert: true });
    },
  };
}

/** Serialize task rewrites so Strict Mode / two tabs don't collide in one Node process. */
let saveTasksTail: Promise<void> = Promise.resolve();

function isDupKey(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code: number }).code === 11000);
}

async function writeTasks(col: Collection<Row>, tasks: Array<{ id: string } & Record<string, unknown>>): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      if (tasks.length === 0) {
        await col.deleteMany({});
        return;
      }
      for (const task of tasks) {
        const doc = { ...task, _id: task.id };
        try {
          await col.replaceOne({ _id: task.id }, doc, { upsert: true });
        } catch (error) {
          // Concurrent upserts of a missing _id can both try to insert; the loser retries as update.
          if (!isDupKey(error)) throw error;
          await col.replaceOne({ _id: task.id }, doc);
        }
      }
      await col.deleteMany({ _id: { $nin: tasks.map((task) => task.id) } });
      return;
    } catch (error) {
      if (!isDupKey(error) || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

async function writeAll(db: Db, data: DatabaseShape): Promise<void> {
  const collections = ["gardenConfig", "people", "beds", "plantings", "workSessions", "photos", "tasks", "threads", "conversations", "meta"];
  for (const name of collections) await rows(db, name).deleteMany({});
  if (data.people.length) await rows(db, "people").insertMany(data.people.map((item) => ({ ...item, _id: item.id })));
  if (data.beds.length) await rows(db, "beds").insertMany(data.beds.map((item) => ({ ...item, _id: item.id })));
  if (data.plantings.length) {
    await rows(db, "plantings").insertMany(data.plantings.map((item) => ({ ...item, _id: item.id })));
  }
  if (data.sessions.length) {
    await rows(db, "workSessions").insertMany(data.sessions.map((item) => ({ ...item, _id: item.id })));
  }
  if (data.photos.length) await rows(db, "photos").insertMany(data.photos.map((item) => ({ ...item, _id: item.id })));
  if (data.tasks.length) {
    const tasks = [...new Map(data.tasks.map((item) => [item.id, item])).values()];
    await rows(db, "tasks").insertMany(tasks.map((item) => ({ ...item, _id: item.id })));
  }
  const threads = Object.entries(data.threads);
  if (threads.length) {
    await rows(db, "threads").insertMany(threads.map(([phone, messages]) => ({ _id: phone, messages })));
  }
  const conversations = Object.entries(data.conversations);
  if (conversations.length) {
    await rows(db, "conversations").insertMany(conversations.map(([phone, conversation]) => ({ ...conversation, _id: phone })));
  }
  await rows(db, "gardenConfig").insertOne({ _id: "layout", ...(data.layout ?? defaultLayout()) });
  await rows(db, "meta").insertOne({
    _id: "meta",
    demoPhones: data.demoPhones,
    seenEvents: data.seenEvents,
  });
}

async function docs<T>(db: Db, name: string): Promise<T[]> {
  const found = await rows(db, name).find({}).toArray();
  return found.map((row) => strip<T>(row));
}

async function one<T>(db: Db, name: string, id: string): Promise<T | null> {
  const row = await rows(db, name).findOne({ _id: id });
  return row ? strip<T>(row) : null;
}

function strip<T>(row: Record<string, unknown>): T {
  const { _id, ...rest } = row;
  return rest as T;
}

async function readLayout(db: Db): Promise<GardenLayout> {
  const row = await rows(db, "gardenConfig").findOne({ _id: "layout" });
  return row ? { ...defaultLayout(), ...strip<Partial<GardenLayout>>(row) } : defaultLayout();
}
