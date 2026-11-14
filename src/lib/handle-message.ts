import { randomUUID } from "node:crypto";
import { interpretMessage } from "./agent";
import { maturityDays } from "./crops";
import { matchLocation } from "./location";
import { activePlantings, isActive } from "./plantings";
import { planPhrase, sentence, workPhrase } from "./phrases";
import {
  applyClarification,
  cleanName,
  EMERGENCY_REPLY,
  isEmergency,
  parseDraft,
  parseMessage,
  finishDraft,
  needsDay,
  questionFor,
  resolveStoredDate,
  timeGaps,
} from "./parse";
import { buildTasks } from "./priority";
import { sessionTouchesWeek } from "./calendar";
import type { Store } from "./store";
import {
  addDays,
  formatClock,
  gardenTz,
  partsInZone,
  startOfWeekYmd,
  todayYmd,
  to24,
  whenPhrase,
  zonedToUtc,
} from "./time";
import type {
  ActivityType,
  Bed,
  Conversation,
  HeldImage,
  Person,
  Planting,
  SessionDraft,
  ThreadMessage,
  WorkSession,
} from "./types";
import { blankConversation } from "./types";

const PALETTE = ["#3e6fd8", "#8a63c4", "#d4533c", "#2f8f6b", "#c9842a", "#3d7a8c", "#b4557a"];
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type IncomingImage = HeldImage;

export type HandleResult = {
  replies: string[];
  session: WorkSession | null;
  person: Person | null;
};

export async function phoneForNewVolunteer(store: Store): Promise<string> {
  const phones = await store.listDemoPhones();
  for (const phone of phones) {
    const person = await store.getPersonByPhone(phone);
    const conversation = await store.getConversation(phone);
    if (!person || conversation.pending?.kind === "name") return phone;
  }
  const phone = `+155555019${String(phones.length).padStart(2, "0")}`;
  await store.addDemoPhone(phone);
  return phone;
}

export async function handleIncoming(
  store: Store,
  input: { phone: string; text: string; now?: Date; image?: IncomingImage | null },
): Promise<HandleResult> {
  const now = input.now ?? new Date();
  const text = input.text.trim().slice(0, 1000);
  const phone = input.phone;
  const replies: string[] = [];
  const say = async (line: string) => {
    replies.push(line);
    await store.appendThread(phone, message("out", line, now));
  };

  await store.appendThread(phone, message("in", text, now, input.image?.url ?? null));

  if (text && isEmergency(text)) {
    await say(EMERGENCY_REPLY);
    const conversation = await store.getConversation(phone);
    await store.saveConversation(phone, { ...conversation, pending: null });
    return { replies, session: null, person: await store.getPersonByPhone(phone) };
  }

  if (!text && !input.image) {
    await say("Tell me what you did, and when.");
    return { replies, session: null, person: await store.getPersonByPhone(phone) };
  }

  let person = await store.getPersonByPhone(phone);
  let conversation = await store.getConversation(phone);

  if (!person) {
    if (conversation.pending?.kind === "name") {
      const beds = await store.listBeds();
      const plantings = await store.listPlantings();
      const name = cleanName(text);
      const looksLikeWork = parseMessage(text).kind === "session" || parseMessage(text).kind === "edit";
      if (!name || looksLikeWork || matchLocation(text, beds, plantings, todayYmd(now, gardenTz())).bed) {
        await say("What name should I put on the calendar?");
        return { replies, session: null, person: null };
      }
      person = await createPerson(store, phone, name);
      const resume = conversation.pending.resumeText;
      const image = input.image ?? conversation.pending.image;
      conversation = { ...blankConversation(), photon: conversation.photon, sentToday: conversation.sentToday };
      await store.saveConversation(phone, conversation);
      await say(`Thanks, ${name}. I'll remember you.`);
      if (!resume) {
        if (image) await persistPhoto(store, person.id, image, null, now);
        return { replies, session: null, person };
      }
      const session = await processText(store, person, resume, now, image, say);
      return { replies, session, person };
    }

    await store.saveConversation(phone, {
      ...conversation,
      pending: { kind: "name", resumeText: text, image: input.image ?? null },
    });
    await say("I don't have your name yet. What should I call you?");
    return { replies, session: null, person: null };
  }

  if (!text && input.image) {
    await persistPhoto(store, person.id, input.image, null, now);
    await say("Got the photo. What should I log with it?");
    return { replies, session: null, person };
  }

  if (conversation.pending && conversation.pending.kind !== "name") {
    const pending = conversation.pending;
    const parsed = parseMessage(text);
    const draftAttempt = parseDraft(text);
    const startOver =
      parsed.kind === "undo" ||
      parsed.kind === "query_schedule" ||
      parsed.kind === "query_watering" ||
      parsed.kind === "edit" ||
      (pending.kind === "time" && Boolean(draftAttempt?.activity)) ||
      (pending.kind === "row" &&
        Boolean(draftAttempt?.activity) &&
        Boolean(draftAttempt?.start || draftAttempt?.durationMin));

    if (!startOver) {
      const session = await answerPending(store, person, conversation, text, input.image ?? null, now, say);
      return { replies, session, person };
    }
    conversation = { ...conversation, pending: null };
    await store.saveConversation(phone, conversation);
  }

  const session = await processText(store, person, text, now, input.image ?? null, say);
  return { replies, session, person };
}

