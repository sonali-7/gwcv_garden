import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adviseBed, nextSowDate } from "./recommend";
import { buildSeed } from "./seed";

const now = new Date("2026-11-14T14:00:00Z");
const seed = buildSeed(now);
const today = "2026-11-14";
const bed = (id: string) => seed.beds.find((item) => item.id === id)!;

describe("plant recommendations", () => {
  it("rotates away from last season's family and suggests what can go in now", () => {
    const advice = adviseBed(bed("bed-x"), seed.plantings, today);
    assert.equal(advice.current.length, 0);
    assert.ok(advice.avoid.some((item) => item.crop === "tomatoes"), "tomatoes grew here in 2025");
    const top = advice.recommendations.slice(0, 2).map((item) => item.crop);
    assert.ok(top.includes("garlic") || top.includes("winter rye"), `got ${top.join(", ")}`);
    assert.ok(advice.recommendations.every((item) => item.family !== "nightshade"));
  });

  it("follows a heavy feeder with a nitrogen fixer", () => {
    const advice = adviseBed(bed("bed-x"), seed.plantings, today);
    const beans = advice.recommendations.find((item) => item.crop === "beans");
    assert.ok(beans?.reasons.some((reason) => reason.includes("nitrogen")));
  });

  it("waits until an occupied bed is free", () => {
    const advice = adviseBed(bed("bed-sp"), seed.plantings, today);
    assert.equal(advice.current[0]?.crop, "sweet potato");
    assert.ok(advice.freeFrom > today);
    assert.ok(advice.recommendations.every((item) => item.plantOn >= advice.freeFrom));
    assert.ok(advice.avoid.some((item) => item.crop === "sweet potato"));
  });

  it("finds the next sowing window", () => {
    assert.equal(nextSowDate("2026-11-14", [3, 4]), "2027-03-01");
    assert.equal(nextSowDate("2026-04-10", [3, 4]), "2026-04-10");
  });
});

describe("planned plantings", () => {
  it("turns a planned crop into the real planting when someone texts it", async () => {
    const { createMemoryStore } = await import("./memory-store");
    const { handleIncoming } = await import("./handle-message");
    const store = createMemoryStore(buildSeed(new Date()));
    const day = new Date().toISOString().slice(0, 10);
    await store.insertPlanting({
      id: "plan-garlic",
      bed_id: "bed-x",
      crop: "garlic",
      planted_date: "2099-01-01",
      expected_harvest_date: "2099-08-29",
      removed_date: null,
      season_year: 2099,
      days_to_maturity: 240,
      source_session_id: null,
    });
    await handleIncoming(store, { phone: "+15555501002", text: "from 9-10am I planted garlic in space x", image: null });
    const garlic = (await store.listPlantings()).filter((p) => p.crop === "garlic");
    assert.equal(garlic.length, 1);
    assert.equal(garlic[0].id, "plan-garlic");
    assert.ok(garlic[0].source_session_id);
    assert.ok(garlic[0].planted_date <= "2099-01-01" && garlic[0].planted_date >= addDaysSafe(day, -1));
  });
});

function addDaysSafe(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
