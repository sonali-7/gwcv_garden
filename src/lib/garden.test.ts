import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { placeSlices, sessionStatus, slicesForSession } from "./calendar";
import { loadDashboard } from "./dashboard-data";
import { expandOccurrences, handleIncoming, resolveInterval } from "./handle-message";
import { createMemoryStore } from "./memory-store";
import { applyMemory, mergeDrafts, messageFromTool, wantsReusePrior } from "./agent";
import {
  applyClarification,
  calendarDate,
  isHelpRequest,
  needsDay,
  parseDraft,
  parseMessage,
  questionFor,
  rowOptionsReply,
  rowQuestion,
  timeGaps,
} from "./parse";
import { isMultiAccept, matchLocation } from "./location";
import { buildTasks } from "./priority";
import {
  ALREADY_CLAIMED_REPLY,
  approveAndSendPlan,
  matchClaimTask,
  mergeTaskState,
  nextWeekStartYmd,
  proposeWeekPlan,
  reconcilePriorityTasks,
} from "./planner";
import { buildSeed } from "./seed";
import { addDays, DEFAULT_TZ, partsInZone, startOfWeekYmd, zonedToUtc } from "./time";
import type { Bed, Planting, TextMemory } from "./types";
import { LIMIT_NOTICE, photonReply } from "./photon";
import { readPhotonInbound, verifyStandardWebhook } from "./webhook";
import { createHmac } from "node:crypto";

const NOW = new Date("2026-11-14T15:00:00.000Z");

describe("parser", () => {
  it("asks for am or pm instead of guessing", () => {
    const parsed = parseMessage("from 8-9 I planted trees");
    assert.equal(parsed.kind, "session");
    if (parsed.kind !== "session") return;
    assert.equal(parsed.draft.activity, "plant");
    assert.equal(parsed.draft.crop, "trees");
    assert.deepEqual(timeGaps(parsed.draft), ["ampm"]);
  });

  it("accepts an explicit morning range", () => {
    const parsed = parseMessage("from 8-9am I planted trees");
    assert.equal(parsed.kind, "session");
    if (parsed.kind !== "session") return;
    assert.deepEqual(timeGaps(parsed.draft), []);
    assert.equal(parsed.draft.startAmpm, "am");
  });

  it("keeps a duration and asks when it started", () => {
    const parsed = parseMessage("weeded the carrot row for an hour");
    assert.equal(parsed.kind, "session");
    if (parsed.kind !== "session") return;
    assert.equal(parsed.draft.activity, "weed");
    assert.equal(parsed.draft.crop, "carrots");
    assert.equal(parsed.draft.durationMin, 60);
    assert.deepEqual(timeGaps(parsed.draft), ["start"]);
  });

  it("recognizes questions, undo, and emergencies", () => {
    assert.equal(parseMessage("what's on the schedule this week?").kind, "query_schedule");
    assert.equal(parseMessage("what's the schedule?").kind, "query_schedule");
    assert.equal(parseMessage("what needs watering?").kind, "query_watering");
    assert.equal(parseMessage("undo").kind, "undo");
    assert.equal(parseMessage("I hurt my hand").kind, "emergency");
    assert.equal(isHelpRequest("what are the options"), true);
    assert.equal(isHelpRequest("options"), true);
    assert.equal(isHelpRequest("help"), true);
    assert.equal(isHelpRequest("which rows"), true);
    assert.equal(isHelpRequest("carrot row"), false);
    assert.match(rowQuestion([], ["Carrot row", "Space X"]), /Options: Carrot row, Space X/);
    assert.match(rowOptionsReply(["Kale", "Kale / Peas"], ["Kale", "Kale / Peas", "Space X"]), /Closest matches/);
  });

  it("treats schedule-a-crop as a planting, not a week readout", () => {
    const parsed = parseMessage("schedule kumquats from 4-5 today");
    assert.equal(parsed.kind, "session");
    if (parsed.kind !== "session") return;
    assert.equal(parsed.draft.activity, "plant");
    assert.equal(parsed.draft.crop, "kumquats");
    assert.equal(parsed.draft.dayOffset, 0);
    assert.deepEqual(parsed.draft.start, { h: 4, m: 0 });
    assert.deepEqual(parsed.draft.end, { h: 5, m: 0 });
    assert.deepEqual(timeGaps(parsed.draft), ["ampm"]);
  });

  it("asks which day for a meeting at 10am instead of an end time", () => {
    const parsed = parseMessage("schedule a weekly meeting at 10 am");
    assert.equal(parsed.kind, "session");
    if (parsed.kind !== "session") return;
    assert.equal(parsed.draft.activity, "meeting");
    assert.equal(parsed.draft.startAmpm, "am");
    assert.equal(parsed.draft.durationMin, 60);
    assert.equal(parsed.draft.recurringWeeks, 8);
    assert.deepEqual(timeGaps(parsed.draft), []);
    assert.equal(needsDay(parsed.draft), true);
    assert.equal(calendarDate("the 19th of november", "2026-11-14"), "2026-11-19");
    assert.equal(calendarDate("11/19", "2026-11-14"), "2026-11-19");
    assert.equal(calendarDate("November 19", "2026-11-14"), "2026-11-19");
  });

  it("reads crossed ranges, durations, and compound weekdays", () => {
    const weed = parseMessage("weeded carrot row from 10-2");
    assert.equal(weed.kind, "session");
    if (weed.kind !== "session") return;
    assert.deepEqual(weed.draft.start, { h: 10, m: 0 });
    assert.deepEqual(weed.draft.end, { h: 2, m: 0 });
    assert.equal(weed.draft.startAmpm, null);
    assert.equal(questionFor(weed.draft, "ampm"), "Was that 10am–2pm, or 10pm–2am?");
    const clarified = applyClarification(weed.draft, "ampm", "pm");
    assert.equal(clarified?.startAmpm, "am");
    assert.equal(clarified?.endAmpm, "pm");

    const timed = parseMessage("2 pm, 30 minutes");
    assert.ok(timed.kind === "session" || timed.kind === "unknown");
    const durationOnly = parseDraft("2 pm, 30 minutes");
    assert.ok(durationOnly);
    assert.deepEqual(durationOnly.start, { h: 2, m: 0 });
    assert.equal(durationOnly.startAmpm, "pm");
    assert.equal(durationOnly.durationMin, 30);

    const compound = parseMessage("Schedule weekly meeting next tuesday and next thursday");
    assert.equal(compound.kind, "session");
    if (compound.kind !== "session") return;
    assert.equal(compound.draft.activity, "meeting");
    assert.deepEqual(compound.draft.weekdays, [2, 4]);
    assert.equal(compound.draft.nextWeek, true);
    assert.equal(compound.draft.recurringWeeks, 8);
    assert.equal(parseMessage("cancel thursday meeting").kind, "cancel");
  });

  it("keeps written times and drops a day the model made up", () => {
    const text = "schedule kumquats from 4-5 today";
    const model = messageFromTool(text, {
      kind: "session",
      activity: "plant",
      crop: "Kumquats",
      day_offset: 0,
      weekday: 5,
      start_hour: 4,
    });
    const rules = parseMessage(text);
    assert.equal(model?.kind, "session");
    assert.equal(rules.kind, "session");
    if (model?.kind !== "session" || rules.kind !== "session") return;
    const merged = mergeDrafts(model.draft, rules.draft, true);
    assert.deepEqual(merged.end, { h: 5, m: 0 });
    assert.equal(merged.weekday, null);
    assert.equal(merged.dayOffset, 0);
    assert.equal(merged.crop, "kumquats");

    const meeting = messageFromTool("schedule a weekly meeting", {
      kind: "session",
      activity: "meeting",
      weekday: 6,
      start_hour: 10,
      start_ampm: "am",
    });
    if (meeting?.kind !== "session") return assert.fail("expected a session");
    const noDay = mergeDrafts(meeting.draft, null, false);
    assert.equal(noDay.weekday, null);
    assert.equal(needsDay(noDay), true);
  });

  it("maps an agent tool call into the same session draft", () => {
    const parsed = messageFromTool("schedule kumquats from 4-5 today", {
      kind: "session",
      activity: "plant",
      crop: "kumquats",
      day_offset: 0,
      start_hour: 4,
      start_minute: 0,
      end_hour: 5,
      end_minute: 0,
    });
    assert.equal(parsed?.kind, "session");
    if (parsed?.kind !== "session") return;
    assert.equal(parsed.draft.crop, "kumquats");
    assert.deepEqual(timeGaps(parsed.draft), ["ampm"]);
  });
});

