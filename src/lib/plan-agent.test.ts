import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPersonalTexts, fallbackAssign, sanitizeAssignments, type PlanSnapshot } from "./plan-agent";
import { buildSeed } from "./seed";
import { addDays, DEFAULT_TZ, startOfWeekYmd } from "./time";
import { buildTasks } from "./priority";
import { upcomingPlannedSessions } from "./planner";

const NOW = new Date("2026-11-14T15:00:00.000Z");

function snapshotFromSeed(): PlanSnapshot {
  const seed = buildSeed(NOW);
  const weekStart = addDays(startOfWeekYmd(NOW, DEFAULT_TZ), 7);
  const tasks = buildTasks({
    now: NOW,
    beds: seed.beds,
    plantings: seed.plantings,
    sessions: seed.sessions,
    timeZone: DEFAULT_TZ,
  }).map((task) => ({ ...task, status: "proposed" as const, suggested_assignee_id: null }));
  const plannedSessions = upcomingPlannedSessions(seed.sessions, NOW, weekStart, DEFAULT_TZ);
  const visitorIds = new Set(plannedSessions.map((session) => session.person_id));
  return {
    weekStart,
    weekEnd: addDays(weekStart, 6),
    timeZone: DEFAULT_TZ,
    tasks,
    visitors: seed.people.filter((person) => visitorIds.has(person.id)),
    sessions: plannedSessions,
    beds: seed.beds,
    plantings: seed.plantings,
    recipients: seed.people,
  };
}

describe("plan agent fallback", () => {
  it("suggests people already on next week's calendar, preferring the same bed", () => {
    const snapshot = snapshotFromSeed();
    assert.ok(snapshot.visitors.length >= 3);
    const assignments = fallbackAssign(snapshot);
    assert.ok(assignments.length > 0);

    const waterSp = assignments.find((item) => item.taskId === "water:planting-sp");
    assert.equal(waterSp?.personId, "person-emma");

    const harvestCarrots = assignments.find((item) => item.taskId.startsWith("harvest:planting-carrots"));
    if (harvestCarrots) assert.equal(harvestCarrots.personId, "person-sonali");

    const fillX = assignments.find((item) => item.taskId === "fill:bed-x");
    if (fillX) assert.equal(fillX.personId, "person-jeremy");
  });

  it("drops invented ids", () => {
    const snapshot = snapshotFromSeed();
    const cleaned = sanitizeAssignments(
      [
        { taskId: "water:planting-sp", personId: "person-emma", reason: "ok" },
        { taskId: "nope", personId: "person-emma", reason: "bad task" },
        { taskId: "water:planting-sp", personId: "person-sonali", reason: "duplicate task" },
        { taskId: snapshot.tasks[0]?.id ?? "x", personId: "ghost", reason: "bad person" },
      ],
      snapshot,
    );
    assert.equal(cleaned.length, 1);
    assert.equal(cleaned[0].personId, "person-emma");
  });

  it("builds a personal text per recipient", () => {
    const snapshot = snapshotFromSeed();
    const assignments = fallbackAssign(snapshot);
    const texts = buildPersonalTexts(snapshot, assignments);
    assert.equal(texts.length, snapshot.recipients.length);
    const emma = texts.find((item) => item.personId === "person-emma");
    assert.ok(emma);
    assert.match(emma!.text, /Hi Emma/);
    assert.match(emma!.text, /Suggested for you|No specific chores/);
    assert.match(emma!.text, /I'll take watering/);
  });
});
