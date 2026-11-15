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
import { lastSoaking, soakingTomorrow, type Rain } from "./weather";

export const WATER_AFTER_DAYS = 3;
export const HARVEST_WINDOW_DAYS = 21;

export function buildTasks(input: {
  now: Date;
  beds: Bed[];
  plantings: Planting[];
  sessions: WorkSession[];
  timeZone?: string;
  /**
   * Rain near the garden (see weather.ts), when known. A soaking counts as a watering, and a soaking due tomorrow
   * means watering can wait. Without it, watering goes by logged sessions only.
   */
  rain?: Rain | null;
}): Task[] {
  const timeZone = input.timeZone ?? gardenTz();
  const today = todayYmd(input.now, timeZone);
  const tasks: Task[] = [];
  // Same beds the garden map shows — skip archived / missing so priority can't drift.
  const liveBeds = input.beds.filter((bed) => !bed.archived);
  const liveBedIds = new Set(liveBeds.map((bed) => bed.id));
  const active = activePlantings(input.plantings, today).filter((planting) => liveBedIds.has(planting.bed_id));
  const soaked = input.rain ? lastSoaking(input.rain, today) : null;
  const rainDays = soaked ? calendarDaysBetween(soaked.date, today) : null;
  const rainComing = input.rain ? soakingTomorrow(input.rain, addDays(today, 1)) : null;

  for (const planting of active) {
    const bed = liveBeds.find((item) => item.id === planting.bed_id) ?? null;
    const waters = input.sessions
      .filter((session) => {
        if (session.activity_type !== "water") return false;
        if (new Date(session.end).getTime() > input.now.getTime()) return false;
        return session.planting_id === planting.id || session.bed_id === planting.bed_id;
      })
      .sort((a, b) => new Date(a.end).getTime() - new Date(b.end).getTime());
    const last = waters.at(-1);
    const days = last ? calendarDaysBetween(todayYmd(new Date(last.end), timeZone), today) : null;
    // Rain since the last logged watering counts too; rain due tomorrow means it can wait.
    const sinceWater = rainDays !== null && (days === null || rainDays < days) ? rainDays : days;
    if ((sinceWater === null || sinceWater >= WATER_AFTER_DAYS) && !rainComing) {
      const logged =
        days === null ? "No watering has been logged for this planting." : `Last watered ${days === 1 ? "1 day" : `${days} days`} ago.`;
      const detail = input.rain
        ? `${logged} ${soaked ? `Last good rain ${rainDays === 0 ? "today" : rainDays === 1 ? "yesterday" : `${rainDays} days ago`} (${Math.round(soaked.mm)} mm).` : "No good rain this past week."}`
        : logged;
      tasks.push({
        id: `water:${planting.id}`,
        type: "water",
        severity: "urgent",
        title: `${cropTitle(planting.crop)} needs watering`,
        detail,
        due_date: input.now.toISOString(),
        planting_id: planting.id,
        bed_id: planting.bed_id,
        status: "open",
        assignee_id: null,
        source: "rule",
        rationale: detail,
      });
    }

    const until = calendarDaysBetween(today, planting.expected_harvest_date);
    if (until >= 0 && until <= HARVEST_WINDOW_DAYS) {
      const detail = `Ready around ${monthDayLabel(planting.expected_harvest_date)}. Planted ${monthDayLabel(planting.planted_date)}.`;
      tasks.push({
        id: `harvest:${planting.id}`,
        type: "harvest",
        severity: "upcoming",
        title: harvestTitle(planting.crop, until),
        detail,
        due_date: zonedToUtc(planting.expected_harvest_date, 9, 0, timeZone).toISOString(),
        planting_id: planting.id,
        bed_id: planting.bed_id,
        status: "open",
        assignee_id: null,
        source: "rule",
        rationale: detail,
      });
    }
  }

  for (const bed of liveBeds) {
    if (active.some((planting) => planting.bed_id === bed.id)) continue;
    const planned = input.plantings.find(
      (planting) => planting.bed_id === bed.id && planting.planted_date > today && !planting.removed_date,
    );
    if (planned) continue;
    const detail = `${bed.name} has no crop in the ground.`;
    tasks.push({
      id: `fill:${bed.id}`,
      type: "fill",
      severity: "routine",
      title: `Fill ${bed.name.charAt(0).toLowerCase()}${bed.name.slice(1)}`,
      detail,
      due_date: input.now.toISOString(),
      planting_id: null,
      bed_id: bed.id,
      status: "open",
      assignee_id: null,
      source: "rule",
      rationale: detail,
    });
  }

  const meeting = nextMeeting(input.now, timeZone);
  const meetingDay = ymd(partsInZone(meeting, timeZone));
  const todayStart = zonedToUtc(today, 0, 0, timeZone).getTime();
  const meetingEnd = meeting.getTime() + 2 * 60 * 60_000;
  const alreadyMet = input.sessions.some((session) => {
    if (session.activity_type !== "meeting") return false;
    const start = new Date(session.start).getTime();
    // Logged/scheduled for the meeting day, or any upcoming meeting plan this week.
    if (todayYmd(new Date(session.start), timeZone) === meetingDay) return true;
    return start >= todayStart && start <= meetingEnd;
  });
  if (!alreadyMet) {
    const detail = "Saturday 10:00am. Standing work meeting for the garden.";
    tasks.push({
      id: `meeting:${meetingDay}`,
      type: "meeting",
      severity: "routine",
      title: "Weekly meeting",
      detail,
      due_date: meeting.toISOString(),
      planting_id: null,
      bed_id: null,
      status: "open",
      assignee_id: null,
      source: "rule",
      rationale: detail,
    });
  }

  const severityRank = { urgent: 0, upcoming: 1, routine: 2 };
  const typeRank = { water: 0, harvest: 1, fill: 2, meeting: 3 };
  const unique = [...new Map(tasks.map((task) => [task.id, task])).values()];
  return unique.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || typeRank[a.type] - typeRank[b.type]);
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
