import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTasks } from "./priority";
import type { Bed, Planting, WorkSession } from "./types";
import { lastSoaking, parseLocation, pickPlace, rainFromResponse, soakingTomorrow, type Rain } from "./weather";

describe("rain near the garden", () => {
  it("reads the town and its state, to pick the right Princeton", () => {
    assert.deepEqual(parseLocation("Princeton, NJ"), { town: "Princeton", hints: ["new jersey", "nj"] });
    const places = [
      { name: "Princeton", admin1: "Indiana", country_code: "US", latitude: 38.4, longitude: -87.6 },
      { name: "Princeton", admin1: "New Jersey", country_code: "US", latitude: 40.35, longitude: -74.66 },
    ];
    assert.equal(pickPlace(places, parseLocation("Princeton, NJ").hints)?.admin1, "New Jersey");
    assert.equal(pickPlace(places, [])?.admin1, "Indiana");
    assert.equal(pickPlace([], ["nj"]), null);
  });

  it("reads Open-Meteo's daily totals and skips bad values", () => {
    const rain = rainFromResponse(
      { daily: { time: ["2026-11-12", "2026-11-13", "bad"], precipitation_sum: [21.7, null, 3] } },
      "Princeton, New Jersey",
    );
    assert.deepEqual(rain?.days, [{ date: "2026-11-12", mm: 21.7 }]);
    assert.equal(rainFromResponse({ nope: true }, "x"), null);
  });

  it("finds the last good soaking and rain due tomorrow", () => {
    const rain: Rain = { place: "x", days: [{ date: "2026-11-10", mm: 9 }, { date: "2026-11-12", mm: 2 }, { date: "2026-11-15", mm: 12 }] };
    assert.equal(lastSoaking(rain, "2026-11-14")?.date, "2026-11-10");
    assert.equal(soakingTomorrow(rain, "2026-11-15")?.mm, 12);
    assert.equal(soakingTomorrow(rain, "2026-11-16"), null);
  });
});

describe("watering with rain", () => {
  const now = new Date("2026-11-14T15:00:00Z");
  const beds: Bed[] = [{ id: "b1", name: "Plot 1", row: "", geometry: null }];
  const plantings: Planting[] = [
    { id: "p1", bed_id: "b1", crop: "kale", planted_date: "2026-10-01", expected_harvest_date: "2027-01-01", removed_date: null, season_year: 2026, days_to_maturity: 55, source_session_id: null },
  ];
  const watered: WorkSession[] = [
    { id: "s1", person_id: "x", start: "2026-11-08T14:00:00Z", end: "2026-11-08T15:00:00Z", activity_type: "water", bed_id: "b1", planting_id: null, notes: "", raw_message: "" } as WorkSession,
  ];
  const water = (rain: Rain | null) =>
    buildTasks({ now, beds, plantings, sessions: watered, timeZone: "America/New_York", rain }).filter((t) => t.type === "water");

  it("asks for watering as before when there's no weather", () => {
    assert.equal(water(null).length, 1);
    assert.equal(water(null)[0].detail, "Last watered 6 days ago.");
  });

  it("counts a good rain as watering", () => {
    assert.equal(water({ place: "x", days: [{ date: "2026-11-13", mm: 8 }] }).length, 0);
    // A drizzle doesn't count.
    const drizzle = water({ place: "x", days: [{ date: "2026-11-13", mm: 2 }] });
    assert.equal(drizzle.length, 1);
    assert.match(drizzle[0].detail, /No good rain this past week/);
  });

  it("says when it last rained, if that was a while ago", () => {
    const old = water({ place: "x", days: [{ date: "2026-11-10", mm: 15 }] });
    assert.match(old[0].detail, /Last good rain 4 days ago \(15 mm\)/);
  });

  it("waits when a good rain is due tomorrow", () => {
    assert.equal(water({ place: "x", days: [{ date: "2026-11-15", mm: 10 }] }).length, 0);
  });
});
