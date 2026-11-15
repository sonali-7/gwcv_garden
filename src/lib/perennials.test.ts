import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalCrop, familyOf } from "./crops";
import { nitrogenBalance } from "./nitrogen";
import { establishedDate, harvestSeason, isPerennial, isPermanentPlot, nextReady } from "./perennials";
import { inGroundOn } from "./plantings";
import { adviseBed } from "./recommend";
import type { Bed, Planting } from "./types";

const today = "2026-11-14";
const bed = { id: "b1", name: "Plot 1" } as Bed;
let n = 0;
function grew(crop: string, planted_date: string, extra: Partial<Planting> = {}): Planting {
  return {
    id: `p${++n}`,
    bed_id: "b1",
    crop,
    planted_date,
    expected_harvest_date: planted_date,
    removed_date: null,
    season_year: Number(planted_date.slice(0, 4)),
    days_to_maturity: 365,
    source_session_id: null,
    ...extra,
  };
}

describe("perennials", () => {
  it("knows the common ones by any spelling, with a family for rotation and nitrogen", () => {
    for (const name of ["raspberries", "Strawberries", "roses", "asparagus", "rhubarb", "chives", "trees"]) {
      assert.ok(isPerennial(name), name);
      assert.ok(familyOf(canonicalCrop(name)), name);
    }
    assert.equal(isPerennial("tomatoes"), false);
  });

  it("stays in the ground when looking years ahead, until someone pulls it", () => {
    const rasp = grew("raspberry", "2025-04-01");
    assert.equal(inGroundOn(rasp, "2029-08-01", today), true);
    assert.equal(inGroundOn({ ...rasp, removed_date: "2026-10-01" }, "2027-08-01", today), false);
  });

  it("works out its harvest season each year, waiting for the first one", () => {
    const rasp = grew("raspberry", "2026-04-01"); // first harvest the summer after planting
    assert.deepEqual(harvestSeason(rasp, "2026-08-01"), { state: "later", from: "2027-07-01", first: true });
    assert.deepEqual(harvestSeason(rasp, "2027-08-15"), { state: "now", until: "2027-09-30" });
    assert.deepEqual(harvestSeason(rasp, "2027-11-01"), { state: "later", from: "2028-07-01", first: false });
    assert.deepEqual(harvestSeason(grew("asparagus", "2026-04-01"), today), { state: "later", from: "2028-04-01", first: true });
    assert.deepEqual(harvestSeason(grew("rose", "2020-05-01"), today), { state: "none" });
    assert.equal(nextReady(grew("rose", "2020-05-01"), today), "9999-12-31");
  });

  it("makes a plot permanent: no suggestions, and it doesn't count for rotation", () => {
    const advice = adviseBed(bed, [grew("raspberry", "2024-04-01")], today);
    assert.equal(advice.permanent, true);
    assert.equal(advice.recommendations.length, 0);
    assert.equal(isPermanentPlot([grew("raspberry", "2024-04-01"), grew("lettuce", "2026-10-01")]), false);
    // Once pulled, the raspberries don't block their family or count as the previous crop.
    const after = adviseBed(bed, [grew("raspberry", "2022-04-01", { removed_date: "2026-09-01" })], today);
    assert.equal(after.permanent, false);
    assert.ok(after.recommendations.length > 0);
    assert.equal(after.avoid.length, 0);
  });

  it("counts toward nitrogen for every year it's in the ground", () => {
    // Asparagus is a heavy feeder: in the ground both of the last two years.
    assert.equal(nitrogenBalance([grew("asparagus", "2023-04-01")], today).score, -3);
    // Planted this spring: only the last year.
    assert.equal(nitrogenBalance([grew("asparagus", "2026-04-01")], today).score, -2);
  });

  it("treats perennials on an imported plan as established", () => {
    assert.equal(establishedDate("asparagus", today), "2024-01-01");
    assert.equal(establishedDate("rose", today), today);
    assert.equal(establishedDate("tomatoes", today), today);
  });
});

describe("searching for a plant", async () => {
  const { searchPlants } = await import("./plant-search");
  const advice = adviseBed(bed, [grew("cabbage", "2026-05-01", { expected_harvest_date: "2026-07-20", removed_date: "2026-07-25" })], today);

  it("finds plants by any spelling, word, or family", () => {
    assert.equal(searchPlants("tomato", advice)[0].crop, "tomatoes");
    assert.equal(searchPlants("raspberries", advice)[0].crop, "raspberry");
    assert.ok(searchPlants("berr", advice).some((h) => h.crop === "strawberry"));
    assert.ok(searchPlants("brassica", advice).some((h) => h.crop === "broccoli"));
    assert.deepEqual(searchPlants("   ", advice), []);
  });

  it("says when rotation rules a plant out here, even one without a planting guide", () => {
    const collards = searchPlants("collards", advice)[0];
    assert.equal(collards.crop, "collards");
    assert.match(collards.avoid?.reason ?? "", /Brassica family/);
    const garlic = searchPlants("garlic", advice)[0];
    assert.equal(garlic.avoid, null);
    assert.ok(garlic.rec);
    assert.ok(searchPlants("asparagus", advice)[0].perennial);
  });
});
