import { getStore } from "./db";
import { buildGardenPlans, HISTORY_PREFIX, PLAN_PREFIX } from "./garden-plans";
import { gardenTz, todayYmd } from "./time";

/**
 * Load the garden's real 2026 plan (as the plots on the map) and its 2025 plan (as history).
 *   npm run load-plans          preview only
 *   npm run load-plans -- --yes write it
 * Writes to MongoDB when MONGODB_URI is set (shared with the whole team), otherwise to data/store.json.
 * Plots already on the map are archived, not deleted, so their history is kept. Running it again replaces
 * what it loaded before.
 */
async function main() {
  const write = process.argv.includes("--yes");
  const today = todayYmd(new Date(), gardenTz());
  const plans = buildGardenPlans(today);
  const store = await getStore();
  const where = "ping" in store ? "MongoDB (shared with the team)" : "the local JSON store";

  const [beds, plantings, layout] = await Promise.all([store.listBeds(), store.listPlantings(), store.getLayout()]);
  const ours = (id: string) => id.startsWith(PLAN_PREFIX) || id.startsWith(HISTORY_PREFIX);
  const oldBeds = beds.filter((bed) => ours(bed.id));
  const oldPlantings = plantings.filter((p) => ours(p.id));
  const toArchive = beds.filter((bed) => !ours(bed.id) && !bed.archived);

  console.log(`Target: ${where}`);
  console.log(`Garden: ${plans.layout.widthFt} x ${plans.layout.lengthFt} ft, outline with ${plans.layout.outline?.length} points`);
  const fromPlan = plans.plantings.filter((p) => p.id.startsWith(PLAN_PREFIX)).length;
  console.log(`Add ${plans.beds.length} plots, ${fromPlan} plantings from the 2026 plan and ${plans.plantings.length - fromPlan} from 2025.`);
  console.log(`Archive ${toArchive.length} plots now on the map (their history is kept).`);
  if (oldBeds.length || oldPlantings.length) console.log(`Replace ${oldBeds.length} plots and ${oldPlantings.length} plantings from an earlier load.`);
  if (!write) {
    console.log("\nPreview only. Run with --yes to write.");
    process.exit(0);
  }

  for (const p of oldPlantings) await store.deletePlanting(p.id);
  for (const bed of oldBeds) await store.deleteBed(bed.id);
  for (const bed of toArchive) await store.updateBed({ ...bed, archived: true });
  for (const bed of plans.beds) await store.insertBed(bed);
  for (const p of plans.plantings) await store.insertPlanting(p);
  await store.saveLayout({ ...layout, ...plans.layout });
  console.log("Done.");
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "loading the plans failed");
  process.exit(1);
});