async function processText(
  store: Store,
  person: Person,
  text: string,
  now: Date,
  image: IncomingImage | null,
  say: (line: string) => Promise<void>,
): Promise<WorkSession | null> {
  const beds = await store.listBeds();
  const plantings = await store.listPlantings();
  const day = todayYmd(now, person.timezone);
  const parsed = await interpretMessage(text, {
    today: day,
    timezone: person.timezone,
    beds: beds.map((bed) => bed.name),
    crops: activePlantings(plantings, day).map((planting) => planting.crop),
  });
  if (parsed.kind === "undo") return undo(store, person, now, say);
  if (parsed.kind === "query_schedule") {
    await say(await scheduleText(store, now, person.timezone));
    if (image) await persistPhoto(store, person.id, image, null, now);
    return null;
  }
  if (parsed.kind === "query_watering") {
    await say(await wateringText(store, now, person.timezone));
    if (image) await persistPhoto(store, person.id, image, null, now);
    return null;
  }
  if (parsed.kind === "edit") return edit(store, person, parsed.instruction, now, say);
  if (parsed.kind === "unknown" || parsed.kind === "emergency") {
    await say('Tell me what you did and when. For example: "weeded the carrot row from 10–11am".');
    if (image) await persistPhoto(store, person.id, image, null, now);
    return null;
  }
  return continueDraft(store, person, parsed.draft, image, now, say);
}

async function answerPending(
  store: Store,
  person: Person,
  conversation: Conversation,
  text: string,
  image: IncomingImage | null,
  now: Date,
  say: (line: string) => Promise<void>,
): Promise<WorkSession | null> {
  const pending = conversation.pending;
  if (!pending || pending.kind === "name") return null;
  const held = image ?? pending.image;

  if (pending.kind === "time") {
    const applied = applyClarification(pending.draft, pending.field, text, todayYmd(now, person.timezone));
    if (!applied) {
      const tries = pending.tries + 1;
      if (tries >= 2) {
        await store.saveConversation(person.phone, { ...conversation, pending: null });
        await say(
          pending.field === "day"
            ? 'Send the day, like "November 19".'
            : 'Send it again with a time, like "from 8–9am".',
        );
        return null;
      }
      await store.saveConversation(person.phone, {
        ...conversation,
        pending: { ...pending, tries, image: held },
      });
      await say(questionFor(pending.draft, pending.field));
      return null;
    }
    return continueDraft(store, person, { ...applied, sourceText: pending.draft.sourceText }, held, now, say);
  }

  const beds = await store.listBeds();
  const plantings = await store.listPlantings();
  const day = resolveDay(pending.draft, now, person.timezone);
  const loc = matchLocation(text, beds, plantings, day);
  if (!loc.bed) {
    const tries = pending.tries + 1;
    if (tries >= 2) {
      return commit(store, person, pending.draft, null, null, held, now, say, true);
    }
    await store.saveConversation(person.phone, {
      ...conversation,
      pending: { ...pending, tries, image: held },
    });
    await say(loc.ambiguous ? `Which row — ${loc.choices.join(" or ")}?` : "Which row?");
    return null;
  }
  return commit(store, person, pending.draft, loc.bed, loc.planting, held, now, say, false);
}