describe("location match", () => {
  const beds: Bed[] = [
    { id: "bed-kale", name: "Kale", row: "a", geometry: null },
    { id: "bed-kale-peas", name: "Kale / Peas", row: "b", geometry: null },
    { id: "bed-x", name: "Space X", row: "c", geometry: null },
  ];
  const plantings: Planting[] = [
    {
      id: "p-kale",
      bed_id: "bed-kale",
      crop: "kale",
      planted_date: "2026-09-01",
      expected_harvest_date: "2026-12-01",
      removed_date: null,
      season_year: 2026,
      days_to_maturity: 60,
      source_session_id: null,
    },
    {
      id: "p-peas",
      bed_id: "bed-kale-peas",
      crop: "peas",
      planted_date: "2026-09-01",
      expected_harvest_date: "2026-12-01",
      removed_date: null,
      season_year: 2026,
      days_to_maturity: 60,
      source_session_id: null,
    },
    {
      id: "p-kale2",
      bed_id: "bed-kale-peas",
      crop: "kale",
      planted_date: "2026-09-01",
      expected_harvest_date: "2026-12-01",
      removed_date: null,
      season_year: 2026,
      days_to_maturity: 60,
      source_session_id: null,
    },
  ];

  it("prefers Kale / Peas over Kale when both names match", () => {
    const hit = matchLocation("harvested peas from kale/peas", beds, plantings, "2026-11-13");
    assert.equal(hit.bed?.id, "bed-kale-peas");
    assert.equal(hit.ambiguous, false);
  });

  it("accepts the longer choice as a clarifying reply", () => {
    const hit = matchLocation("Kale / Peas", beds, plantings, "2026-11-13", {
      choices: ["Kale", "Kale / Peas"],
    });
    assert.equal(hit.bed?.id, "bed-kale-peas");
    assert.equal(hit.ambiguous, false);
  });

  it("logs every named plot and treats both as all choices", () => {
    const plots: Bed[] = [
      ...beds,
      { id: "bed-8", name: "Plot 8", row: "8", geometry: null },
      { id: "bed-9", name: "Plot 9", row: "9", geometry: null },
    ];
    const named = matchLocation("watered mint in plot 8 and peas in plot 9", plots, plantings, "2026-11-14");
    assert.equal(named.ambiguous, false);
    assert.deepEqual(
      named.beds.map((bed) => bed.id).sort(),
      ["bed-8", "bed-9"],
    );
    assert.equal(isMultiAccept("both"), true);
    const both = matchLocation("both", plots, plantings, "2026-11-14", {
      choices: ["Plot 8", "Plot 9"],
    });
    assert.equal(both.beds.length, 2);
  });
});

