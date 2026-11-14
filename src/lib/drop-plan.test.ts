import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clearing, dropSituation, replacementDate } from "./drop-plan";
import type { Planting } from "./types";

const today = "2026-11-14";
let n = 0;
const planting = (over: Partial<Planting>): Planting => ({
  id: `p${++n}`,
  bed_id: "bed-1",
  crop: "garlic",
  planted_date: "2026-10-01",
  expected_harvest_date: "2027-06-01",
  removed_date: null,
  season_year: 2026,
  days_to_maturity: 240,
  source_session_id: null,
  ...over,
});

describe("dropping a crop on a patch", () => {
  it("plans as usual on an empty patch", () => {
    assert.equal(dropSituation("bed-1", [], today, today).kind, "empty");
  });

  it("swaps a plan without asking", () => {
    const plan = planting({ planted_date: "2026-11-15" });
    const result = dropSituation("bed-1", [plan], today, today);
    assert.equal(result.kind, "replace");
  });

  it("swaps something planted today without asking", () => {
    const fresh = planting({ planted_date: today });
    assert.equal(dropSituation("bed-1", [fresh], today, today).kind, "replace");
  });

  it("asks once a crop has been in the ground a full day", () => {
    const old = planting({ planted_date: "2026-11-13" });
    const result = dropSituation("bed-1", [old], today, today);
    assert.equal(result.kind, "ask");
    assert.equal(result.kind === "ask" && result.there[0].established, true);
  });

  it("asks for a mixed patch, so you can pick", () => {
    const a = planting({ planted_date: "2026-11-15", crop: "kale" });
    const b = planting({ planted_date: "2026-11-15", crop: "peas" });
    const result = dropSituation("bed-1", [a, b], today, today);
    assert.equal(result.kind, "ask");
    assert.deepEqual(result.kind === "ask" && result.there.map((o) => o.established), [false, false]);
  });

  it("measures the day against the timeline date", () => {
    const plan = planting({ planted_date: "2027-04-01", expected_harvest_date: "2027-07-01" });
    assert.equal(dropSituation("bed-1", [plan], "2027-04-01", today).kind, "replace", "its first day");
    assert.equal(dropSituation("bed-1", [plan], "2027-04-02", today).kind, "ask", "a day in");
  });
});

describe("replacing", () => {
  it("deletes a fresh plan but keeps anything real or established, marked pulled", () => {
    assert.deepEqual(clearing(planting({ planted_date: "2026-11-15" }), today, today), { action: "delete" });
    assert.deepEqual(clearing(planting({ planted_date: today }), today, today), { action: "pull", on: today }, "already in the ground");
    assert.deepEqual(clearing(planting({ planted_date: "2026-11-15", source_session_id: "s1" }), today, today), { action: "pull", on: "2026-11-15" });
    assert.deepEqual(clearing(planting({ planted_date: "2027-04-01" }), "2027-04-10", today), { action: "pull", on: "2027-04-10" });
  });

  it("puts the new crop in the old plan's slot, or the timeline date, never before tomorrow", () => {
    assert.equal(replacementDate([planting({ planted_date: "2026-12-01" })], today, today), "2026-12-01");
    assert.equal(replacementDate([planting({ planted_date: "2026-10-01" })], today, today), "2026-11-15");
    assert.equal(replacementDate([planting({ planted_date: "2027-04-01" })], "2027-04-10", today), "2027-04-10");
    assert.equal(replacementDate([], "2026-11-20", today, [3, 4]), "2027-03-01", "waits for its sowing months");
  });
});
