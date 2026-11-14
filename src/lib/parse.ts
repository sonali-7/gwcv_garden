import type { ActivityType, SessionDraft } from "./types";
import { canonicalCrop, knownCrops } from "./crops";

export type ParsedMessage =
  | { kind: "emergency" }
  | { kind: "undo" }
  | { kind: "cancel"; instruction: string }
  | { kind: "query_schedule" }
  | { kind: "query_watering" }
  | { kind: "edit"; instruction: string }
  | { kind: "session"; draft: SessionDraft }
  | { kind: "unknown" };

/** Standing / weekly plans are placed this many weeks out (hackathon-thin recurrence). */
export const STANDING_WEEKS = 8;

const ACTIVITIES: Array<[RegExp, ActivityType]> = [
  [/\b(weeded|weeding|weed)\b/i, "weed"],
  [/\b(watered|watering|water)\b/i, "water"],
  [/\b(harvested|harvest|picked|picking)\b/i, "harvest"],
  [/\b(planted|planting|plant|sowed|sown|sow)\b/i, "plant"],
  [/\b(mulched|mulch|tilled|till|prepped|prepared|prep)\b/i, "prep"],
  [/\b(meeting|met)\b/i, "meeting"],
  [/\b(checked|walked|turned)\b/i, "other"],
];

const WEEKDAY_WORDS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export const EMERGENCY_REPLY =
  "If someone is hurt or this is an emergency, call 911 now. I can't help with emergencies.";

export function isEmergency(text: string): boolean {
  return (
    /\b(emergency|ambulance|911|injur(?:y|ed|ies)|bleeding|unconscious|not breathing|chest pain)\b/i.test(
      text,
    ) || /\bhurt\b.{0,24}\b(hand|arm|leg|back|head|myself|badly)\b/i.test(text)
  );
}

export function timeGaps(draft: SessionDraft): Array<"start" | "ampm" | "end"> {
  const ready = finishDraft(draft);
  if (!ready.start) return ["start"];
  if (!ready.startAmpm) return ["ampm"];
  if (!ready.end && ready.durationMin) return [];
  if (!ready.end) return ["end"];
  if (!ready.endAmpm) return ["ampm"];
  return [];
}

export function needsDay(draft: SessionDraft): boolean {
  const hasDay =
    draft.onDate != null ||
    draft.dayOffset != null ||
    draft.weekday != null ||
    (draft.weekdays?.length ?? 0) > 0;
  return draft.activity === "meeting" && !hasDay;
}

/** True when a 12-hour start/end would cross noon/midnight if given the same am/pm. */
export function rangeCrossesMeridian(
  start: { h: number; m: number },
  end: { h: number; m: number },
): boolean {
  return start.h > end.h || (start.h === end.h && start.m >= end.m);
}

export function isFutureWording(draft: SessionDraft): boolean {
  const text = draft.sourceText.toLowerCase();
  if (/\b(schedule|scheduled|scheduling|plan(?:ning)?|will|gonna|going to)\b/.test(text)) return true;
  if (draft.activity === "meeting") return true;
  if (draft.nextWeek || draft.weekday != null || (draft.weekdays?.length ?? 0) > 0) return true;
  if (draft.dayOffset != null && draft.dayOffset > 0) return true;
  if (draft.recurringWeeks > 1) return true;
  if (/\b(weeded|watered|harvested|planted|mulched|tilled|prepped|checked|walked|turned)\b/.test(text)) {
    return false;
  }
  return false;
}

export function questionFor(draft: SessionDraft, field: "start" | "ampm" | "end" | "day"): string {
  if (field === "day") return "Which day?";
  if (field === "start") {
    return isFutureWording(draft) ? "What time should I put?" : "What time did you start?";
  }
  if (field === "end") return isFutureWording(draft) ? "Until when?" : "Until when did you go?";
  const start = draft.start;
  const end = draft.end;
  if (start && end && rangeCrossesMeridian(start, end)) {
    // "pm" for a 10–2 span almost always means 10am–2pm in the garden, not 10pm–2am.
    return `Was that ${clockLabel(start)}am–${clockLabel(end)}pm, or ${clockLabel(start)}pm–${clockLabel(end)}am?`;
  }
  if (start && end) {
    return `Was that ${clockLabel(start)}–${clockLabel(end)}am or ${clockLabel(start)}–${clockLabel(end)}pm?`;
  }
  if (start) return `Was that ${clockLabel(start)}am or ${clockLabel(start)}pm?`;
  return "Was that morning or evening?";
}