function locationText(draft: SessionDraft): string {
  const lower = draft.sourceText.toLowerCase();
  const extra = [draft.place, draft.crop].filter(
    (value): value is string => Boolean(value) && !lower.includes(value!.toLowerCase()),
  );
  return [draft.sourceText, ...extra].join(" ");
}

async function continueDraft(
  store: Store,
  person: Person,
  draft: SessionDraft,
  image: IncomingImage | null,
  now: Date,
  say: (line: string) => Promise<void>,
): Promise<WorkSession | null> {
  const ready = finishDraft(draft);
  const gaps = timeGaps(ready);
  if (gaps[0]) {
    await store.saveConversation(person.phone, {
      ...(await store.getConversation(person.phone)),
      pending: { kind: "time", field: gaps[0], draft: ready, image, tries: 0 },
    });
    await say(questionFor(ready, gaps[0]));
    return null;
  }
  if (needsDay(ready)) {
    await store.saveConversation(person.phone, {
      ...(await store.getConversation(person.phone)),
      pending: { kind: "time", field: "day", draft: ready, image, tries: 0 },
    });
    await say(questionFor(ready, "day"));
    return null;
  }

  const interval = resolveInterval(ready, now, person.timezone);
  if (!interval) {
    await say("What time did you start?");
    return null;
  }
  const beds = await store.listBeds();
  const plantings = await store.listPlantings();
  const loc = matchLocation(locationText(ready), beds, plantings, interval.day);
  const activity = ready.activity ?? "other";
  if (!loc.bed && needsRow(activity)) {
    await store.saveConversation(person.phone, {
      ...(await store.getConversation(person.phone)),
      pending: { kind: "row", draft: ready, image, tries: 0, choices: loc.choices },
    });
    await say(loc.ambiguous ? `Which row — ${loc.choices.join(" or ")}?` : "Which row?");
    return null;
  }
  return commit(store, person, ready, loc.bed, loc.planting, image, now, say, false);
}

async function commit(
  store: Store,
  person: Person,
  draft: SessionDraft,
  bed: Bed | null,
  planting: Planting | null,
  image: IncomingImage | null,
  now: Date,
  say: (line: string) => Promise<void>,
  missingRow: boolean,
): Promise<WorkSession | null> {
  const interval = resolveInterval(draft, now, person.timezone);
  const activity = draft.activity ?? "other";
  if (!interval) {
    await say("What time did you start?");
    return null;
  }
  const crop = draft.crop ?? planting?.crop ?? null;
  let plantingId = planting?.id ?? null;
  const session: WorkSession = {
    id: randomUUID(),
    person_id: person.id,
    start: interval.start.toISOString(),
    end: interval.end.toISOString(),
    activity_type: activity,
    bed_id: bed?.id ?? null,
    planting_id: plantingId,
    notes: sentence(workPhrase(activity, crop, bed?.name ?? null)) + ".",
    raw_message: draft.sourceText,
  };

  if (activity === "plant" && crop && bed) {
    const plantings = await store.listPlantings();
    const existing = plantings.find(
      (item) => item.bed_id === bed.id && item.crop.toLowerCase() === crop.toLowerCase() && isActive(item, interval.day),
    );
    const planned = plantings.find(
      (item) =>
        item.bed_id === bed.id &&
        item.crop.toLowerCase() === crop.toLowerCase() &&
        item.planted_date > interval.day &&
        !item.removed_date &&
        !item.source_session_id,
    );
    if (existing) {
      plantingId = existing.id;
    } else if (planned) {
      // Someone planted what the garden view had planned: the plan becomes the real planting.
      await store.updatePlanting({
        ...planned,
        planted_date: interval.day,
        expected_harvest_date: addDays(interval.day, planned.days_to_maturity),
        season_year: Number(interval.day.slice(0, 4)),
        source_session_id: session.id,
      });
      plantingId = planned.id;
    } else {
      const days = maturityDays(crop);
      const created: Planting = {
        id: randomUUID(),
        bed_id: bed.id,
        crop,
        planted_date: interval.day,
        expected_harvest_date: addDays(interval.day, days),
        removed_date: null,
        season_year: Number(interval.day.slice(0, 4)),
        days_to_maturity: days,
        source_session_id: session.id,
      };
      await store.insertPlanting(created);
      plantingId = created.id;
    }
    session.planting_id = plantingId;
  } else if (plantingId) {
    session.planting_id = plantingId;
  }

  await store.insertSession(session);
  if (image) await persistPhoto(store, person.id, image, session.id, now);
  const previous = await store.getConversation(person.phone);
  await store.saveConversation(person.phone, {
    ...previous,
    pending: null,
    lastSessionId: session.id,
  });
  const planned = interval.start.getTime() > now.getTime();
  const phrase = planned
    ? planPhrase(activity, crop, bed?.name ?? null)
    : workPhrase(activity, crop, bed?.name ?? null);
  const when = whenPhrase(interval.start, interval.end, now, person.timezone);
  const label = planned ? "Scheduled" : "Logged";
  await say(
    missingRow
      ? `${label}: ${person.name}, ${when}, ${phrase}. I didn't attach a row.`
      : `${label}: ${person.name}, ${when}, ${phrase}.`,
  );
  return session;
}

