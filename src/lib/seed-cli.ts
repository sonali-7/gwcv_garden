import { getStore } from "./db";
import { buildSeed } from "./seed";

async function main() {
  const store = await getStore();
  await store.replaceAll(buildSeed(new Date()));
  console.log("Seeded the garden log.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "seed failed");
  process.exit(1);
});
