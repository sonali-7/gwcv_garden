import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { placeSlices, sessionStatus, slicesForSession } from "./calendar";
import { loadDashboard } from "./dashboard-data";
import { handleIncoming } from "./handle-message";
import { createMemoryStore } from "./memory-store";
import { mergeDrafts, messageFromTool } from "./agent";
import { calendarDate, needsDay, parseMessage, timeGaps } from "./parse";
import { buildTasks } from "./priority";
import { buildSeed } from "./seed";
import { DEFAULT_TZ, startOfWeekYmd, zonedToUtc } from "./time";
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
    assert.deepEqual(timeGaps(parsed.draft), []);
    assert.equal(needsDay(parsed.draft), true);
    assert.equal(calendarDate("the 19th of november", "2026-11-14"), "2026-11-19");
    assert.equal(calendarDate("11/19", "2026-11-14"), "2026-11-19");
    assert.equal(calendarDate("November 19", "2026-11-14"), "2026-11-19");
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
    assert.equal(slices[0].topPx, 46);
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
    assert.equal(asked.replies[0], "What time did you start?");
    const logged = await handleIncoming(store, { phone: "+15555501003", text: "10am", now: NOW });
    assert.equal(logged.session?.bed_id, "bed-carrot");
    assert.equal(logged.session?.planting_id, "planting-carrots");
    const start = new Date(logged.session!.start);
    assert.equal(start.toISOString(), zonedToUtc("2026-11-14", 10, 0, DEFAULT_TZ).toISOString());
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
    assert.equal(named.replies[1], "What time did you start?");
    const logged = await handleIncoming(store, { phone, text: "2pm", now: NOW });
    assert.equal(logged.person?.name, "Priya");
    assert.equal(logged.session?.bed_id, "bed-carrot");
    assert.equal(logged.person?.phone, phone);
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
    assert.deepEqual(placed.replies, ["Scheduled: Jeremy, Thu 11/19, 10am–11am, weekly meeting."]);
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