describe("text memory", () => {
  it("reuses the prior interval for also / same time follow-ups", () => {
    assert.equal(wantsReusePrior("i also watered mint in plot 8 at the same time"), true);
    const memory: TextMemory = {
      at: NOW.toISOString(),
      activity: "water",
      bedNames: ["Kale / Peas 2"],
      summary: "water on Kale / Peas 2",
      start: { h: 5, m: 0 },
      end: { h: 5, m: 38 },
      startAmpm: "pm",
      endAmpm: "pm",
      durationMin: null,
      dayOffset: 0,
    };
    const draft = parseDraft("i also watered mint in plot 8 and peas in plot 9 at the same time");
    assert.ok(draft);
    const filled = applyMemory(draft!, "i also watered mint in plot 8 and peas in plot 9 at the same time", memory, true);
    assert.deepEqual(filled.start, { h: 5, m: 0 });
    assert.deepEqual(filled.end, { h: 5, m: 38 });
    assert.equal(filled.startAmpm, "pm");
    assert.equal(filled.endAmpm, "pm");
  });
});

describe("priority tasks", () => {
  it("matches the week board for the demo Saturday", () => {
    const seed = buildSeed(NOW);
    const tasks = buildTasks({
      now: NOW,
      beds: seed.beds,
      plantings: seed.plantings,
      sessions: seed.sessions,
      timeZone: DEFAULT_TZ,
    });
    assert.deepEqual(
      tasks.map((task) => task.title),
      ["Sweet potato needs watering", "2 weeks to harvest for carrots", "Fill space X", "Weekly meeting"],
    );
    assert.equal(tasks[0].severity, "urgent");
    assert.equal(tasks[1].severity, "upcoming");
    assert.equal(tasks[2].bed_id, "bed-x");
  });
});

