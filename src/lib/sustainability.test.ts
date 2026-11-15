import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareYears, stretch, yearScore } from "./sustainability";
import type { Bed, Planting } from "./types";

const plot = (id: string, w = 10, h = 4): Bed => ({ id, name: id, row: "", geometry: { x: 0, y: 0, w, h } });
let n = 0;
function grew(bed_id: string, crop: string, planted_date: string, harvest: string, extra: Partial<Planting> = {}): Planting {
  return {
    id: `p${++n}`,
    bed_id,
    crop,
    planted_date,
    expected_harvest_date: harvest,
    removed_date: null,
    season_year: Number(planted_date.slice(0, 4)),
    days_to_maturity: 60,
    source_session_id: null,
    ...extra,
  };
}

describe("sustainability score", () => {
  it("compares the same stretch of each year, even around leap days", () => {
    assert.deepEqual(stretch(2025, "2026-11-14"), { from: "2025-01-01", to: "2025-11-14" });
    assert.deepEqual(stretch(2027, "2028-02-29"), { from: "2027-01-01", to: "2027-02-28" });
  });

  it("measures soil cover by plot area, starting from each plot's first planting", () => {
    const beds = [plot("a", 10, 10), plot("b", 10, 10)];
    // a: covered all of Jan 1–Jan 10 (the stretch). b: first planted Jan 6, covered Jan 6–Jan 7, then bare.
    const plantings = [
      grew("a", "clover", "2026-01-01", "2026-03-01"),
      grew("b", "lettuce", "2026-01-06", "2026-01-07", { removed_date: "2026-01-08" }),
    ];
    const s = yearScore(beds, plantings, 2026, "2026-01-10");
    const cover = s.measures.find((m) => m.key === "cover")!;
    // a: 10 of 10 days; b: 2 of 5 days (Jan 6–10). Same area: 12 / 15 = 80%.
    assert.equal(cover.score, 80);
  });

  it("counts rotation as plantings that didn't repeat last year's family in that plot", () => {
    const beds = [plot("a"), plot("b")];
    const plantings = [
      grew("a", "tomatoes", "2025-05-01", "2025-08-01"),
      grew("a", "pepper", "2026-05-01", "2026-08-01"), // nightshade again: not rotated
      grew("b", "beans", "2026-05-01", "2026-07-01"),
    ];
    const rotation = yearScore(beds, plantings, 2026, "2026-11-14").measures.find((m) => m.key === "rotation")!;
    assert.equal(rotation.score, 50);
    assert.equal(rotation.detail, "1 of 2 plantings rotated");
  });

  it("ignores unconfirmed plans", () => {
    const s = yearScore([plot("a")], [grew("a", "corn", "2026-05-01", "2026-08-01", { status: "planned" })], 2026, "2026-11-14");
    assert.equal(s.score, null);
    assert.equal(s.plantings, 0);
  });

  it("says how much better this year is, and why", () => {
    const beds = [plot("a"), plot("b")];
    const plantings = [
      // 2024 history so 2025 has something to rotate against.
      grew("a", "corn", "2024-05-01", "2024-08-01"),
      grew("b", "corn", "2024-05-01", "2024-08-01"),
      // 2025: corn again in both (no rotation), short season, bare the rest of the year.
      grew("a", "corn", "2025-05-01", "2025-08-01"),
      grew("b", "corn", "2025-05-01", "2025-08-01"),
      grew("a", "squash", "2025-08-20", "2025-09-15"),
      // 2026: beans then winter rye in a, garlic in b: rotated and covered longer.
      grew("a", "beans", "2026-03-01", "2026-07-01"),
      grew("a", "winter rye", "2026-07-20", "2027-03-01"),
      grew("b", "garlic", "2026-02-01", "2026-07-15"),
      grew("b", "clover", "2026-08-01", "2026-12-01"),
    ];
    const c = compareYears(beds, plantings, "2026-11-14");
    assert.ok(c.change !== null && c.change > 0, JSON.stringify(c));
    assert.ok(c.score! > c.previousScore!);
    assert.match(c.reasons[0], /last year/);
  });

  it("won't compare against a year with too little data", () => {
    const c = compareYears([plot("a")], [grew("a", "beans", "2026-04-01", "2026-07-01")], "2026-11-14");
    assert.equal(c.change, null);
    assert.ok(c.score !== null);
  });
});
