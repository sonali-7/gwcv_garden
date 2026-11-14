export const DEFAULT_TZ = "America/New_York";

export function gardenTz(): string {
  return process.env.GARDEN_TZ || DEFAULT_TZ;
}

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function partsInZone(date: Date, timeZone = DEFAULT_TZ): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  const weekday = WEEKDAYS.indexOf(map.weekday);
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    weekday: weekday < 0 ? 0 : weekday,
  };
}

export function ymd(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function todayYmd(date: Date, timeZone = DEFAULT_TZ): string {
  return ymd(partsInZone(date, timeZone));
}

export function addDays(ymdStr: string, days: number): string {
  const [year, month, day] = ymdStr.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return utc.toISOString().slice(0, 10);
}

export function calendarDaysBetween(fromYmd: string, toYmd: string): number {
  const [y1, m1, d1] = fromYmd.split("-").map(Number);
  const [y2, m2, d2] = toYmd.split("-").map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86_400_000);
}

export function startOfWeekYmd(date: Date, timeZone = DEFAULT_TZ): string {
  const parts = partsInZone(date, timeZone);
  return addDays(ymd(parts), -parts.weekday);
}

export function zonedToUtc(
  dateYmd: string,
  hour: number,
  minute: number,
  timeZone = DEFAULT_TZ,
): Date {
  const [year, month, day] = dateYmd.split("-").map(Number);
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 4; i += 1) {
    const got = partsInZone(new Date(utc), timeZone);
    const gotAsUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, 0);
    const want = Date.UTC(year, month - 1, day, hour, minute, 0);
    const delta = want - gotAsUtc;
    utc += delta;
    if (delta === 0) break;
  }
  return new Date(utc);
}

export function formatClock(hour24: number, minute: number): string {
  const suffix = hour24 >= 12 ? "pm" : "am";
  let hour = hour24 % 12;
  if (hour === 0) hour = 12;
  if (minute === 0) return `${hour}${suffix}`;
  return `${hour}:${String(minute).padStart(2, "0")}${suffix}`;
}

export function to24(hour: number, ampm: "am" | "pm"): number {
  if (hour > 12) return hour;
  if (ampm === "am") return hour === 12 ? 0 : hour;
  return hour === 12 ? 12 : hour + 12;
}

export function formatWeekTitle(weekStart: string): string {
  const end = addDays(weekStart, 6);
  const startDate = new Date(`${weekStart}T12:00:00Z`);
  const endDate = new Date(`${end}T12:00:00Z`);
  const startMonth = startDate.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const endMonth = endDate.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const startDay = startDate.getUTCDate();
  const endDay = endDate.getUTCDate();
  const year = endDate.getUTCFullYear();
  if (startMonth === endMonth) return `${startMonth} ${startDay}–${endDay}, ${year}`;
  return `${startMonth} ${startDay} – ${endMonth} ${endDay}, ${year}`;
}

export function weekdayShort(dateYmd: string): string {
  const date = new Date(`${dateYmd}T12:00:00Z`);
  return date.toLocaleString("en-US", { weekday: "short", timeZone: "UTC" });
}

export function monthDay(dateYmd: string): string {
  const date = new Date(`${dateYmd}T12:00:00Z`);
  return date.toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function whenPhrase(start: Date, end: Date, now: Date, timeZone = DEFAULT_TZ): string {
  const startParts = partsInZone(start, timeZone);
  const endParts = partsInZone(end, timeZone);
  const startDay = ymd(startParts);
  const endDay = ymd(endParts);
  const today = todayYmd(now, timeZone);
  const startClock = formatClock(startParts.hour, startParts.minute);
  const endClock = formatClock(endParts.hour, endParts.minute);
  if (startDay === endDay) {
    const clock = `${startClock}–${endClock}`;
    if (startDay === today) return `today ${clock}`;
    return `${DAY_NAMES[startParts.weekday]} ${startParts.month}/${startParts.day}, ${clock}`;
  }
  return `${DAY_NAMES[startParts.weekday]} ${startClock} – ${DAY_NAMES[endParts.weekday]} ${endClock}`;
}

export function detailWhen(start: Date, end: Date, timeZone = DEFAULT_TZ): string {
  const startParts = partsInZone(start, timeZone);
  const endParts = partsInZone(end, timeZone);
  const startLabel = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(start);
  const clocks = `${formatClock(startParts.hour, startParts.minute)}–${formatClock(endParts.hour, endParts.minute)}`;
  if (ymd(startParts) === ymd(endParts)) return `${startLabel} · ${clocks}`;
  const endLabel = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(end);
  return `${startLabel} ${formatClock(startParts.hour, startParts.minute)} – ${endLabel} ${formatClock(endParts.hour, endParts.minute)}`;
}