describe("thin week planner", () => {
  it("treats iMessage curly-apostrophe I'll take … as a claim, not a watering log", async () => {
    const store = createMemoryStore(buildSeed(NOW));
    await approveAndSendPlan(store, NOW);
    // U+2019 RIGHT SINGLE QUOTATION MARK — what iPhone often sends
    const curly = "I\u2019ll take watering peas";
    const parsed = parseMessage(curly);
    assert.equal(parsed.kind, "claim");
    if (parsed.kind === "claim") assert.match(parsed.hint, /watering peas/i);

    const result = await handleIncoming(store, { phone: "+15555501002", text: curly, now: NOW });
    assert.match(result.replies.join(" "), /You're on:/i);
    assert.ok(!/What time did you start/i.test(result.replies.join(" ")));
  });

  it("targets the week after the current Sun–Sat week", () => {
    // NOW is Saturday 2026-11-14 → this week starts Nov 8, next week Nov 15.
    assert.equal(startOfWeekYmd(NOW, DEFAULT_TZ), "2026-11-08");
    assert.equal(nextWeekStartYmd(NOW, DEFAULT_TZ), "2026-11-15");
    // Even on Sunday, "next week" is still the following Sunday.
    const sunday = zonedToUtc("2026-11-08", 12, 0, DEFAULT_TZ);
    assert.equal(nextWeekStartYmd(sunday, DEFAULT_TZ), "2026-11-15");
    assert.equal(nextWeekStartYmd(sunday, DEFAULT_TZ), addDays(startOfWeekYmd(sunday, DEFAULT_TZ), 7));
  });

  it("proposes from priority tasks and texts only people who already texted", async () => {
    const store = createMemoryStore(buildSeed(NOW));
    const plan = await proposeWeekPlan(store, NOW);
    assert.equal(plan.weekStart, "2026-11-15");
    assert.match(plan.text, /Nov 15/);
    assert.equal(plan.tasks[0].status, "proposed");
    assert.match(plan.text, /Sweet potato needs watering/);
    assert.ok(plan.recipients.length >= 2);

    const sent = await approveAndSendPlan(store, NOW);
    assert.equal(sent.tasks[0].status === "claimed" ? "claimed" : "approved", "approved");
    assert.ok(sent.sent >= 2);
    const emma = await store.getThread("+15555501001");
    assert.ok(emma.some((message) => message.direction === "out" && /Garden plan/.test(message.text)));
  });

  it("keeps the first claim and anonymously blocks the second", async () => {
    const store = createMemoryStore(buildSeed(NOW));
    await approveAndSendPlan(store, NOW);

    const first = await handleIncoming(store, {
      phone: "+15555501001",
      text: "I'll take watering",
      now: NOW,
    });
    assert.match(first.replies.join(" "), /You're on: Sweet potato needs watering/);

    const second = await handleIncoming(store, {
      phone: "+15555501002",
      text: "I'll take watering",
      now: NOW,
    });
    assert.equal(second.replies.join(" "), ALREADY_CLAIMED_REPLY);
    assert.ok(!/Emma|Sonali|Jeremy/i.test(second.replies.join(" ")));

    const tasks = await store.listTasks();
    const water = tasks.find((task) => task.type === "water");
    assert.equal(water?.status, "claimed");
    assert.equal(water?.assignee_id, "person-emma");
  });

  it("merges saved claims onto rebuilt rule tasks", () => {
    const seed = buildSeed(NOW);
    const computed = buildTasks({
      now: NOW,
      beds: seed.beds,
      plantings: seed.plantings,
      sessions: seed.sessions,
      timeZone: DEFAULT_TZ,
    });
    const saved = computed.map((task, index) =>
      index === 0
        ? { ...task, status: "claimed" as const, assignee_id: "person-emma", source: "planner" as const }
        : task,
    );
    const merged = mergeTaskState(computed, saved);
    assert.equal(merged[0].status, "claimed");
    assert.equal(merged[0].assignee_id, "person-emma");
    assert.equal(matchClaimTask("watering", merged, seed.beds, seed.plantings).task?.id, merged[0].id);
  });

  it("on calendar open, drops tasks for archived/missing beds and rewrites the DB", async () => {
    const seed = buildSeed(NOW);
    const store = createMemoryStore({
      ...seed,
      beds: seed.beds.map((bed) => (bed.id === "bed-x" ? { ...bed, archived: true } : bed)),
      tasks: [
        ...seed.tasks,
        {
          id: "water:ghost-planting",
          type: "water",
          severity: "urgent",
          title: "Ghost needs watering",
          detail: "stale",
          due_date: NOW.toISOString(),
          planting_id: "ghost-planting",
          bed_id: "missing-bed",
          status: "open",
          assignee_id: null,
          source: "rule",
          rationale: "stale",
        },
      ],
      plantings: [
        ...seed.plantings,
        {
          id: "ghost-planting",
          bed_id: "missing-bed",
          crop: "ghost",
          planted_date: "2026-10-01",
          expected_harvest_date: "2026-12-01",
          removed_date: null,
          season_year: 2026,
          days_to_maturity: 60,
          source_session_id: null,
        },
      ],
    });

    const before = buildTasks({
      now: NOW,
      beds: await store.listBeds(),
      plantings: await store.listPlantings(),
      sessions: await store.listSessions(),
      timeZone: DEFAULT_TZ,
    });
    assert.ok(!before.some((task) => task.bed_id === "bed-x"));
    assert.ok(!before.some((task) => task.planting_id === "ghost-planting"));

    const tasks = await reconcilePriorityTasks(store, NOW);
    assert.ok(!tasks.some((task) => task.id === "water:ghost-planting"));
    assert.ok(!tasks.some((task) => task.bed_id === "bed-x"));
    const saved = await store.listTasks();
    assert.ok(!saved.some((task) => task.id === "water:ghost-planting"));
    const ghost = (await store.listPlantings()).find((item) => item.id === "ghost-planting");
    assert.equal(ghost?.removed_date, "2026-11-14");
  });
});

describe("photon replies", () => {
  it("sends one text per incoming message and warns on the last one", () => {
    const lines = ["Thanks, Priya. I'll remember you.", "What time did you start?"];
    assert.equal(photonReply(lines, 0, 100), lines.join("\n"));
    assert.equal(photonReply(lines, 99, 100), `${lines.join("\n")}\n\n${LIMIT_NOTICE}`);
    assert.equal(photonReply(lines, 100, 100), null);
    assert.equal(photonReply([], 0, 100), null);
  });
});

describe("session status", () => {
  it("splits done, happening now, and planned at the current minute", () => {
    const at = (start: string, end: string) => sessionStatus({ start, end }, NOW);
    assert.equal(at("2026-11-14T13:00:00.000Z", "2026-11-14T14:00:00.000Z"), "done");
    assert.equal(at("2026-11-14T14:30:00.000Z", "2026-11-14T15:30:00.000Z"), "now");
    assert.equal(at("2026-11-14T15:00:00.000Z", "2026-11-14T16:00:00.000Z"), "now");
    assert.equal(at("2026-11-14T16:00:00.000Z", "2026-11-14T17:00:00.000Z"), "planned");
    assert.equal(at("2026-11-14T14:00:00.000Z", "2026-11-14T15:00:00.000Z"), "done");
  });
});

describe("calendar lanes", () => {
  const slice = (sessionId: string, startMin: number, endMin: number) => ({
    sessionId,
    day: "2026-11-14",
    topPx: 0,
    heightPx: 0,
    startMin,
    endMin,
  });
  const byId = (placed: ReturnType<typeof placeSlices>) =>
    Object.fromEntries(placed.map((item) => [item.sessionId, { lane: item.lane, lanes: item.lanes }]));

  it("only splits blocks that overlap, not the whole day", () => {
    const placed = byId(placeSlices([slice("hi", 120, 240), slice("emma-a", 480, 540), slice("emma-b", 480, 540)]));
    assert.deepEqual(placed.hi, { lane: 0, lanes: 1 });
    assert.deepEqual(placed["emma-a"].lanes, 2);
    assert.deepEqual(placed["emma-b"].lanes, 2);
    assert.notEqual(placed["emma-a"].lane, placed["emma-b"].lane);
  });

  it("keeps a chain of overlaps in one group, and back-to-back blocks full width", () => {
    const placed = byId(placeSlices([slice("a", 0, 120), slice("b", 60, 180), slice("c", 150, 240), slice("d", 240, 300)]));
    assert.equal(placed.a.lanes, 2);
    assert.equal(placed.b.lanes, 2);
    assert.equal(placed.c.lanes, 2);
    assert.equal(placed.c.lane, 0);
    assert.deepEqual(placed.d, { lane: 0, lanes: 1 });
  });
});

describe("calendar slices", () => {
  it("places the sweet potato weeding on Thursday morning", () => {
    const seed = buildSeed(NOW);
    const session = seed.sessions.find((item) => item.id === "session-jeremy-weed");
    assert.ok(session);
    const week = startOfWeekYmd(NOW, DEFAULT_TZ);
    const slices = slicesForSession(session, week, DEFAULT_TZ);
    assert.equal(slices.length, 1);
    assert.equal(slices[0].day, "2026-11-12");
    assert.equal(slices[0].topPx, 8 * 46);
    assert.equal(slices[0].heightPx, 230);
    const eight = zonedToUtc("2026-11-12", 8, 0, DEFAULT_TZ);
    assert.equal(new Date(session.start).toISOString(), eight.toISOString());
  });
});

describe("text log", () => {
  it("confirms a planting after one clarifying question", async () => {
    const store = createMemoryStore(buildSeed(NOW));
    const first = await handleIncoming(store, {
      phone: "+15555501001",
      text: "from 8-9 I planted trees",
      now: NOW,
    });
    assert.match(first.replies[0], /8–9am or 8–9pm/);
    assert.equal(first.session, null);

    const second = await handleIncoming(store, { phone: "+15555501001", text: "am", now: NOW });
    assert.match(second.replies.join(" "), /Logged: Emma/);
    assert.match(second.replies.join(" "), /north border/);
    assert.equal(second.session?.activity_type, "plant");
  });

  it("logs a timed weeding on the carrot row", async () => {
    const store = createMemoryStore(buildSeed(NOW));
    const asked = await handleIncoming(store, {
      phone: "+15555501003",
      text: "weeded the carrot row for an hour",
      now: NOW,
    });
    assert.match(asked.replies[0], /What time did you start/);
    const logged = await handleIncoming(store, { phone: "+15555501003", text: "10am", now: NOW });
    assert.equal(logged.session?.bed_id, "bed-carrot");
    assert.equal(logged.session?.planting_id, "planting-carrots");
    const start = new Date(logged.session!.start);
    assert.equal(start.toISOString(), zonedToUtc("2026-11-14", 10, 0, DEFAULT_TZ).toISOString());
  });

  it("remembers the last watering and logs two named plots at the same time", async () => {
    const seed = buildSeed(NOW);
    seed.beds.push(
      { id: "bed-8", name: "Plot 8", row: "8", geometry: null },
      { id: "bed-9", name: "Plot 9", row: "9", geometry: null },
      { id: "bed-kale-peas-2", name: "Kale / Peas 2", row: "k2", geometry: null },
    );
    seed.plantings.push({
      id: "p-mint-8",
      bed_id: "bed-8",
      crop: "mint",
      planted_date: "2026-09-01",
      expected_harvest_date: "2026-12-01",
      removed_date: null,
      season_year: 2026,
      days_to_maturity: 60,
      source_session_id: null,
    });
    const store = createMemoryStore(seed);
    const first = await handleIncoming(store, {
      phone: "+15555501001",
      text: "i watered the kale/peas 2 from 5pm-5:38pm",
      now: NOW,
    });
    assert.equal(first.session?.bed_id, "bed-kale-peas-2");
    const second = await handleIncoming(store, {
      phone: "+15555501001",
      text: "i also watered mint in plot 8 and peas in plot 9 at the same time",
      now: NOW,
    });
    assert.match(second.replies[0], /(?:Logged|Scheduled): Emma/);
    assert.match(second.replies[0], /Plot 8 and Plot 9/);
    assert.ok(!/Which row/i.test(second.replies[0]));
    assert.ok(!/; today/.test(second.replies[0]));
    const waters = (await store.listSessions()).filter(
      (session) =>
        session.person_id === "person-emma" &&
        session.activity_type === "water" &&
        (session.bed_id === "bed-8" || session.bed_id === "bed-9"),
    );
    assert.equal(waters.length, 2);
    assert.ok(waters.every((session) => session.start === first.session?.start));
  });

  it("lists bed options when someone asks during Which row", async () => {
    const store = createMemoryStore(buildSeed(NOW));
    const asked = await handleIncoming(store, {
      phone: "+15555501002",
      text: "from 8-9am I planted kale",
      now: NOW,
    });
    assert.match(asked.replies[0], /Which row/);
    const help = await handleIncoming(store, {
      phone: "+15555501002",
      text: "what are the options",
      now: NOW,
    });
    assert.match(help.replies[0], /Beds:/);
    assert.match(help.replies[0], /Space X/);
    assert.match(help.replies[0], /Carrot row/);
    assert.equal(help.session, null);
    const logged = await handleIncoming(store, { phone: "+15555501002", text: "space x", now: NOW });
    assert.equal(logged.session?.bed_id, "bed-x");
  });

  it("learns a new volunteer's name, then logs the stashed text", async () => {
    const store = createMemoryStore(buildSeed(NOW));
    const phone = "+15555501999";
    const first = await handleIncoming(store, {
      phone,
      text: "weeded the carrot row for an hour",
      now: NOW,
    });
    assert.match(first.replies[0], /name/i);
    const named = await handleIncoming(store, { phone, text: "Priya", now: NOW });
    assert.match(named.replies[0], /Priya/);
    assert.match(named.replies[1], /What time did you start/);
    const logged = await handleIncoming(store, { phone, text: "2pm", now: NOW });
    assert.equal(logged.person?.name, "Priya");
    assert.equal(logged.session?.bed_id, "bed-carrot");
    assert.equal(logged.person?.phone, phone);
  });

  it("schedules both weekdays and honors a 30-minute duration", async () => {
    const store = createMemoryStore(buildSeed(NOW));
    const first = await handleIncoming(store, {
      phone: "+15555501003",
      text: "Schedule weekly meeting next tuesday and next thursday",
      now: NOW,
    });
    assert.match(first.replies[0], /time/i);
    const placed = await handleIncoming(store, {
      phone: "+15555501003",
      text: "2 pm, 30 minutes",
      now: NOW,
    });
    assert.match(placed.replies[0], /Scheduled/);
    assert.match(placed.replies[0], /2pm–2:30pm/);
    const sessions = (await store.listSessions()).filter(
      (session) => session.person_id === "person-jeremy" && session.activity_type === "meeting" && new Date(session.start) > NOW,
    );
    assert.ok(sessions.length >= 2);
    const weekdays = new Set(
      sessions.map((session) => new Date(session.start).toLocaleString("en-US", { weekday: "short", timeZone: DEFAULT_TZ })),
    );
    assert.ok(weekdays.has("Tue"));
    assert.ok(weekdays.has("Thu"));
    assert.ok(sessions.every((session) => {
      const start = partsInZone(new Date(session.start), DEFAULT_TZ);
      const end = partsInZone(new Date(session.end), DEFAULT_TZ);
      return start.hour === 14 && start.minute === 0 && end.hour === 14 && end.minute === 30;
    }));
    assert.match(placed.replies[0], /Tue & Thu/);

    const canceled = await handleIncoming(store, {
      phone: "+15555501003",
      text: "cancel thursday meeting",
      now: NOW,
    });
    assert.match(canceled.replies[0], /Canceled/i);
    const left = (await store.listSessions()).filter(
      (session) => session.person_id === "person-jeremy" && session.activity_type === "meeting" && new Date(session.start) > NOW,
    );
    assert.ok(left.every((session) => partsInZone(new Date(session.start), DEFAULT_TZ).weekday === 2));
  });

  it("turns 10-2 + pm into 10am–2pm", async () => {
    const store = createMemoryStore(buildSeed(NOW));
    await handleIncoming(store, {
      phone: "+15555501001",
      text: "weeded carrot row from 10-2",
      now: NOW,
    });
    const logged = await handleIncoming(store, {
      phone: "+15555501001",
      text: "pm",
      now: NOW,
    });
    assert.match(logged.replies[0], /10am–2pm/);
    assert.ok(!/10pm/.test(logged.replies[0]));
  });

  it("accepts Kale / Peas after asking Kale or Kale / Peas", async () => {
    const seed = buildSeed(NOW);
    seed.beds.push(
      { id: "bed-kale", name: "Kale", row: "a", geometry: null },
      { id: "bed-kale-peas", name: "Kale / Peas", row: "b", geometry: null },
    );
    seed.plantings.push({
      id: "planting-peas-kale",
      bed_id: "bed-kale-peas",
      crop: "peas",
      planted_date: "2026-09-01",
      expected_harvest_date: "2026-12-01",
      removed_date: null,
      season_year: 2026,
      days_to_maturity: 60,
      source_session_id: null,
    });
    const store = createMemoryStore(seed);
    const first = await handleIncoming(store, {
      phone: "+15555501001",
      text: "i harvested peas from kale/peas on friday from 2pm-3pm",
      now: NOW,
    });
    // Longest-name match should resolve without asking — or accept the reply if asked.
    if (first.session) {
      assert.equal(first.session.bed_id, "bed-kale-peas");
      assert.equal(first.session.activity_type, "harvest");
      return;
    }
    assert.match(first.replies[0], /Which row/i);
    const second = await handleIncoming(store, {
      phone: "+15555501001",
      text: "Kale / Peas",
      now: NOW,
    });
    assert.equal(second.session?.bed_id, "bed-kale-peas");
    assert.ok(!/Which row/i.test(second.replies[0]));
  });

  it("creates a planting when someone plants into an empty row", async () => {
    const store = createMemoryStore(buildSeed(NOW));
    await handleIncoming(store, { phone: "+15555501002", text: "from 8-9am I planted kale", now: NOW });
    const logged = await handleIncoming(store, { phone: "+15555501002", text: "space x", now: NOW });
    assert.equal(logged.session?.bed_id, "bed-x");
    const plantings = await store.listPlantings();
    const kale = plantings.find((item) => item.crop === "kale" && item.removed_date === null);
    assert.ok(kale);
    assert.equal(kale.bed_id, "bed-x");
    assert.equal(kale.source_session_id, logged.session?.id);
  });

  it("clears the bed after a harvest text, and undo puts the crop back", async () => {
    const store = createMemoryStore(buildSeed(NOW));
    const before = (await store.listPlantings()).find((item) => item.id === "planting-carrots");
    assert.ok(before);
    assert.equal(before.removed_date, null);

    const logged = await handleIncoming(store, {
      phone: "+15555501001",
      text: "harvested carrots from the carrot row from 3-4pm",
      now: NOW,
    });
    assert.equal(logged.session?.activity_type, "harvest");
    assert.equal(logged.session?.planting_id, "planting-carrots");
    const cleared = (await store.listPlantings()).find((item) => item.id === "planting-carrots");
    assert.equal(cleared?.removed_date, "2026-11-14");

    await handleIncoming(store, { phone: "+15555501001", text: "undo", now: NOW });
    const restored = (await store.listPlantings()).find((item) => item.id === "planting-carrots");
    assert.equal(restored?.removed_date, null);
  });

  it("harvest clears every crop still in a mixed bed", async () => {
    const seed = buildSeed(NOW);
    seed.beds.push({ id: "bed-kale-peas", name: "Kale / Peas", row: "b", geometry: null });
    seed.plantings.push(
      {
        id: "p-kale-mix",
        bed_id: "bed-kale-peas",
        crop: "kale",
        planted_date: "2026-09-01",
        expected_harvest_date: "2026-12-01",
        removed_date: null,
        season_year: 2026,
        days_to_maturity: 60,
        source_session_id: null,
      },
      {
        id: "p-peas-mix",
        bed_id: "bed-kale-peas",
        crop: "peas",
        planted_date: "2026-09-01",
        expected_harvest_date: "2026-12-01",
        removed_date: null,
        season_year: 2026,
        days_to_maturity: 60,
        source_session_id: null,
      },
    );
    const store = createMemoryStore(seed);
    const logged = await handleIncoming(store, {
      phone: "+15555501001",
      text: "harvested the kale/peas row from 2-3pm",
      now: NOW,
    });
    assert.equal(logged.session?.activity_type, "harvest");
    assert.equal(logged.session?.bed_id, "bed-kale-peas");
    const plantings = await store.listPlantings();
    assert.equal(plantings.find((item) => item.id === "p-kale-mix")?.removed_date, "2026-11-14");
    assert.equal(plantings.find((item) => item.id === "p-peas-mix")?.removed_date, "2026-11-14");
  });

  it("logs a single yesterday planting, and delete removes past buggy batches", async () => {
    const seed = buildSeed(NOW);
    seed.beds.push({ id: "bed-nothing", name: "Nothing", row: "z", geometry: null });
    const store = createMemoryStore(seed);
    const filled = parseMessage("yesterday i filled nothing with winter rye at 1 pm to 2 pm");
    assert.equal(filled.kind, "session");
    if (filled.kind === "session") {
      assert.equal(filled.draft.activity, "plant");
      assert.equal(filled.draft.crop, "winter rye");
      assert.equal(filled.draft.dayOffset, -1);
      assert.equal(filled.draft.recurringWeeks, 1);
      assert.deepEqual(filled.draft.weekdays, []);
      assert.equal(expandOccurrences(filled.draft, NOW, DEFAULT_TZ).length, 1);
    }

    const logged = await handleIncoming(store, {
      phone: "+15555501003",
      text: "yesterday i filled nothing with winter rye at 1 pm to 2 pm",
      now: NOW,
    });
    assert.match(logged.replies[0], /Logged: Jeremy/);
    assert.ok(!/\d+ times/.test(logged.replies[0]));
    assert.equal(logged.session?.bed_id, "bed-nothing");
    const ryeSessions = (await store.listSessions()).filter((session) =>
      /winter rye/i.test(`${session.notes} ${session.raw_message}`),
    );
    assert.equal(ryeSessions.length, 1);

    const deleted = await handleIncoming(store, {
      phone: "+15555501003",
      text: "delete winter rye",
      now: NOW,
    });
    assert.match(deleted.replies[0], /Removed/);
    assert.equal(
      (await store.listSessions()).filter((session) => /winter rye/i.test(`${session.notes} ${session.raw_message}`))
        .length,
      0,
    );
  });

  it("watering and scheduling a meeting clear matching priority tasks", async () => {
    const store = createMemoryStore(buildSeed(NOW));
    const before = buildTasks({
      now: NOW,
      beds: await store.listBeds(),
      plantings: await store.listPlantings(),
      sessions: await store.listSessions(),
      timeZone: DEFAULT_TZ,
    });
    assert.ok(before.some((task) => task.type === "water" && task.bed_id === "bed-sp"));
    assert.ok(before.some((task) => task.type === "meeting"));

    await handleIncoming(store, {
      phone: "+15555501001",
      text: "watered the sweet potato row from 9-10am",
      now: NOW,
    });
    const afterWater = buildTasks({
      now: NOW,
      beds: await store.listBeds(),
      plantings: await store.listPlantings(),
      sessions: await store.listSessions(),
      timeZone: DEFAULT_TZ,
    });
    assert.ok(!afterWater.some((task) => task.type === "water" && task.bed_id === "bed-sp"));

    await handleIncoming(store, {
      phone: "+15555501003",
      text: "schedule a weekly meeting saturday from 10-11am",
      now: NOW,
    });
    // If it asked for clarification, answer am already present — may schedule directly.
    const conv = await store.getConversation("+15555501003");
    if (conv.pending) {
      await handleIncoming(store, { phone: "+15555501003", text: "am", now: NOW });
    }
    const afterMeet = buildTasks({
      now: NOW,
      beds: await store.listBeds(),
      plantings: await store.listPlantings(),
      sessions: await store.listSessions(),
      timeZone: DEFAULT_TZ,
    });
    assert.ok(!afterMeet.some((task) => task.type === "meeting"));
  });

  it("undoes the last log and answers schedule and watering questions", async () => {
    const store = createMemoryStore(buildSeed(NOW));
    const before = (await store.listSessions()).length;
    const logged = await handleIncoming(store, {
      phone: "+15555501001",
      text: "watered the carrot row from 4-5pm",
      now: NOW,
    });
    assert.ok(logged.session);
    const undone = await handleIncoming(store, { phone: "+15555501001", text: "undo", now: NOW });
    assert.match(undone.replies[0], /Removed/);
    assert.equal((await store.listSessions()).length, before);

    const schedule = await handleIncoming(store, {
      phone: "+15555501002",
      text: "what's on the schedule this week?",
      now: NOW,
    });
    assert.match(schedule.replies[0], /Emma/);
    assert.match(schedule.replies[0], /Jeremy/);

    const water = await handleIncoming(store, {
      phone: "+15555501002",
      text: "what needs watering?",
      now: NOW,
    });
    assert.match(water.replies[0], /Sweet potato needs watering/);

    const scheduled = await handleIncoming(store, {
      phone: "+15555501001",
      text: "schedule kumquats from 4-5 today",
      now: NOW,
    });
    assert.equal(scheduled.session, null);
    assert.match(scheduled.replies[0], /4–5am or 4–5pm/);

    const meeting = await handleIncoming(store, {
      phone: "+15555501003",
      text: "schedule a weekly meeting at 10 am",
      now: NOW,
    });
    assert.equal(meeting.session, null);
    assert.match(meeting.replies[0], /Which day/);
    const placed = await handleIncoming(store, {
      phone: "+15555501003",
      text: "the 19th of november",
      now: NOW,
    });
    assert.equal(placed.session?.activity_type, "meeting");
    assert.equal(placed.session?.start, "2026-11-19T15:00:00.000Z");
    assert.equal(placed.session?.end, "2026-11-19T16:00:00.000Z");
    assert.match(placed.replies[0], /Scheduled: Jeremy, .*10am–11am.*weekly meeting \(8 weeks\)\./);
    const standing = (await store.listSessions()).filter(
      (session) =>
        session.person_id === "person-jeremy" &&
        session.activity_type === "meeting" &&
        new Date(session.start) >= new Date("2026-11-19T15:00:00.000Z"),
    );
    assert.equal(standing.length, 8);
  });

  it("does not log an emergency", async () => {
    const store = createMemoryStore(buildSeed(NOW));
    const before = (await store.listSessions()).length;
    const result = await handleIncoming(store, {
      phone: "+15555501001",
      text: "this is an emergency, I hurt my hand",
      now: NOW,
    });
    assert.match(result.replies[0], /911/);
    assert.equal((await store.listSessions()).length, before);
  });
});

describe("shared contract", () => {
  it("does not send phone numbers to the calendar payload", async () => {
    const store = createMemoryStore(buildSeed(NOW));
    const dashboard = await loadDashboard(store, null, NOW);
    const encoded = JSON.stringify(dashboard);
    assert.equal(encoded.includes("+15555501001"), false);
    assert.equal(encoded.includes("5555501002"), false);
    assert.equal(dashboard.people.map((person) => person.name).join(","), "Emma,Sonali,Jeremy");
    assert.ok(dashboard.threads["person-emma"].length > 0);
  });
});

describe("photon webhook", () => {
  it("verifies a standard webhook and reads the sender handle", () => {
    const rawKey = Buffer.from("garden-demo-secret");
    const secret = `whsec_${rawKey.toString("base64")}`;
    const body = JSON.stringify({
      id: "pho_evt_1",
      type: "message.received",
      data: {
        object: {
          id: "pho_msg_1",
          status: "received",
          sentBy: { handle: "+15555501001", kind: "human" },
          receivedBy: { id: "pho_usr_agent" },
          space: { id: "pho_spc_1" },
          content: { type: "text", format: "plain", text: "weeded the carrot row for an hour" },
        },
      },
    });
    const timestamp = "1760000000";
    const signature = createHmac("sha256", rawKey).update(`pho_evt_1.${timestamp}.${body}`).digest("base64");
    const event = verifyStandardWebhook(
      body,
      { id: "pho_evt_1", timestamp, signature: `v1,${signature}` },
      secret,
      1760000000 * 1000,
    );
    const inbound = readPhotonInbound(event);
    assert.ok(inbound && "phone" in inbound);
    if (!inbound || !("phone" in inbound)) return;
    assert.equal(inbound.phone, "+15555501001");
    assert.equal(inbound.spaceId, "pho_spc_1");
    assert.match(inbound.text, /carrot/);

    assert.throws(() =>
      verifyStandardWebhook(body, { id: "pho_evt_1", timestamp, signature: "v1,nope" }, secret, 1760000000 * 1000),
    );
    const dispatched = readPhotonInbound({
      id: "pho_evt_2",
      type: "message.received",
      data: { object: { status: "dispatched", sentBy: { handle: "+1", kind: "agent" } } },
    });
    assert.deepEqual(dispatched, { ignore: true });
  });
});
