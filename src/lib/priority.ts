import { activePlantings } from "./plantings";
import { cropTitle } from "./phrases";
import {
  addDays,
  calendarDaysBetween,
  gardenTz,
  partsInZone,
  todayYmd,
  ymd,
  zonedToUtc,
} from "./time";
import type { Bed, Planting, Task, WorkSession } from "./types";

export const WATER_AFTER_DAYS = 3;
export const HARVEST_WINDOW_DAYS = 21;

export function buildTasks(input: {
  now: Date;
  beds: Bed[];
  plantings: Planting[];
  sessions: WorkSession[];
  timeZone?: string;
}): Task[] {
  const timeZone = input.timeZone ?? gardenTz();
  const today = todayYmd(input.now, timeZone);
  const tasks: Task[] = [];
  const active = activePlantings(input.plantings, today);

  for (const planting of active) {
    const bed = input.beds.find((item) => item.id === planting.bed_id) ?? null;
    const waters = input.sessions
      .filter((session) => {
        if (session.activity_type !== "water") return false;
        if (new Date(session.end).getTime() > input.now.getTime()) return false;
        return session.planting_id === planting.id || session.bed_id === planting.bed_id;
      })
      .sort((a, b) => new Date(a.end).getTime() - new Date(b.end).getTime());
    const last = waters.at(-1);
    const days = last ? calendarDaysBetween(todayYmd(new Date(last.end), timeZone), today) : null;
    if (days === null || days >= WATER_AFTER_DAYS) {
      tasks.push({
        id: `water:${planting.id}`,
        type: "water",
        severity: "urgent",
        title: `${cropTitle(planting.crop)} needs watering`,
        detail:
          days === null
            ? "No watering has been logged for this planting."
            : `Last watered ${days === 1 ? "1 day" : `${days} days`} ago.`,
        due_date: input.now.toISOString(),
        planting_id: planting.id,
        bed_id: planting.bed_id,
        status: "open",
      });
    }

    const until = calendarDaysBetween(today, planting.expected_harvest_date);
    if (until >= 0 && until <= HARVEST_WINDOW_DAYS) {
      tasks.push({
        id: `harvest:${planting.id}`,
        type: "harvest",
        severity: "upcoming",
        title: harvestTitle(planting.crop, until),
        detail: `Ready around ${monthDayLabel(planting.expected_harvest_date)}. Planted ${monthDayLabel(planting.planted_date)}.`,
        due_date: zonedToUtc(planting.expected_harvest_date, 9, 0, timeZone).toISOString(),
        planting_id: planting.id,
        bed_id: planting.bed_id,
        status: "open",
      });
    }
  }

  for (const bed of input.beds.filter((b) => !b.archived)) {
    if (active.some((planting) => planting.bed_id === bed.id)) continue;
    const planned = input.plantings.find(
      (planting) => planting.bed_id === bed.id && planting.planted_date > today && !planting.removed_date,
    );
    if (planned) continue;
    tasks.push({
      id: `fill:${bed.id}`,
      type: "fill",
      severity: "routine",
      title: `Fill ${bed.name.charAt(0).toLowerCase()}${bed.name.slice(1)}`,
      detail: `${bed.name} has no crop in the ground.`,
      due_date: input.now.toISOString(),
      planting_id: null,
      bed_id: bed.id,
      status: "open",
    });
  }

  const meeting = nextMeeting(input.now, timeZone);
  const meetingDay = ymd(partsInZone(meeting, timeZone));
  const alreadyMet = input.sessions.some((session) => {
    if (session.activity_type !== "meeting") return false;
    return todayYmd(new Date(session.start), timeZone) === meetingDay;
  });
  if (!alreadyMet) {
    tasks.push({
      id: `meeting:${meetingDay}`,
      type: "meeting",
      severity: "routine",
      title: "Weekly meeting",
      detail: "Saturday 10:00am. Standing work meeting for the garden.",
      due_date: meeting.toISOString(),
      planting_id: null,
      bed_id: null,
      status: "open",
    });
  }

  const severityRank = { urgent: 0, upcoming: 1, routine: 2 };
  const typeRank = { water: 0, harvest: 1, fill: 2, meeting: 3 };
  return tasks.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || typeRank[a.type] - typeRank[b.type]);
}

function harvestTitle(crop: string, days: number): string {
  const name = crop.toLowerCase();
  if (days === 0) return `Harvest ${name} today`;
  if (days === 1) return `1 day to harvest for ${name}`;
  if (days === 7) return `1 week to harvest for ${name}`;
  if (days % 7 === 0) return `${days / 7} weeks to harvest for ${name}`;
  return `${days} days to harvest for ${name}`;
}

function monthDayLabel(dateYmd: string): string {
  return new Date(`${dateYmd}T12:00:00Z`).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function nextMeeting(now: Date, timeZone: string): Date {
  const parts = partsInZone(now, timeZone);
  const today = ymd(parts);
  let delta = (6 - parts.weekday + 7) % 7;
  if (delta === 0 && (parts.hour > 10 || (parts.hour === 10 && parts.minute > 30))) delta = 7;
  return zonedToUtc(addDays(today, delta), 10, 0, timeZone);
}
