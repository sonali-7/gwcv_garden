import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nitrogenBalance, nitrogenReason } from "./nitrogen";
import { adviseBed } from "./recommend";
import type { Bed, Planting } from "./types";

const today = "2026-11-14";
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
    days_to_maturity: 60,
    source_session_id: null,
    ...extra,
  };
}

describe("soil nitrogen per plot", () => {
  it("heavy feeders run it down and the reason names them", () => {
    const b = nitrogenBalance([grew("corn", "2026-05-01"), grew("tomatoes", "2026-06-01")], today);
    assert.equal(b.score, -4);
    assert.equal(b.level, "low");
    assert.match(nitrogenReason(b), /^Tomatoes and corn used nitrogen/);
  });

  it("fixers put it back, and older crops count half", () => {
    const b = nitrogenBalance([grew("corn", "2025-06-01"), grew("beans", "2026-06-01")], today);
    assert.equal(b.score, 1); // -2 * 0.5 + 2
    assert.equal(b.level, "balanced");
    assert.equal(nitrogenBalance([grew("peas", "2026-04-01"), grew("clover", "2026-08-01")], today).level, "rich");
  });

  it("ignores crops over two years old, unconfirmed plans, and crops pulled right away", () => {
    const b = nitrogenBalance(
      [
        grew("corn", "2024-06-01"),
        grew("squash", "2026-10-01", { status: "planned" }),
        grew("cabbage", "2026-09-01", { removed_date: "2026-09-03" }),
      ],
      today,
    );
    assert.equal(b.score, 0);
    assert.equal(b.effects.length, 0);
  });

  it("looking ahead counts plans up to that date", () => {
    const plan = grew("squash", "2027-04-01", { status: "planned" });
    assert.equal(nitrogenBalance([plan], "2027-03-01", today).score, 0);
    assert.equal(nitrogenBalance([plan], "2027-05-01", today).score, -2);
  });

  it("puts nitrogen fixers ahead of heavy feeders in a low plot", () => {
    const bed: Bed = { id: "b1", name: "Plot 1" } as Bed;
    // Heavy feeders, then a light one last, so the last-crop rule says nothing and the balance decides.
    const plantings = [grew("corn", "2026-03-01"), grew("tomatoes", "2026-04-01"), grew("carrots", "2026-07-01")];
    const advice = adviseBed(bed, plantings, today);
    assert.equal(advice.nitrogen.level, "low");
    const fixer = advice.recommendations.find((r) => r.reasons.some((x) => x.includes("puts it back")));
    assert.ok(fixer, JSON.stringify(advice.recommendations.map((r) => [r.crop, r.reasons])));
  });
});
