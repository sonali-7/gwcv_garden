import type { ActivityType, SessionDraft } from "./types";
import { canonicalCrop, knownCrops } from "./crops";

export type ParsedMessage =
  | { kind: "emergency" }
  | { kind: "undo" }
  | { kind: "query_schedule" }
  | { kind: "query_watering" }
  | { kind: "edit"; instruction: string }
  | { kind: "session"; draft: SessionDraft }
  | { kind: "unknown" };

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
  if (!draft.start) return ["start"];
  if (!draft.startAmpm) return ["ampm"];
  if (!draft.end && draft.durationMin) return [];
  if (!draft.end) return ["end"];
  if (!draft.endAmpm) return ["ampm"];
  return [];
}

export function questionFor(draft: SessionDraft, field: "start" | "ampm" | "end"): string {
  if (field === "start") return "What time did you start?";
  if (field === "end") return "Until when?";
  const start = draft.start;
  const end = draft.end;
  if (start && end) return `Was that ${clockLabel(start)}–${clockLabel(end)}am or ${clockLabel(start)}–${clockLabel(end)}pm?`;
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
  if (start && end && startAmpm && !endAmpm) endAmpm = startAmpm;
  if (start && end && endAmpm && !startAmpm) startAmpm = endAmpm;
  const dayWord = findDaypart(lower);
  if (dayWord && !startAmpm) startAmpm = dayWord;
  if (dayWord && end && !endAmpm) endAmpm = dayWord;

  const dayOffset = /\byesterday\b/.test(lower) ? -1 : /\btoday\b/.test(lower) ? 0 : null;
  const nextWeek = /\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.test(lower);
  let weekday: number | null = null;
  for (let i = 0; i < WEEKDAY_WORDS.length; i += 1) {
    if (lower.includes(WEEKDAY_WORDS[i])) weekday = i;
  }

  if (!activity && !start && !end && durationMin == null && weekday == null && dayOffset == null) {
    return null;
  }

  return {
    activity,
    crop: findCrop(lower),
    dayOffset,
    weekday,
    nextWeek,
    start,
    end,
    startAmpm,
    endAmpm,
    durationMin,
    sourceText: trimmed,
  };
}

export function applyClarification(
  draft: SessionDraft,
  field: "start" | "ampm" | "end",
  text: string,
): SessionDraft | null {
  if (field === "ampm") {
    const word = ampmWord(text);
    if (word) {
      return {
        ...draft,
        startAmpm: word,
        endAmpm: draft.end ? word : draft.endAmpm,
      };
    }
  }
  const attempt = parseDraft(text);
  if (!attempt) {
    const bare = text.trim().match(
      /^(\d{1,2})(?::([0-5]\d))?\s*(?:(?:in the|this)\s+)?(a\.?m\.?|p\.?m\.?|morning|afternoon|evening|tonight)?$/i,
    );
    if (!bare || field === "ampm") return null;
    const clock = { h: Number(bare[1]), m: Number(bare[2] ?? 0) };
    if (clock.h < 1 || clock.h > 12) return null;
    const flag = bare[3] ? ampmWord(bare[3]) : null;
    if (field === "end") return { ...draft, end: clock, endAmpm: flag ?? draft.endAmpm };
    return {
      ...draft,
      start: clock,
      startAmpm: flag ?? draft.startAmpm,
      endAmpm: draft.end ? (flag ?? draft.endAmpm) : draft.endAmpm,
    };
  }
  if (field === "ampm") {
    if (!attempt.startAmpm && !attempt.endAmpm) return null;
    const flag = attempt.startAmpm ?? attempt.endAmpm;
    return {
      ...draft,
      start: attempt.start ?? draft.start,
      end: attempt.end ?? draft.end,
      startAmpm: flag,
      endAmpm: draft.end || attempt.end ? (attempt.endAmpm ?? flag) : draft.endAmpm,
    };
  }
  if (field === "start") {
    if (!attempt.start) return null;
    return {
      ...draft,
      start: attempt.start,
      startAmpm: attempt.startAmpm ?? draft.startAmpm,
      end: attempt.end ?? draft.end,
      endAmpm: attempt.end ? (attempt.endAmpm ?? draft.endAmpm) : draft.endAmpm,
      durationMin: attempt.durationMin ?? draft.durationMin,
    };
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
  return (
    /\bwhat'?s on\b/i.test(text) ||
    /\bschedule\b/i.test(text) ||
    /\bwhat(?:'s| is) on the calendar\b/i.test(text) ||
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
  return best?.activity ?? null;
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
  const match = lower.match(/\bfor\s+(an|a|one|\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)\b/);
  if (!match) return null;
  const qty = match[1] === "an" || match[1] === "a" || match[1] === "one" ? 1 : Number(match[1]);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (match[2].startsWith("h")) return Math.round(qty * 60);
  return Math.round(qty);
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
  const planted = lower.match(/\b(?:planted|planting|sowed|sow)\s+([a-z][a-z ]{1,32}?)(?:\s+in\b|\s+on\b|\s+at\b|\s+for\b|$)/);
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
