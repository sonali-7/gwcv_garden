import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { carbonSaved, storeFootprint, yieldPerSqFt } from "./carbon";
import { yearScore } from "./sustainability";
import type { Bed, Planting } from "./types";

const plot = (id: string, w = 10, h = 4): Bed => ({ id, name: id, row: "", geometry: { x: 0, y: 0, w, h } });
const size = (bed: Bed) => bed.geometry!.w * bed.geometry!.h;
let n = 0;
function grew(bed_id: string, crop: string, planted_date: string, harvest: string, extra: Partial<Planting> = {}): Planting {
  return {
    id: `c${++n}`,
    bed_id,
    crop,
    planted_date,
    expected_harvest_date: harvest,
    removed_date: null,
    season_year: Number(planted_date.slice(0, 4)),
    days_to_maturity: 80,
    source_session_id: null,
    ...extra,
  };
}

describe("CO₂ estimate", () => {
  it("counts a harvest as plot area × yield × store footprint", () => {
    const est = carbonSaved([plot("a")], [grew("a", "tomatoes", "2026-05-01", "2026-07-20")], "2026-01-01", "2026-11-15", size);
    // 40 sq ft × 0.68 kg/sq ft = 27.2 kg of tomatoes × 2.1 = 57.1 kg CO₂.
    assert.equal(est.foodKg, 27.2);
    assert.equal(est.kg, 57.1);
    assert.deepEqual(est.top, [{ crop: "tomatoes", kg: 57.1 }]);
  });

  it("waits for the harvest, and skips crops pulled well before it", () => {
    const early = carbonSaved([plot("a")], [grew("a", "tomatoes", "2026-05-01", "2026-07-20")], "2026-01-01", "2026-07-01", size);
    assert.equal(early.kg, 0);
    const pulled = grew("a", "tomatoes", "2026-05-01", "2026-07-20", { removed_date: "2026-05-20" });
    assert.equal(carbonSaved([plot("a")], [pulled], "2026-01-01", "2026-11-15", size).harvests, 0);
  });

  it("splits a plot between crops growing in it at the same time", () => {
    const both = [grew("a", "lettuce", "2026-04-01", "2026-05-15"), grew("a", "carrots", "2026-04-01", "2026-06-10")];
    const est = carbonSaved([plot("a")], both, "2026-01-01", "2026-11-15", size);
    // 20 sq ft each: lettuce 5.4 kg, carrots 9 kg.
    assert.equal(est.foodKg, 14.4);
  });

  it("credits legumes for fertilizer and gives flowers and cover crops no food", () => {
    assert.equal(yieldPerSqFt("marigold"), 0);
    assert.equal(yieldPerSqFt("clover"), 0);
    const est = carbonSaved([plot("a")], [grew("a", "clover", "2026-04-01", "2026-06-01")], "2026-01-01", "2026-11-15", size);
    assert.equal(est.foodKg, 0);
    // 40 sq ft × 1 g N × 8 kg CO₂ per kg N.
    assert.equal(est.fertilizerKg, 0.3);
  });

  it("counts a perennial each year it bears, for the harvest months that have passed", () => {
    const berries = grew("a", "raspberry", "2024-04-01", "2025-04-01");
    assert.equal(carbonSaved([plot("a")], [berries], "2024-01-01", "2024-12-31", size).harvests, 0, "too young in its first year");
    const mid = carbonSaved([plot("a")], [berries], "2026-01-01", "2026-08-15", size);
    assert.equal(mid.harvests, 1, "July is done, August isn't");
    const full = carbonSaved([plot("a")], [berries], "2026-01-01", "2026-11-15", size);
    assert.equal(full.foodKg, 5.6);
  });

  it("uses family footprints for crops it doesn't list", () => {
    assert.equal(storeFootprint("broccoli"), 0.51);
    assert.equal(storeFootprint("tomato"), 2.1);
  });

  it("is part of each year's result but not of its score", () => {
    const beds = [plot("a")];
    const s = yearScore(beds, [grew("a", "tomatoes", "2026-05-01", "2026-07-20")], 2026, "2026-11-15");
    assert.equal(s.carbon.kg, 57.1);
    const none = yearScore(beds, [grew("a", "tomatoes", "2026-05-01", "2026-07-20", { status: "planned" })], 2026, "2026-11-15");
    assert.equal(none.carbon.kg, 0, "plans don't count");
  });
});
