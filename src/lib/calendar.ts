import { addDays, partsInZone, ymd, zonedToUtc } from "./time";
import type { WorkSession } from "./types";

export const HOUR_PX = 46;
/** Full day on the grid; the viewports starts scrolled to VIEW_START. */
export const DAY_START = 0;
export const DAY_END = 24;
/** Hours shown without scrolling (7am–7pm). */
export const VIEW_START = 6.75;
export const VIEW_HOURS = 12.5;

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
    let group: Array<DaySlice & { lane: number }> = [];
    let laneEnds: number[] = [];
    let groupEnd = -1;
    const flush = () => {
      const lanes = Math.max(1, laneEnds.length);
      for (const slice of group) placed.push({ ...slice, lanes });
      group = [];
      laneEnds = [];
    };
    for (const slice of sorted) {
      if (group.length > 0 && slice.startMin >= groupEnd) flush();
      let lane = laneEnds.findIndex((end) => end <= slice.startMin);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(slice.endMin);
      } else {
        laneEnds[lane] = slice.endMin;
      }
      group.push({ ...slice, lane });
      groupEnd = group.length === 1 ? slice.endMin : Math.max(groupEnd, slice.endMin);
    }
    if (group.length > 0) flush();
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

export type SessionStatus = "done" | "now" | "planned";

export function sessionStatus(session: Pick<WorkSession, "start" | "end">, now: Date): SessionStatus {
  const time = now.getTime();
  if (new Date(session.end).getTime() <= time) return "done";
  if (new Date(session.start).getTime() <= time) return "now";
  return "planned";
}

export const STATUS_LABEL: Record<SessionStatus, string> = {
  done: "Done",
  now: "Happening now",
  planned: "Planned",
};

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
