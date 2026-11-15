import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canDelete, cropsInPatch, isEstablished } from "./drop-plan";
import { inGroundOn, isActive, isOverduePlan, plannedAfter } from "./plantings";
import type { Planting } from "./types";

const today = "2026-11-20";
const plan = (over: Partial<Planting> = {}): Planting => ({
  id: "p1",
  bed_id: "bed-1",
  crop: "kale",
  planted_date: "2026-11-15",
  expected_harvest_date: "2027-01-15",
  removed_date: null,
  season_year: 2026,
  days_to_maturity: 61,
  source_session_id: null,
  status: "planned",
  ...over,
});

describe("plans need confirming before they count as planted", () => {
  it("a plan past its date is not in the ground, and stays a plan", () => {
    const p = plan();
    assert.equal(isActive(p, today), false);
    assert.equal(inGroundOn(p, today, today), false);
    assert.equal(isOverduePlan(p, today), true);
    assert.equal(plannedAfter(p, today, today), true);
    assert.deepEqual(cropsInPatch("bed-1", [p], today, today).map((x) => x.id), ["p1"], "the patch shows it as planned");
  });

  it("looking ahead, an overdue plan still waits; a plan not due yet is pictured from its date", () => {
    assert.equal(inGroundOn(plan(), "2026-12-10", today), false);
    assert.equal(plannedAfter(plan(), "2026-12-10", today), true);
    const later = plan({ planted_date: "2026-12-01", expected_harvest_date: "2027-01-31" });
    assert.equal(inGroundOn(later, "2026-11-30", today), false);
    assert.equal(inGroundOn(later, "2026-12-05", today), true);
  });

  it("once confirmed it behaves like any planting", () => {
    const done = plan({ status: "planted", planted_date: today });
    assert.equal(isActive(done, today), true);
    assert.equal(inGroundOn(done, today, today), true);
    assert.equal(plannedAfter(done, today, today), false);
  });

  it("an unconfirmed plan can always be deleted and is never established", () => {
    assert.equal(canDelete(plan(), today), true);
    assert.equal(isEstablished(plan(), today), false);
    assert.equal(canDelete(plan({ status: "planted" }), today), false);
  });

  it("older records without a status keep counting as planted from their date", () => {
    const old = plan({ status: undefined });
    assert.equal(isActive(old, today), true);
    assert.equal(plannedAfter(old, today, today), false);
  });
});
