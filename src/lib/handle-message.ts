import { randomUUID } from "node:crypto";
import { interpretMessage } from "./agent";
import { maturityDays } from "./crops";
import { isMultiAccept, matchLocation } from "./location";
import { activePlantings, isActive } from "./plantings";
import { planPhrase, sentence, workPhrase } from "./phrases";
import {
  applyClarification,
  cleanName,
  EMERGENCY_REPLY,
  helpForTimeField,
  isEmergency,
  isHelpRequest,
  parseDraft,
  parseMessage,
  finishDraft,
  needsDay,
  questionFor,
  resolveStoredDate,
  rowOptionsReply,
  rowQuestion,
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
  TextMemory,
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
      parsed.kind === "cancel" ||
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
  const conversation = await store.getConversation(person.phone);
  const parsed = await interpretMessage(text, {
    today: day,
    timezone: person.timezone,
    beds: beds.map((bed) => bed.name),
    crops: activePlantings(plantings, day).map((planting) => planting.crop),
    memory: conversation.memory ?? null,
  });
  if (parsed.kind === "undo") return undo(store, person, now, say);
  if (parsed.kind === "cancel") {
    return cancelPlans(store, person, parsed.instruction, parsed.includePast, now, say);
  }
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
    if (isHelpRequest(text)) {
      await say(helpForTimeField(pending.field));
      return null;
    }
    const applied = applyClarification(pending.draft, pending.field, text, todayYmd(now, person.timezone));
    if (!applied) {
      const tries = pending.tries + 1;
      if (tries >= 2) {
        await store.saveConversation(person.phone, { ...conversation, pending: null });
        await say(helpForTimeField(pending.field));
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
  const bedNames = beds.filter((bed) => !bed.archived).map((bed) => bed.name);
  if (isHelpRequest(text)) {
    await say(rowOptionsReply(pending.choices ?? [], bedNames));
    return null;
  }
  const day = resolveDay(pending.draft, now, person.timezone);
  const choices = pending.choices?.length ? pending.choices : undefined;
  const loc = matchLocation(text, beds, plantings, day, { choices });
  const targets =
    loc.beds.length > 0
      ? loc.beds
      : isMultiAccept(text) && choices?.length
        ? beds.filter((bed) => choices.some((name) => name === bed.name))
        : loc.bed
          ? [loc.bed]
          : [];
  if (targets.length === 0) {
    const tries = pending.tries + 1;
    if (tries >= 2) {
      return commit(store, person, pending.draft, null, null, held, now, say, true);
    }
    const nextChoices = loc.choices.length ? loc.choices : pending.choices;
    await store.saveConversation(person.phone, {
      ...conversation,
      pending: { ...pending, tries, image: held, choices: nextChoices },
    });
    await say(rowQuestion(nextChoices, bedNames));
    return null;
  }
  return commitBeds(store, person, pending.draft, targets, plantings, held, now, say, day);
}

function locationText(draft: SessionDraft): string {
  const lower = draft.sourceText.toLowerCase();
  const extras = [...(draft.places ?? []), draft.place, draft.crop].filter(
    (value): value is string => Boolean(value) && !lower.includes(value!.toLowerCase()),
  );
  return [draft.sourceText, ...extras].join(" ");
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

  const occurrences = expandOccurrences(ready, now, person.timezone);
  const first = resolveInterval(occurrences[0] ?? ready, now, person.timezone);
  if (!first) {
    await say(questionFor(ready, "start"));
    return null;
  }
  const beds = await store.listBeds();
  const plantings = await store.listPlantings();
  const loc = matchLocation(locationText(ready), beds, plantings, first.day);
  const activity = ready.activity ?? "other";
  const targets = loc.beds.length ? loc.beds : loc.bed ? [loc.bed] : [];
  if (targets.length === 0 && needsRow(activity)) {
    const bedNames = beds.filter((bed) => !bed.archived).map((bed) => bed.name);
    await store.saveConversation(person.phone, {
      ...(await store.getConversation(person.phone)),
      pending: { kind: "row", draft: ready, image, tries: 0, choices: loc.choices },
    });
    await say(rowQuestion(loc.choices, bedNames));
    return null;
  }

  if (occurrences.length === 1 && targets.length <= 1) {
    return commit(store, person, occurrences[0], targets[0] ?? null, loc.planting, image, now, say, false);
  }

  const created: WorkSession[] = [];
  let photoUsed = false;
  for (const occurrence of occurrences) {
    for (const bed of targets.length ? targets : [null]) {
      const planting =
        bed && loc.planting?.bed_id === bed.id
          ? loc.planting
          : bed
            ? matchLocation(locationText(ready), [bed], plantings, first.day).planting
            : null;
      const session = await commit(
        store,
        person,
        occurrence,
        bed,
        planting,
        !photoUsed ? image : null,
        now,
        async () => undefined,
        false,
      );
      if (session) {
        created.push(session);
        photoUsed = true;
      }
    }
  }
  if (created.length === 0) {
    await say("I couldn't schedule those.");
    return null;
  }
  return finishBatch(store, person, ready, created, targets, now, say);
}

async function commitBeds(
  store: Store,
  person: Person,
  draft: SessionDraft,
  targets: Bed[],
  plantings: Planting[],
  image: IncomingImage | null,
  now: Date,
  say: (line: string) => Promise<void>,
  day: string,
): Promise<WorkSession | null> {
  if (targets.length === 1) {
    const planting = matchLocation(locationText(draft), targets, plantings, day).planting;
    return commit(store, person, draft, targets[0], planting, image, now, say, false);
  }
  const created: WorkSession[] = [];
  let photoUsed = false;
  for (const bed of targets) {
    const planting = matchLocation(locationText(draft), [bed], plantings, day).planting;
    const session = await commit(
      store,
      person,
      draft,
      bed,
      planting,
      !photoUsed ? image : null,
      now,
      async () => undefined,
      false,
    );
    if (session) {
      created.push(session);
      photoUsed = true;
    }
  }
  if (created.length === 0) {
    await say("I couldn't log those rows.");
    return null;
  }
  return finishBatch(store, person, draft, created, targets, now, say);
}

async function finishBatch(
  store: Store,
  person: Person,
  draft: SessionDraft,
  created: WorkSession[],
  beds: Bed[],
  now: Date,
  say: (line: string) => Promise<void>,
): Promise<WorkSession | null> {
  const activity = draft.activity ?? "other";
  const planned = created.some((session) => new Date(session.start).getTime() > now.getTime());
  const label = planned ? "Scheduled" : "Logged";
  const phrase =
    beds.length > 1
      ? multiBedPhrase(activity, beds.map((bed) => bed.name), planned)
      : planned
        ? planPhrase(activity, draft.crop, beds[0]?.name ?? null)
        : workPhrase(activity, draft.crop, beds[0]?.name ?? null);
  const previous = await store.getConversation(person.phone);
  const memory = memoryFromDraft(draft, beds, created[0] ?? null, now);
  await store.saveConversation(person.phone, {
    ...previous,
    pending: null,
    lastSessionId: created[created.length - 1]?.id ?? null,
    lastSessionIds: created.map((session) => session.id),
    memory,
  });
  await say(
    `${label}: ${person.name}, ${seriesWhen(created, now, person.timezone, draft.recurringWeeks)}, ${phrase}${draft.recurringWeeks > 1 ? ` (${draft.recurringWeeks} weeks)` : ""}.`,
  );
  return created[0] ?? null;
}

function memoryFromDraft(
  draft: SessionDraft,
  beds: Bed[],
  session: WorkSession | null,
  now: Date,
): TextMemory {
  const bedNames = beds.map((bed) => bed.name);
  const activity = draft.activity ?? session?.activity_type ?? "other";
  const where = bedNames.length ? ` on ${bedNames.join(" and ")}` : "";
  return {
    at: now.toISOString(),
    activity,
    bedNames,
    summary: `${activity}${where}`,
    start: draft.start,
    end: draft.end,
    startAmpm: draft.startAmpm,
    endAmpm: draft.endAmpm,
    durationMin: draft.durationMin,
    dayOffset: draft.dayOffset,
  };
}

function multiBedPhrase(activity: ActivityType, bedNames: string[], planned: boolean): string {
  const joined = bedNames.join(" and ");
  const verb = planned
    ? activity === "water"
      ? "water"
      : activity === "weed"
        ? "weed"
        : activity === "harvest"
          ? "harvest"
          : activity === "plant"
            ? "plant"
            : "work"
    : activity === "water"
      ? "watered"
      : activity === "weed"
        ? "weeded"
        : activity === "harvest"
          ? "harvested"
          : activity === "plant"
            ? "planted"
            : "worked";
  return `${verb} ${joined}`;
}

/** Compact confirmation for multi-day / standing series (keeps SMS short). */
function seriesWhen(sessions: WorkSession[], now: Date, timeZone: string, weeks: number): string {
  if (sessions.length === 1) {
    return whenPhrase(new Date(sessions[0].start), new Date(sessions[0].end), now, timeZone);
  }
  // Same clock on several beds → one when-phrase (not "today 5pm; today 5pm").
  const sameSlot = sessions.every(
    (session) => session.start === sessions[0].start && session.end === sessions[0].end,
  );
  if (sameSlot) {
    return whenPhrase(new Date(sessions[0].start), new Date(sessions[0].end), now, timeZone);
  }
  const first = sessions[0];
  const startParts = partsInZone(new Date(first.start), timeZone);
  const endParts = partsInZone(new Date(first.end), timeZone);
  const clock = `${formatClock(startParts.hour, startParts.minute)}–${formatClock(endParts.hour, endParts.minute)}`;
  const dowOrder: number[] = [];
  const firstByDow = new Map<number, WorkSession>();
  for (const session of sessions) {
    const dow = partsInZone(new Date(session.start), timeZone).weekday;
    if (!firstByDow.has(dow)) {
      firstByDow.set(dow, session);
      dowOrder.push(dow);
    }
  }
  const dowLabel = dowOrder.map((dow) => DAY[dow]).join(" & ");
  if (weeks > 1) {
    const startLabel = whenPhrase(new Date(first.start), new Date(first.end), now, timeZone).replace(
      /,?\s*\d{1,2}(?::\d{2})?(?:am|pm)–.+$/,
      "",
    );
    return `${dowLabel} ${clock} starting ${startLabel}`;
  }
  if (sessions.length <= 4) {
    return sessions
      .map((session) => whenPhrase(new Date(session.start), new Date(session.end), now, timeZone))
      .join("; ");
  }
  return `${dowLabel} ${clock} (${sessions.length} times)`;
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
    await say(questionFor(draft, "start"));
    return null;
  }
  const crop = draft.crop ?? planting?.crop ?? null;
  let plantingId = planting?.id ?? null;
  const planned = interval.start.getTime() > now.getTime();
  const session: WorkSession = {
    id: randomUUID(),
    person_id: person.id,
    start: interval.start.toISOString(),
    end: interval.end.toISOString(),
    activity_type: activity,
    bed_id: bed?.id ?? null,
    planting_id: plantingId,
    notes:
      sentence(
        planned ? planPhrase(activity, crop, bed?.name ?? null) : workPhrase(activity, crop, bed?.name ?? null),
      ) + ".",
    raw_message: draft.sourceText,
  };

  if (activity === "plant" && crop && bed) {
    const plantings = await store.listPlantings();
    const existing = plantings.find(
      (item) => item.bed_id === bed.id && item.crop.toLowerCase() === crop.toLowerCase() && isActive(item, interval.day),
    );
    const plannedPlanting = plantings.find(
      (item) =>
        item.bed_id === bed.id &&
        item.crop.toLowerCase() === crop.toLowerCase() &&
        item.planted_date > interval.day &&
        !item.removed_date &&
        !item.source_session_id,
    );
    if (existing) {
      plantingId = existing.id;
    } else if (plannedPlanting) {
      // Someone planted what the garden view had planned: the plan becomes the real planting.
      await store.updatePlanting({
        ...plannedPlanting,
        planted_date: interval.day,
        expected_harvest_date: addDays(interval.day, plannedPlanting.days_to_maturity),
        season_year: Number(interval.day.slice(0, 4)),
        source_session_id: session.id,
      });
      plantingId = plannedPlanting.id;
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
  } else if (activity === "harvest") {
    const cleared = await clearHarvestFromBed(store, bed, planting, crop, interval.day);
    if (cleared.length) {
      plantingId = cleared[0].id;
      session.planting_id = plantingId;
      if (!session.bed_id) session.bed_id = cleared[0].bed_id;
    } else if (plantingId) {
      session.planting_id = plantingId;
    }
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
    lastSessionIds: [session.id],
    memory: memoryFromDraft(draft, bed ? [bed] : [], session, now),
  });
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

/** Turn one draft into one draft per weekday × standing week. */
export function expandOccurrences(draft: SessionDraft, now: Date, timeZone: string): SessionDraft[] {
  const weeks = Math.max(1, draft.recurringWeeks || 1);
  // Relative days are one-shot logs — never explode into a series.
  if (draft.dayOffset != null && weeks <= 1) {
    return [{ ...draft, weekday: null, weekdays: [], recurringWeeks: 1, nextWeek: false }];
  }

  const days =
    draft.weekdays?.length > 0
      ? draft.weekdays
      : draft.weekday != null
        ? [draft.weekday]
        : [null];
  if (days.length === 1 && days[0] == null && weeks === 1) return [draft];
  // A single named weekday with no "weekly/standing" stays one occurrence.
  if (days.length === 1 && weeks === 1 && draft.onDate == null) return [draft];

  const out: SessionDraft[] = [];
  for (let week = 0; week < weeks; week += 1) {
    for (const weekday of days) {
      const base: SessionDraft = {
        ...draft,
        weekday,
        weekdays: weekday != null ? [weekday] : [],
        recurringWeeks: 1,
        nextWeek: draft.nextWeek || draft.activity === "meeting",
      };
      const day = resolveDay(base, now, timeZone);
      out.push({
        ...base,
        onDate: addDays(day, week * 7),
        weekday: null,
        weekdays: [],
        dayOffset: null,
        nextWeek: false,
      });
    }
  }
  return out.length ? out : [draft];
}

async function cancelPlans(
  store: Store,
  person: Person,
  instruction: string,
  includePast: boolean,
  now: Date,
  say: (line: string) => Promise<void>,
): Promise<WorkSession | null> {
  const mine = (await store.listSessions())
    .filter((session) => session.person_id === person.id)
    .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
  const future = mine
    .filter((session) => new Date(session.start).getTime() > now.getTime())
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const pool = includePast ? mine : future;
  if (pool.length === 0) {
    await say(includePast ? "I don't have a log of yours to delete." : "I don't have a future plan of yours to cancel.");
    return null;
  }

  // Bare "delete" undoes the last batch; bare "cancel" drops the soonest upcoming plan.
  if (!instruction.trim()) {
    if (includePast) return undo(store, person, now, say);
    const targets = future.slice(0, 1);
    if (!targets.length) {
      await say("I don't have a future plan of yours to cancel.");
      return null;
    }
    await removeSessions(store, person, targets, now, say, "Canceled");
    return null;
  }

  const hint = parseDraft(instruction);
  let targets = pool;
  if (hint?.dayOffset != null || hint?.onDate) {
    const day =
      hint.onDate != null
        ? resolveStoredDate(hint.onDate, todayYmd(now, person.timezone))
        : addDays(todayYmd(now, person.timezone), hint.dayOffset ?? 0);
    if (day) {
      targets = targets.filter((session) => todayYmd(new Date(session.start), person.timezone) === day);
    }
  }
  if (hint?.weekday != null || hint?.weekdays?.length) {
    const wanted = new Set(hint.weekdays.length ? hint.weekdays : hint.weekday != null ? [hint.weekday] : []);
    targets = targets.filter((session) => wanted.has(partsInZone(new Date(session.start), person.timezone).weekday));
  }
  if (hint?.activity) {
    targets = targets.filter((session) => session.activity_type === hint.activity);
  }
  if (hint?.crop) {
    const crop = hint.crop.toLowerCase();
    targets = targets.filter((session) => `${session.notes} ${session.raw_message}`.toLowerCase().includes(crop));
  }
  if (hint?.start && hint.startAmpm) {
    const hour = to24(hint.start.h, hint.startAmpm);
    targets = targets.filter((session) => partsInZone(new Date(session.start), person.timezone).hour === hour);
  }
  // Fall back to raw substring match when the draft parser found nothing useful.
  if (targets === pool || (targets.length === pool.length && !hint?.activity && !hint?.crop && hint?.dayOffset == null && !hint?.onDate)) {
    const needle = instruction.toLowerCase().trim();
    if (needle) {
      const hit = pool.filter((session) => `${session.notes} ${session.raw_message}`.toLowerCase().includes(needle));
      if (hit.length) targets = hit;
    }
  }
  if (targets.length > 1) {
    const grouped = new Map<string, WorkSession[]>();
    for (const session of targets) {
      const key = session.raw_message || session.id;
      grouped.set(key, [...(grouped.get(key) ?? []), session]);
    }
    const biggest = [...grouped.values()].sort((a, b) => b.length - a.length)[0];
    if (biggest?.length) targets = biggest;
  }

  if (targets.length === 0) {
    await say(
      includePast
        ? 'I couldn\'t find that log. Try "undo", "delete yesterday", or "delete winter rye".'
        : "I couldn't find a matching future plan to cancel.",
    );
    return null;
  }

  await removeSessions(store, person, targets, now, say, includePast ? "Removed" : "Canceled");
  return null;
}

async function undo(
  store: Store,
  person: Person,
  now: Date,
  say: (line: string) => Promise<void>,
): Promise<WorkSession | null> {
  const conversation = await store.getConversation(person.phone);
  const batchIds =
    conversation.lastSessionIds?.length
      ? conversation.lastSessionIds
      : conversation.lastSessionId
        ? [conversation.lastSessionId]
        : [];
  const mine = await store.listSessions();
  let targets = batchIds
    .map((id) => mine.find((session) => session.id === id && session.person_id === person.id))
    .filter((session): session is WorkSession => Boolean(session));

  if (targets.length === 0) {
    const last = mine
      .filter((session) => session.person_id === person.id)
      .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime())[0];
    if (!last) {
      await say("I don't have a log from you to undo.");
      return null;
    }
    targets = [last];
  }

  await removeSessions(store, person, targets, now, say, "Removed");
  return null;
}

async function removeSessions(
  store: Store,
  person: Person,
  targets: WorkSession[],
  now: Date,
  say: (line: string) => Promise<void>,
  label: string,
): Promise<void> {
  const plantings = await store.listPlantings();
  const removedIds = new Set(targets.map((session) => session.id));
  for (const session of targets) {
    await store.deleteSession(session.id);
    for (const planting of plantings) {
      if (planting.source_session_id === session.id) await store.deletePlanting(planting.id);
    }
  }
  for (const session of targets.filter((item) => item.activity_type === "harvest")) {
    const day = todayYmd(new Date(session.start), person.timezone);
    for (const planting of plantings) {
      if (planting.removed_date !== day) continue;
      if (session.bed_id && planting.bed_id === session.bed_id) {
        await store.updatePlanting({ ...planting, removed_date: null });
      } else if (planting.id === session.planting_id) {
        await store.updatePlanting({ ...planting, removed_date: null });
      }
    }
  }

  const conversation = await store.getConversation(person.phone);
  await store.saveConversation(person.phone, {
    ...conversation,
    pending: null,
    lastSessionId: conversation.lastSessionId && removedIds.has(conversation.lastSessionId) ? null : conversation.lastSessionId,
    lastSessionIds: (conversation.lastSessionIds ?? []).filter((id) => !removedIds.has(id)),
  });

  if (targets.length === 1) {
    const session = targets[0];
    await say(`${label} your log (${whenPhrase(new Date(session.start), new Date(session.end), now, person.timezone)}).`);
  } else {
    await say(`${label} ${targets.length} logs from that batch.`);
  }
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

/** Harvest clears whatever is still in-ground on that bed (mixed beds included). */
async function clearHarvestFromBed(
  store: Store,
  bed: Bed | null,
  planting: Planting | null,
  crop: string | null,
  day: string,
): Promise<Planting[]> {
  const active = activePlantings(await store.listPlantings(), day);
  let targets: Planting[] = [];
  if (bed) {
    targets = active.filter((item) => item.bed_id === bed.id);
  } else if (planting && isActive(planting, day)) {
    targets = active.filter((item) => item.bed_id === planting.bed_id);
  } else if (crop) {
    targets = active.filter((item) => item.crop.toLowerCase() === crop.toLowerCase());
  }
  for (const item of targets) {
    await store.updatePlanting({ ...item, removed_date: day });
  }
  return targets;
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