function clockLabel(clock: { h: number; m: number }): string {
  if (clock.m === 0) return String(clock.h);
  return `${clock.h}:${String(clock.m).padStart(2, "0")}`;
}

export function parseMessage(text: string): ParsedMessage {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "unknown" };
  if (isEmergency(trimmed)) return { kind: "emergency" };
  if (/^\s*undo\b/i.test(trimmed)) return { kind: "undo" };
  if (/^\s*(cancel|delete|remove)\b/i.test(trimmed)) {
    return {
      kind: "cancel",
      instruction: trimmed.replace(/^\s*(cancel|delete|remove)\b[:\s-]*/i, "").trim(),
    };
  }
  if (isScheduleQuery(trimmed)) return { kind: "query_schedule" };
  if (isWaterQuery(trimmed)) return { kind: "query_watering" };
  if (/^\s*edit\b/i.test(trimmed)) {
    return { kind: "edit", instruction: trimmed.replace(/^\s*edit\b[:\s-]*/i, "").trim() };
  }
  const draft = parseDraft(trimmed);
  if (!draft?.activity) return { kind: "unknown" };
  return { kind: "session", draft };
}

export function parseDraft(text: string): SessionDraft | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const activity = findActivity(lower);
  const range = findRange(lower);
  const single = range ? null : findSingle(lower);
  const durationMin = findDuration(lower);
  let start = range?.start ?? single?.start ?? null;
  let end = range?.end ?? null;
  let startAmpm = range?.startAmpm ?? single?.ampm ?? null;
  let endAmpm = range?.endAmpm ?? null;
  // Same-meridian only when the span does not cross noon/midnight (10–2 needs a smarter guess).
  if (start && end && !rangeCrossesMeridian(start, end)) {
    if (startAmpm && !endAmpm) endAmpm = startAmpm;
    if (endAmpm && !startAmpm) startAmpm = endAmpm;
  }
  const dayWord = findDaypart(lower);
  if (dayWord && !startAmpm) startAmpm = dayWord;
  if (dayWord && end && !endAmpm && !(start && rangeCrossesMeridian(start, end))) endAmpm = dayWord;

  const dayOffset = /\byesterday\b/.test(lower) ? -1 : /\btoday\b/.test(lower) ? 0 : /\btomorrow\b/.test(lower) ? 1 : null;
  const { weekdays, nextWeek } = findWeekdays(lower);
  const weekday = weekdays[0] ?? null;
  const recurringWeeks = isStanding(lower) ? STANDING_WEEKS : 1;

  if (
    !activity &&
    !start &&
    !end &&
    durationMin == null &&
    weekday == null &&
    dayOffset == null &&
    !findExplicitDate(lower)
  ) {
    return null;
  }

  return finishDraft({
    activity,
    crop: findCrop(lower),
    dayOffset,
    weekday,
    weekdays,
    nextWeek,
    recurringWeeks,
    start,
    end,
    startAmpm,
    endAmpm,
    durationMin,
    onDate: findExplicitDate(lower),
    place: null,
    sourceText: trimmed,
  });
}

export function finishDraft(draft: SessionDraft): SessionDraft {
  const weekdays = draft.weekdays ?? [];
  const recurringWeeks = draft.recurringWeeks ?? 1;
  const normalized: SessionDraft = {
    ...draft,
    weekdays,
    recurringWeeks,
    weekday: draft.weekday ?? weekdays[0] ?? null,
  };
  if (normalized.activity === "meeting" && normalized.start && !normalized.end && normalized.durationMin == null) {
    return { ...normalized, durationMin: 60 };
  }
  return normalized;
}

export function textHasDay(text: string): boolean {
  const lower = text.toLowerCase();
  if (/\b(today|yesterday|tomorrow)\b/.test(lower)) return true;
  if (WEEKDAY_WORDS.some((word) => new RegExp(`\\b${word}\\b`).test(lower))) return true;
  return findExplicitDate(lower) != null;
}

