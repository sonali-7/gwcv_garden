import { addDays, partsInZone, ymd, zonedToUtc } from "./time";
import type { WorkSession } from "./types";

export const HOUR_PX = 46;
export const DAY_START = 7;
export const DAY_END = 19;

export type DaySlice = {
  sessionId: string;
  day: string;
  topPx: number;
  heightPx: number;
  startMin: number;
  endMin: number;
};

export function slicesForSession(
  session: WorkSession,
  weekStart: string,
  timeZone: string,
  hourPx = HOUR_PX,
): DaySlice[] {
  const slices: DaySlice[] = [];
  const start = new Date(session.start);
  const end = new Date(session.end);
  for (let index = 0; index < 7; index += 1) {
    const day = addDays(weekStart, index);
    const dayStart = zonedToUtc(day, DAY_START, 0, timeZone);
    const dayEnd = zonedToUtc(day, DAY_END, 0, timeZone);
    const clipStart = start > dayStart ? start : dayStart;
    const clipEnd = end < dayEnd ? end : dayEnd;
    if (clipEnd.getTime() - clipStart.getTime() < 60_000) continue;
    const startMin = Math.round((clipStart.getTime() - dayStart.getTime()) / 60_000);
    const endMin = Math.round((clipEnd.getTime() - dayStart.getTime()) / 60_000);
    slices.push({
      sessionId: session.id,
      day,
      topPx: (startMin / 60) * hourPx,
      heightPx: Math.max(((endMin - startMin) / 60) * hourPx, 22),
      startMin,
      endMin,
    });
  }
  return slices;
}

export type PlacedSlice = DaySlice & { lane: number; lanes: number };

export function placeSlices(slices: DaySlice[]): PlacedSlice[] {
  const byDay = new Map<string, DaySlice[]>();
  for (const slice of slices) {
    const list = byDay.get(slice.day) ?? [];
    list.push(slice);
    byDay.set(slice.day, list);
  }
  const placed: PlacedSlice[] = [];
  for (const list of byDay.values()) {
    const sorted = [...list].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
    const laneEnds: number[] = [];
    const draft = sorted.map((slice) => {
      let lane = laneEnds.findIndex((end) => end <= slice.startMin);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(slice.endMin);
      } else {
        laneEnds[lane] = slice.endMin;
      }
      return { ...slice, lane };
    });
    const lanes = Math.max(1, laneEnds.length);
    for (const slice of draft) placed.push({ ...slice, lanes });
  }
  return placed;
}

export function sessionTouchesWeek(session: WorkSession, weekStart: string, timeZone: string): boolean {
  const start = new Date(session.start);
  const end = new Date(session.end);
  const weekBegin = zonedToUtc(weekStart, 0, 0, timeZone);
  const weekEnd = zonedToUtc(addDays(weekStart, 7), 0, 0, timeZone);
  return start < weekEnd && end > weekBegin;
}

export function outsideDayGrid(session: WorkSession, weekStart: string, timeZone: string): boolean {
  if (!sessionTouchesWeek(session, weekStart, timeZone)) return false;
  return slicesForSession(session, weekStart, timeZone).length === 0;
}

export function hourLabel(hour: number): string {
  if (hour === 0 || hour === 24) return "12";
  if (hour > 12) return String(hour - 12);
  return String(hour);
}

export function dayNumber(dateYmd: string): number {
  return Number(dateYmd.slice(-2));
}

export function isSameDay(date: Date, dateYmd: string, timeZone: string): boolean {
  const parts = partsInZone(date, timeZone);
  return ymd(parts) === dateYmd;
}
