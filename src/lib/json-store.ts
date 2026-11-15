import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createMemoryStore } from "./memory-store";
import { buildSeed } from "./seed";
import type { Store } from "./store";
import type { DatabaseShape } from "./types";

const WRITES = new Set<keyof Store>([
  "replaceAll",
  "insertPerson",
  "insertBed",
  "updateBed",
  "deleteBed",
  "saveLayout",
  "saveCropProfile",
  "insertPlanting",
  "updatePlanting",
  "deletePlanting",
  "insertSession",
  "updateSession",
  "deleteSession",
  "insertPhoto",
  "updatePhoto",
  "saveTasks",
  "appendThread",
  "saveConversation",
  "addDemoPhone",
  "markEvent",
]);

export function createJsonStore(filePath: string): Store {
  const memory = createMemoryStore();
  let queue: Promise<unknown> = Promise.resolve();
  let loaded = false;

  async function load(): Promise<void> {
    try {
      const raw = await readFile(filePath, "utf8");
      await memory.replaceAll(JSON.parse(raw) as DatabaseShape);
    } catch {
      await memory.replaceAll(buildSeed(new Date()));
      await persist();
    }
  }

  async function persist(): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(await memory.dump(), null, 2));
  }

  function run<T>(write: boolean, fn: () => Promise<T>): Promise<T> {
    const job = queue.then(async () => {
      if (!loaded) {
        loaded = true;
        await load();
      }
      const result = await fn();
      if (write) await persist();
      return result;
    });
    queue = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }

  const store = {} as Store;
  for (const key of Object.keys(memory) as Array<keyof Store>) {
    store[key] = ((...args: unknown[]) =>
      run(WRITES.has(key), () => (memory[key] as (...inner: unknown[]) => Promise<unknown>)(...args))) as never;
  }
  return store;
}

export function jsonStorePath(): string {
  return path.join(process.cwd(), "data", "store.json");
}