export function applyClarification(
  draft: SessionDraft,
  field: "start" | "ampm" | "end" | "day",
  text: string,
  today = "",
): SessionDraft | null {
  if (field === "day" || (field === "end" && draft.activity === "meeting")) {
    const onDate = calendarDate(text, today, field === "day");
    if (onDate) {
      return finishDraft({
        ...draft,
        onDate,
        dayOffset: null,
        weekday: null,
        weekdays: [],
        nextWeek: false,
      });
    }
    const named = parseDraft(text);
    if ((named?.weekday != null || named?.weekdays.length) && !named.start) {
      const weekdays = named.weekdays.length ? named.weekdays : named.weekday != null ? [named.weekday] : [];
      return finishDraft({
        ...draft,
        onDate: null,
        dayOffset: null,
        weekday: weekdays[0] ?? null,
        weekdays,
        nextWeek: true,
        recurringWeeks: Math.max(draft.recurringWeeks, named.recurringWeeks),
      });
    }
    if (field === "day") return null;
  }
  if (field === "ampm") {
    const word = ampmWord(text);
    if (word) {
      return finishDraft(applyAmpmWord(draft, word));
    }
  }
  const attempt = parseDraft(text);
  if (!attempt) {
    const bare = text.trim().match(
      /^(\d{1,2})(?::([0-5]\d))?\s*(?:(?:in the|this)\s+)?(a\.?m\.?|p\.?m\.?|morning|afternoon|evening|tonight)?(?:\s*,?\s*(\d+)\s*(minutes?|mins?|hours?|hrs?))?$/i,
    );
    if (!bare || field === "ampm") return null;
    const clock = { h: Number(bare[1]), m: Number(bare[2] ?? 0) };
    if (clock.h < 1 || clock.h > 12) return null;
    const flag = bare[3] ? ampmWord(bare[3]) : null;
    const durationMin = bare[4]
      ? bare[5].startsWith("h")
        ? Math.round(Number(bare[4]) * 60)
        : Number(bare[4])
      : null;
    if (field === "end") return finishDraft({ ...draft, end: clock, endAmpm: flag ?? draft.endAmpm });
    return finishDraft({
      ...draft,
      start: clock,
      startAmpm: flag ?? draft.startAmpm,
      endAmpm: draft.end ? (flag ?? draft.endAmpm) : draft.endAmpm,
      durationMin: durationMin ?? draft.durationMin,
      end: durationMin ? null : draft.end,
    });
  }
  if (field === "ampm") {
    if (!attempt.startAmpm && !attempt.endAmpm) return null;
    const flag = attempt.startAmpm ?? attempt.endAmpm;
    if (!flag) return null;
    const withTimes = {
      ...draft,
      start: attempt.start ?? draft.start,
      end: attempt.end ?? draft.end,
    };
    // Explicit 10am–2pm in the reply wins; bare "pm" uses the crossing heuristic.
    if (attempt.startAmpm && attempt.endAmpm && attempt.startAmpm !== attempt.endAmpm) {
      return finishDraft({ ...withTimes, startAmpm: attempt.startAmpm, endAmpm: attempt.endAmpm });
    }
    return finishDraft(applyAmpmWord(withTimes, flag));
  }
  if (field === "start") {
    if (!attempt.start && attempt.durationMin == null) return null;
    return finishDraft({
      ...draft,
      start: attempt.start ?? draft.start,
      startAmpm: attempt.startAmpm ?? draft.startAmpm,
      end: attempt.end ?? (attempt.durationMin ? null : draft.end),
      endAmpm: attempt.end ? (attempt.endAmpm ?? draft.endAmpm) : draft.endAmpm,
      durationMin: attempt.durationMin ?? draft.durationMin,
      weekday: attempt.weekday ?? draft.weekday,
      weekdays: attempt.weekdays.length ? attempt.weekdays : draft.weekdays,
      nextWeek: attempt.nextWeek || draft.nextWeek,
      recurringWeeks: Math.max(attempt.recurringWeeks, draft.recurringWeeks),
    });
  }
  const end = attempt.end ?? attempt.start;
  if (!end) return null;
  return {
    ...draft,
    end,
    endAmpm: attempt.endAmpm ?? attempt.startAmpm ?? draft.endAmpm,
    startAmpm: draft.startAmpm ?? attempt.startAmpm,
  };
}

export function ampmWord(text: string): "am" | "pm" | null {
  const lower = text.trim().toLowerCase();
  if (/^(a\.?m\.?|morning)$/.test(lower) || /\bmorning\b/.test(lower)) return "am";
  if (/^(p\.?m\.?|afternoon|evening|night|tonight)$/.test(lower) || /\b(afternoon|evening|tonight|night)\b/.test(lower)) {
    return "pm";
  }
  return null;
}

/**
 * Apply a single am/pm answer. For spans like 10–2, "pm" means daytime (10am–2pm)
 * and "am" means overnight (10pm–2am) — garden work is almost always the former.
 */
export function applyAmpmWord(draft: SessionDraft, word: "am" | "pm"): SessionDraft {
  const start = draft.start;
  const end = draft.end;
  if (start && end && rangeCrossesMeridian(start, end)) {
    if (word === "pm") return { ...draft, startAmpm: "am", endAmpm: "pm" };
    return { ...draft, startAmpm: "pm", endAmpm: "am" };
  }
  return {
    ...draft,
    startAmpm: word,
    endAmpm: end ? word : draft.endAmpm,
  };
}

