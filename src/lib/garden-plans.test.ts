import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { overlaps } from "./bed-space";
import { familyOf } from "./crops";
import { buildGardenPlans, GARDEN_L_FT, GARDEN_W_FT } from "./garden-plans";
import { isPerennial } from "./perennials";

describe("the garden's real 2025 and 2026 plans", () => {
  const plans = buildGardenPlans("2026-11-14");

  it("lays out the 2026 plots inside the garden without overlaps", () => {
    assert.equal(plans.beds.length, 28);
    for (const bed of plans.beds) {
      const g = bed.geometry!;
      assert.ok(g.x >= 0 && g.y >= 0 && g.x + g.w <= GARDEN_W_FT + 0.01 && g.y + g.h <= GARDEN_L_FT + 0.01, bed.name);
    }
    for (let i = 0; i < plans.beds.length; i++)
      for (let j = i + 1; j < plans.beds.length; j++)
        assert.ok(!overlaps(plans.beds[i].geometry!, plans.beds[j].geometry!), `${plans.beds[i].name} / ${plans.beds[j].name}`);
  });

  it("puts last year's crops in the plots in the same spot, never in the mint borders", () => {
    const where = Object.fromEntries(plans.mapping.map(([label, plot]) => [label, plot]));
    assert.equal(where["Beans"], "Plot 12"); // under this year's beans
    assert.equal(where["Sweet potatoes"], "Plot 17");
    for (const p of plans.plantings.filter((x) => x.season_year === 2025 && !isPerennial(x.crop))) {
      const crops = plans.plantings.filter((x) => x.bed_id === p.bed_id && x.season_year === 2026).map((x) => x.crop);
      assert.ok(!crops.length || !crops.every(isPerennial), `${p.crop} in a mint border`);
    }
  });

  it("uses crops the app knows, and closes out finished seasons", () => {
    const unknown = [...new Set(plans.plantings.map((p) => p.crop).filter((c) => !familyOf(c)))];
    assert.deepEqual(unknown, ["grain"]); // "unknown grain??" on the plan
    for (const p of plans.plantings) {
      if (isPerennial(p.crop)) assert.equal(p.removed_date, null);
      else assert.ok(p.removed_date && p.removed_date <= "2026-11-14", p.id);
    }
  });
});
