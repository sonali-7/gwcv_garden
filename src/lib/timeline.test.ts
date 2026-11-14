import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inGroundOn, plannedAfter } from "./plantings";
import { adviseBed } from "./recommend";
import { buildSeed } from "./seed";
import type { Planting } from "./types";

const seed = buildSeed(new Date("2026-11-14T14:00:00Z"));
const today = "2026-11-14";
const bed = (id: string) => seed.beds.find((item) => item.id === id)!;
const planting = (over: Partial<Planting>): Planting => ({
  id: "p",
  bed_id: "bed-x",
  crop: "carrots",
  planted_date: "2026-09-01",
  expected_harvest_date: "2026-11-01",
  removed_date: null,
  season_year: 2026,
  days_to_maturity: 60,
  source_session_id: null,
  ...over,
});

describe("garden timeline: what's in the ground on a date", () => {
  it("shows the logged record up to today, even past the harvest date", () => {
    assert.equal(inGroundOn(planting({}), today, today), true);
    assert.equal(inGroundOn(planting({}), "2026-08-31", today), false, "not planted yet");
  });

  it("assumes an unremoved crop is cleared two weeks after its harvest, when looking ahead", () => {
    const p = planting({ expected_harvest_date: "2026-12-01" });
    assert.equal(inGroundOn(p, "2026-12-14", today), true);
    assert.equal(inGroundOn(p, "2026-12-15", today), false);
  });

  it("trusts a removal date and keeps trees", () => {
    assert.equal(inGroundOn(planting({ removed_date: "2027-03-01" }), "2027-02-01", today), true);
    assert.equal(inGroundOn(planting({ crop: "apple tree", expected_harvest_date: "2027-01-01" }), "2028-06-01", today), true);
  });

  it("shows plans only from today on", () => {
    const plan = planting({ planted_date: "2027-04-01" });
    assert.equal(plannedAfter(plan, today, today), true);
    assert.equal(plannedAfter(plan, "2027-04-01", today), false, "in the ground that day");
    assert.equal(plannedAfter(plan, "2026-06-01", today), false, "looking back shows no plans");
  });
});

describe("garden timeline: advice for another date", () => {
  it("looking back ignores what came later", () => {
    const advice = adviseBed(bed("bed-x"), seed.plantings, "2024-06-01", today);
    assert.deepEqual(advice.current.map((p) => p.crop), ["beans"]);
    assert.equal(advice.history.length, 0, "the 2025 tomatoes hadn't happened yet");
    assert.ok(!advice.avoid.some((item) => item.reason.includes("2025")));
  });

  it("looking ahead frees beds after harvest and rotates by that year", () => {
    const advice = adviseBed(bed("bed-sp"), seed.plantings, "2027-05-01", today);
    assert.equal(advice.current.length, 0, "sweet potato was due Dec 24");
    assert.equal(advice.freeFrom, "2027-05-01");
    assert.ok(advice.avoid.some((item) => item.crop === "sweet potato"), "grew here in 2026");
    assert.ok(!advice.avoid.some((item) => item.crop === "tomatoes"), "tomatoes were 2024, three seasons back");
    const now = advice.recommendations.find((item) => item.now);
    assert.ok(now?.reasons[0].startsWith("Can go in then"), now?.reasons[0]);
  });

  it("matches the old behavior on today", () => {
    const advice = adviseBed(bed("bed-sp"), seed.plantings, today);
    assert.equal(advice.current[0]?.crop, "sweet potato");
  });
});