export function cleanName(text: string): string | null {
  const trimmed = text.trim();
  if (!/^[A-Za-z][A-Za-z'’. -]{0,40}$/.test(trimmed)) return null;
  const words = trimmed.split(/\s+/);
  if (words.length === 0 || words.length > 3) return null;
  if (words.some((word) => /^(undo|edit|yes|no|am|pm|morning|afternoon|evening|the|row|today|yesterday)$/i.test(word))) {
    return null;
  }
  if (parseDraft(trimmed)?.activity) return null;
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function isScheduleQuery(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (/^(what'?s |what is )?(the |my |our )?schedule\??$/.test(lower)) return true;
  return (
    /\bwhat'?s on\b/i.test(text) ||
    /\b(the|my|our|this week'?s) schedule\b/i.test(text) ||
    /\bwhat(?:'s| is) (on the calendar|the schedule)\b/i.test(text) ||
    /\bwhat do we have\b/i.test(text) ||
    /\bthis week\?/i.test(text)
  );
}

function isWaterQuery(text: string): boolean {
  return (
    /\bneeds watering\b/i.test(text) ||
    /\bwhat(?:'s| is)?(?:\s+\w+){0,3}\s+water/i.test(text) ||
    /\bwhich\b.+\bwater/i.test(text)
  );
}

function findActivity(lower: string): ActivityType | null {
  let best: { index: number; activity: ActivityType } | null = null;
  for (const [pattern, activity] of ACTIVITIES) {
    const match = pattern.exec(lower);
    if (match && (best === null || match.index < best.index)) {
      best = { index: match.index, activity };
    }
  }
  if (best) return best.activity;
  if (/\bschedule(?:d|ing)?\b/.test(lower) && !isScheduleQuery(lower)) return "plant";
  return null;
}

function findRange(lower: string): {
  start: { h: number; m: number };
  end: { h: number; m: number };
  startAmpm: "am" | "pm" | null;
  endAmpm: "am" | "pm" | null;
} | null {
  const match = lower.match(
    /\b(?:from\s+)?(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:-|–|—|\bto\b)\s*(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)?/,
  );
  if (!match) return null;
  const after = lower.slice((match.index ?? 0) + match[0].length);
  if (/^\s*(hours?|hrs?|minutes?|mins?)\b/.test(after)) return null;
  const start = clock(match[1], match[2]);
  const end = clock(match[4], match[5]);
  if (!start || !end) return null;
  return {
    start,
    end,
    startAmpm: tokenAmpm(match[3]),
    endAmpm: tokenAmpm(match[6]),
  };
}

function findSingle(lower: string): { start: { h: number; m: number }; ampm: "am" | "pm" | null } | null {
  const match = lower.match(/\b(?:at|from|started at|until|til|till)\s+(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)?/);
  if (!match) {
    const loose = lower.match(/\b(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/);
    if (!loose) return null;
    const start = clock(loose[1], loose[2]);
    if (!start) return null;
    return { start, ampm: tokenAmpm(loose[3]) };
  }
  const start = clock(match[1], match[2]);
  if (!start) return null;
  return { start, ampm: tokenAmpm(match[3]) };
}

function findDuration(lower: string): number | null {
  const match = lower.match(
    /\b(?:for\s+)?(an|a|one|\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)\b/,
  );
  if (!match) return null;
  const qty = match[1] === "an" || match[1] === "a" || match[1] === "one" ? 1 : Number(match[1]);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (match[2].startsWith("h")) return Math.round(qty * 60);
  return Math.round(qty);
}

function findWeekdays(lower: string): { weekdays: number[]; nextWeek: boolean } {
  const weekdays: number[] = [];
  let nextWeek = false;
  const pattern = new RegExp(`\\b(next\\s+)?(${WEEKDAY_WORDS.join("|")})\\b`, "g");
  for (const match of lower.matchAll(pattern)) {
    if (match[1]) nextWeek = true;
    const index = WEEKDAY_WORDS.indexOf(match[2]);
    if (index >= 0 && !weekdays.includes(index)) weekdays.push(index);
  }
  return { weekdays, nextWeek };
}

function isStanding(lower: string): boolean {
  return /\b(weekly|standing|recurring|every\s+week|each\s+week)\b/.test(lower);
}

function findDaypart(lower: string): "am" | "pm" | null {
  if (/\b(this morning|in the morning)\b/.test(lower)) return "am";
  if (/\b(this afternoon|this evening|tonight)\b/.test(lower)) return "pm";
  return null;
}

function findCrop(lower: string): string | null {
  for (const crop of knownCrops()) {
    if (includesPhrase(lower, crop)) return canonicalCrop(crop);
  }
  const planted = lower.match(
    /\b(?:planted|planting|sowed|sow|schedule(?:d|ing)?)\s+(?:some\s+)?([a-z][a-z ]{1,32}?)(?:\s+in\b|\s+on\b|\s+at\b|\s+for\b|\s+from\b|\s+today\b|\s+yesterday\b|$)/,
  );
  if (!planted) return null;
  const phrase = planted[1].replace(/\b(the|some|a|an|row|bed)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!phrase || phrase.length < 3) return null;
  return canonicalCrop(phrase);
}

function includesPhrase(hay: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, "i").test(hay);
}

function clock(hour: string, minute: string | undefined): { h: number; m: number } | null {
  const h = Number(hour);
  const m = Number(minute ?? 0);
  if (h < 1 || h > 12 || m > 59) return null;
  return { h, m };
}

function tokenAmpm(token: string | undefined): "am" | "pm" | null {
  if (!token) return null;
  return token.replace(/\./g, "").toLowerCase().startsWith("p") ? "pm" : "am";
}

const MONTH_NUMBER: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sept: 9, sep: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

const MONTH_PATTERN = Object.keys(MONTH_NUMBER).sort((a, b) => b.length - a.length).join("|");

export function calendarDate(text: string, today: string, allowDayOnly = true): string | null {
  const lower = text.trim().toLowerCase().replace(/,/g, "");
  const parts = dateParts(lower, true);
  if (!parts || !today) return null;
  if (!allowDayOnly && parts.month === 0) return null;
  return materializeDate(parts, today);
}

export function resolveStoredDate(onDate: string, today: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(onDate)) return onDate;
  const match = onDate.match(/^(\d{2})-(\d{2})$/);
  if (!match) return null;
  return materializeDate({ month: Number(match[1]), day: Number(match[2]), year: null }, today);
}

function findExplicitDate(lower: string): string | null {
  const parts = dateParts(lower, false);
  if (!parts || parts.month === 0) return null;
  if (parts.year) return materializeDate(parts, `${parts.year}-01-01`);
  return `${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function dateParts(
  lower: string,
  whole: boolean,
): { month: number; day: number; year: number | null } | null {
  const ofMonth = new RegExp(
    `${whole ? "^" : "\\b"}(?:on\\s+|the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+of\\s+(${MONTH_PATTERN})(?:\\s+(\\d{4}))?${whole ? "$" : "\\b"}`,
  ).exec(lower);
  if (ofMonth) return partsFrom(Number(ofMonth[1]), MONTH_NUMBER[ofMonth[2]], ofMonth[3]);
  const monthFirst = new RegExp(
    `${whole ? "^" : "\\b"}(?:on\\s+)?(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(\\d{4}))?${whole ? "$" : "\\b"}`,
  ).exec(lower);
  if (monthFirst) return partsFrom(Number(monthFirst[2]), MONTH_NUMBER[monthFirst[1]], monthFirst[3]);
  const numeric = new RegExp(
    `${whole ? "^" : "\\b"}(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?${whole ? "$" : "\\b"}`,
  ).exec(lower);
  if (numeric) return partsFrom(Number(numeric[2]), Number(numeric[1]), numeric[3]);
  if (!whole) return null;
  const dayOnly = /^(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?$/.exec(lower);
  if (!dayOnly) return null;
  return partsFrom(Number(dayOnly[1]), 0, undefined);
}

function partsFrom(
  day: number,
  month: number,
  year: string | undefined,
): { month: number; day: number; year: number | null } | null {
  if (day < 1 || day > 31) return null;
  if (month !== 0 && (month < 1 || month > 12)) return null;
  return { month, day, year: year ? Number(year) : null };
}

function materializeDate(
  found: { month: number; day: number; year: number | null },
  today: string,
): string | null {
  const [ty, tm, td] = today.split("-").map(Number);
  if (!ty || !tm || !td) return null;
  let year = found.year ?? ty;
  if (found.year != null && found.year < 100) year += 2000;
  let month = found.month;
  if (month === 0) {
    month = tm;
    if (found.day < td) {
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
  }
  let iso = isoDate(year, month, found.day);
  if (!iso) return null;
  if (found.year == null && iso < today) iso = isoDate(year + 1, month, found.day);
  return iso;
}

function isoDate(year: number, month: number, day: number): string | null {
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return utc.toISOString().slice(0, 10);
}