async function undo(
  store: Store,
  person: Person,
  now: Date,
  say: (line: string) => Promise<void>,
): Promise<WorkSession | null> {
  const sessions = (await store.listSessions())
    .filter((session) => session.person_id === person.id)
    .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
  const last = sessions[0];
  if (!last) {
    await say("I don't have a log from you to undo.");
    return null;
  }
  await store.deleteSession(last.id);
  const plantings = await store.listPlantings();
  for (const planting of plantings) {
    if (planting.source_session_id === last.id) await store.deletePlanting(planting.id);
  }
  const conversation = await store.getConversation(person.phone);
  await store.saveConversation(person.phone, {
    ...conversation,
    pending: null,
    lastSessionId: conversation.lastSessionId === last.id ? null : conversation.lastSessionId,
  });
  const when = whenPhrase(new Date(last.start), new Date(last.end), now, person.timezone);
  await say(`Removed your last log (${when}).`);
  return null;
}

async function edit(
  store: Store,
  person: Person,
  instruction: string,
  now: Date,
  say: (line: string) => Promise<void>,
): Promise<WorkSession | null> {
  if (!instruction) {
    await say("What should I change — the time, the row, or the notes?");
    return null;
  }
  const sessions = (await store.listSessions())
    .filter((session) => session.person_id === person.id)
    .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
  const session = sessions[0];
  if (!session) {
    await say("I don't have a log from you to edit.");
    return null;
  }
  const draft = parseDraft(instruction);
  const beds = await store.listBeds();
  const plantings = await store.listPlantings();
  let next: WorkSession = { ...session, raw_message: instruction };
  if (draft && timeGaps(draft).length === 0) {
    const interval = resolveInterval(draft, now, person.timezone);
    if (interval) {
      next = { ...next, start: interval.start.toISOString(), end: interval.end.toISOString() };
    }
  }
  const loc = matchLocation(instruction, beds, plantings, todayYmd(now, person.timezone));
  if (loc.bed) {
    next = { ...next, bed_id: loc.bed.id, planting_id: loc.planting?.id ?? next.planting_id };
  }
  if (draft?.activity) next = { ...next, activity_type: draft.activity };
  const crop = draft?.crop ?? loc.planting?.crop ?? null;
  const bed = beds.find((item) => item.id === next.bed_id) ?? null;
  if (draft?.activity || loc.bed || draft?.crop) {
    next = {
      ...next,
      notes: sentence(workPhrase(next.activity_type, crop, bed?.name ?? null)) + ".",
    };
  } else if (!(draft && timeGaps(draft).length === 0)) {
    next = { ...next, notes: instruction };
  }
  await store.updateSession(next);
  const planting = plantings.find((item) => item.source_session_id === next.id);
  if (planting && next.activity_type === "plant") {
    const day = todayYmd(new Date(next.start), person.timezone);
    await store.updatePlanting({
      ...planting,
      planted_date: day,
      expected_harvest_date: addDays(day, planting.days_to_maturity),
      bed_id: next.bed_id ?? planting.bed_id,
    });
  }
  const when = whenPhrase(new Date(next.start), new Date(next.end), now, person.timezone);
  await say(`Updated: ${person.name}, ${when}, ${next.notes.replace(/\.$/, "").toLowerCase()}.`);
  return next;
}

