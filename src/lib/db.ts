import path from "node:path";
import { createJsonStore, jsonStorePath } from "./json-store";
import { createMongoStore, type ConnectedStore } from "./mongo-store";
import type { Store } from "./store";
import { syncCropProfiles } from "./crop-profiles";

const globalStore = globalThis as { __gwcvStore?: Store };

export async function getStore(): Promise<Store> {
  const store = await connect();
  // Plants looked up with Gemini join the crop tables (throttled; see crop-profiles.ts).
  await syncCropProfiles(store);
  return store;
}

async function connect(): Promise<Store> {
  if (globalStore.__gwcvStore) return globalStore.__gwcvStore;
  const uri = process.env.MONGODB_URI;
  if (uri) {
    try {
      const mongo: ConnectedStore = createMongoStore(uri, process.env.MONGODB_DB || "gwcv_garden");
      await mongo.ping();
      globalStore.__gwcvStore = mongo;
      return mongo;
    } catch (error) {
      console.warn("MongoDB unavailable; using the local JSON store.");
      console.warn(error instanceof Error ? error.message : "connection failed");
    }
  }
  globalStore.__gwcvStore = createJsonStore(process.env.GARDEN_STORE_PATH || jsonStorePath());
  return globalStore.__gwcvStore;
}

export function storeFile(): string {
  return process.env.GARDEN_STORE_PATH || path.join(process.cwd(), "data", "store.json");
}