async function scheduleText(store: Store, now: Date, timeZone: string): Promise<string> {
  const week = startOfWeekYmd(now, timeZone);
  const people = await store.listPeople();
  const sessions = (await store.listSessions())
    .filter((session) => sessionTouchesWeek(session, week, timeZone))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  if (sessions.length === 0) return "Nothing logged this week yet.";
  const lines = sessions.slice(0, 8).map((session) => {
    const person = people.find((item) => item.id === session.person_id);
    const start = partsInZone(new Date(session.start), timeZone);
    const end = partsInZone(new Date(session.end), timeZone);
    return `${DAY[start.weekday]} ${formatClock(start.hour, start.minute)}–${formatClock(end.hour, end.minute)} ${person?.name ?? "Someone"}: ${session.notes}`;
  });
  const extra = sessions.length > 8 ? ` And ${sessions.length - 8} more.` : "";
  return `This week: ${lines.join(" ")}${extra}`;
}

async function wateringText(store: Store, now: Date, timeZone: string): Promise<string> {
  const tasks = buildTasks({
    now,
    beds: await store.listBeds(),
    plantings: await store.listPlantings(),
    sessions: await store.listSessions(),
    timeZone,
  });
  const water = tasks.filter((task) => task.type === "water");
  if (water.length === 0) return "Nothing needs watering right now.";
  return water.map((task) => `${task.title}. ${task.detail}`).join(" ");
}

function needsRow(activity: ActivityType): boolean {
  return activity === "plant" || activity === "weed" || activity === "water" || activity === "harvest" || activity === "prep";
}

export function resolveInterval(
  draft: SessionDraft,
  now: Date,
  timeZone: string,
): { start: Date; end: Date; day: string } | null {
  if (!draft.start || !draft.startAmpm) return null;
  const day = resolveDay(draft, now, timeZone);
  const startHour = to24(draft.start.h, draft.startAmpm);
  const start = zonedToUtc(day, startHour, draft.start.m, timeZone);
  if (draft.end && draft.endAmpm) {
    const endHour = to24(draft.end.h, draft.endAmpm);
    let endDay = day;
    if (endHour * 60 + draft.end.m <= startHour * 60 + draft.start.m) endDay = addDays(day, 1);
    return { start, end: zonedToUtc(endDay, endHour, draft.end.m, timeZone), day };
  }
  if (draft.end && draft.startAmpm) {
    const endHour = to24(draft.end.h, draft.startAmpm);
    let endDay = day;
    if (endHour * 60 + draft.end.m <= startHour * 60 + draft.start.m) endDay = addDays(day, 1);
    return { start, end: zonedToUtc(endDay, endHour, draft.end.m, timeZone), day };
  }
  if (draft.durationMin) {
    return { start, end: new Date(start.getTime() + draft.durationMin * 60_000), day };
  }
  return null;
}

function resolveDay(draft: SessionDraft, now: Date, timeZone: string): string {
  const today = todayYmd(now, timeZone);
  if (draft.onDate) {
    const resolved = resolveStoredDate(draft.onDate, today);
    if (resolved) return resolved;
  }
  if (draft.dayOffset != null) return addDays(today, draft.dayOffset);
  if (draft.weekday != null) {
    const current = partsInZone(now, timeZone).weekday;
    let delta = draft.weekday - current;
    const upcoming = draft.nextWeek || draft.activity === "meeting";
    if (upcoming) {
      if (delta < 0) delta += 7;
    } else if (delta > 0) {
      delta -= 7;
    }
    return addDays(today, delta);
  }
  return today;
}

async function createPerson(store: Store, phone: string, name: string): Promise<Person> {
  const people = await store.listPeople();
  const person: Person = {
    id: randomUUID(),
    name,
    phone,
    color: PALETTE[people.length % PALETTE.length],
    timezone: gardenTz(),
  };
  await store.insertPerson(person);
  return person;
}

async function persistPhoto(
  store: Store,
  personId: string,
  image: IncomingImage,
  sessionId: string | null,
  now: Date,
): Promise<void> {
  await store.insertPhoto({
    id: randomUUID(),
    session_id: sessionId,
    person_id: personId,
    url: image.url,
    caption: image.caption,
    taken_at: now.toISOString(),
  });
}

function message(direction: "in" | "out", text: string, now: Date, imageUrl: string | null = null): ThreadMessage {
  return {
    id: randomUUID(),
    direction,
    text,
    at: now.toISOString(),
    imageUrl,
  };
}
