import { randomUUID } from "node:crypto";
import { sessionTouchesWeek } from "./calendar";
import { photonDailyLimit, photonReply, sendPhotonText } from "./photon";
import { buildTasks } from "./priority";
import type { Store } from "./store";
import { gardenRain } from "./weather";
import {
  addDays,
  formatClock,
  gardenTz,
  partsInZone,
  startOfWeekYmd,
  todayYmd,
} from "./time";
import type { Bed, Person, Planting, Task, ThreadMessage, WorkSession } from "./types";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type WeekPlanPreview = {
  weekStart: string;
  tasks: Task[];
  plannedSessions: WorkSession[];
  text: string;
  recipients: Array<{ id: string; name: string }>;
};

/** Normalize older stored rows that predate assignee / source fields. */
export function normalizeTask(task: Partial<Task> & Pick<Task, "id" | "type" | "severity" | "title" | "detail" | "due_date">): Task {
  return {
    ...task,
    id: task.id,
    type: task.type,
    severity: task.severity,
    title: task.title,
    detail: task.detail,
    due_date: task.due_date,
    planting_id: task.planting_id ?? null,
    bed_id: task.bed_id ?? null,
    status: task.status ?? "open",
    assignee_id: task.assignee_id ?? null,
    source: task.source ?? "rule",
    rationale: task.rationale || task.detail || "",
  };
}

/** Keep claims / planner status when rule tasks are rebuilt. */
export function mergeTaskState(computed: Task[], saved: Task[]): Task[] {
  const prior = new Map(saved.map((task) => [task.id, normalizeTask(task)]));
  return computed.map((task) => {
    const prev = prior.get(task.id);
    if (!prev) return task;
    if (prev.status === "claimed" && prev.assignee_id) {
      return {
        ...task,
        status: "claimed",
        assignee_id: prev.assignee_id,
        source: prev.source === "planner" ? "planner" : task.source,
        rationale: prev.rationale || task.rationale,
      };
    }
    if (prev.status === "proposed" || prev.status === "approved") {
      return {
        ...task,
        status: prev.status,
        assignee_id: null,
        source: "planner",
        rationale: prev.rationale || task.rationale,
      };
    }
    if (prev.status === "rejected" || prev.status === "done") {
      return {
        ...task,
        status: prev.status,
        assignee_id: prev.assignee_id,
        source: prev.source,
        rationale: prev.rationale || task.rationale,
      };
    }
    return task;
  });
}

export function upcomingPlannedSessions(
  sessions: WorkSession[],
  now: Date,
  weekStart: string,
  timeZone: string,
): WorkSession[] {
  const nowMs = now.getTime();
  return sessions
    .filter((session) => new Date(session.start).getTime() > nowMs)
    .filter((session) => sessionTouchesWeek(session, weekStart, timeZone))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

export function formatWeekPlanText(input: {
  tasks: Task[];
  plannedSessions: WorkSession[];
  people: Person[];
  beds: Bed[];
  plantings: Planting[];
  timeZone: string;
  weekStart: string;
}): string {
  const open = input.tasks.filter((task) => task.status !== "done" && task.status !== "rejected");
  const needs = open.filter((task) => task.status !== "claimed");
  const claimed = open.filter((task) => task.status === "claimed");
  const lines: string[] = [];
  const weekEnd = addDays(input.weekStart, 6);
  lines.push(`Garden plan for next week (${shortDay(input.weekStart)}–${shortDay(weekEnd)}):`);

  if (needs.length) {
    lines.push("Still needed:");
    for (const task of needs.slice(0, 8)) {
      const mark = task.severity === "urgent" ? "!" : task.severity === "upcoming" ? "·" : "·";
      lines.push(`${mark} ${task.title}`);
    }
    if (needs.length > 8) lines.push(`(+${needs.length - 8} more)`);
  } else {
    lines.push("No open priority tasks right now.");
  }

  if (claimed.length) {
    lines.push(`Already claimed: ${claimed.length} task${claimed.length === 1 ? "" : "s"} (first come, first served).`);
  }

  if (input.plannedSessions.length) {
    lines.push("Already on the calendar:");
    for (const session of input.plannedSessions.slice(0, 6)) {
      const who = input.people.find((person) => person.id === session.person_id);
      const start = partsInZone(new Date(session.start), input.timeZone);
      const end = partsInZone(new Date(session.end), input.timeZone);
      const bed = input.beds.find((item) => item.id === session.bed_id);
      const where = bed ? ` · ${bed.name}` : "";
      lines.push(
        `· ${DAY[start.weekday]} ${formatClock(start.hour, start.minute)}–${formatClock(end.hour, end.minute)} ${who?.name ?? "Someone"}${where}: ${session.notes || session.activity_type}`,
      );
    }
    if (input.plannedSessions.length > 6) {
      lines.push(`(+${input.plannedSessions.length - 6} more planned)`);
    }
  }

  lines.push('Reply "I\'ll take watering" (or harvest / fill / meeting, or a bed/crop) to claim one.');
  return lines.join("\n");
}

function shortDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Anyone who has already sent at least one inbound text (simulator or Photon). */
export async function volunteersWhoTexted(store: Store): Promise<Person[]> {
  const people = await store.listPeople();
  const out: Person[] = [];
  for (const person of people) {
    const thread = await store.getThread(person.phone);
    if (thread.some((item) => item.direction === "in")) out.push(person);
  }
  return out;
}

export async function liveTasks(store: Store, now = new Date()): Promise<Task[]> {
  const timeZone = gardenTz();
  const [beds, plantings, sessions, saved] = await Promise.all([
    store.listBeds(),
    store.listPlantings(),
    store.listSessions(),
    store.listTasks(),
  ]);
  return mergeTaskState(buildTasks({ now, beds, plantings, sessions, timeZone, rain: await gardenRain(store) }), saved);
}

/**
 * Rebuild priority from the live garden (same rules as the map), keep only still-valid
 * claims, write that list back so stale task rows disappear from the DB.
 * Also marks active plantings with a missing bed as removed.
 */
export async function reconcilePriorityTasks(store: Store, now = new Date()): Promise<Task[]> {
  const timeZone = gardenTz();
  const today = todayYmd(now, timeZone);
  const [beds, plantings, sessions, saved] = await Promise.all([
    store.listBeds(),
    store.listPlantings(),
    store.listSessions(),
    store.listTasks(),
  ]);

  const bedIds = new Set(beds.map((bed) => bed.id));
  for (const planting of plantings) {
    if (planting.removed_date) continue;
    if (planting.planted_date > today) continue;
    if (bedIds.has(planting.bed_id)) continue;
    // Bed was deleted; stop counting it as in-ground.
    await store.updatePlanting({ ...planting, removed_date: today });
  }

  const cleanedPlantings = await store.listPlantings();
  const computed = buildTasks({ now, beds, plantings: cleanedPlantings, sessions, timeZone, rain: await gardenRain(store) });
  const tasks = mergeTaskState(computed, saved).filter((task) => task.status !== "done" && task.status !== "rejected");
  await store.saveTasks(tasks);
  return tasks;
}

/** Always the Sunday after this week's Sunday — even if today is already Sunday. */
export function nextWeekStartYmd(now: Date, timeZone = gardenTz()): string {
  return addDays(startOfWeekYmd(now, timeZone), 7);
}

export async function proposeWeekPlan(store: Store, now = new Date()): Promise<WeekPlanPreview> {
  const timeZone = gardenTz();
  const weekStart = nextWeekStartYmd(now, timeZone);
  const [beds, plantings, sessions, people, saved] = await Promise.all([
    store.listBeds(),
    store.listPlantings(),
    store.listSessions(),
    store.listPeople(),
    store.listTasks(),
  ]);
  const merged = mergeTaskState(buildTasks({ now, beds, plantings, sessions, timeZone, rain: await gardenRain(store) }), saved);
  const tasks = merged.map((task) => {
    if (task.status === "claimed" && task.assignee_id) return { ...task, source: "planner" as const };
    return {
      ...task,
      status: "proposed" as const,
      assignee_id: null,
      source: "planner" as const,
      rationale: task.rationale || task.detail,
    };
  });
  await store.saveTasks(tasks);
  const plannedSessions = upcomingPlannedSessions(sessions, now, weekStart, timeZone);
  const recipients = await volunteersWhoTexted(store);
  const text = formatWeekPlanText({ tasks, plannedSessions, people, beds, plantings, timeZone, weekStart });
  return {
    weekStart,
    tasks,
    plannedSessions,
    text,
    recipients: recipients.map((person) => ({ id: person.id, name: person.name })),
  };
}

export async function approveAndSendPlan(store: Store, now = new Date()): Promise<WeekPlanPreview & { sent: number }> {
  const preview = await proposeWeekPlan(store, now);
  const tasks = preview.tasks.map((task) =>
    task.status === "claimed" ? task : { ...task, status: "approved" as const },
  );
  await store.saveTasks(tasks);

  const people = await volunteersWhoTexted(store);
  const text = formatWeekPlanText({
    tasks,
    plannedSessions: preview.plannedSessions,
    people: await store.listPeople(),
    beds: await store.listBeds(),
    plantings: await store.listPlantings(),
    timeZone: gardenTz(),
    weekStart: preview.weekStart,
  });

  let sent = 0;
  for (const person of people) {
    const ok = await deliverPlannerText(store, person, text, now);
    if (ok) sent += 1;
  }

  return {
    ...preview,
    tasks,
    text,
    recipients: people.map((person) => ({ id: person.id, name: person.name })),
    sent,
  };
}

async function deliverPlannerText(store: Store, person: Person, text: string, now: Date): Promise<boolean> {
  const today = todayYmd(now, person.timezone);
  const conversation = await store.getConversation(person.phone);
  let count = conversation.sentToday?.day === today ? conversation.sentToday.count : 0;
  const reply = photonReply([text], count, photonDailyLimit());
  if (!reply) return false;

  await store.appendThread(person.phone, threadMessage("out", reply, now));

  const apiKey = process.env.PHOTON_API_KEY;
  const projectId = process.env.PHOTON_PROJECT_ID;
  if (apiKey && projectId && conversation.photon) {
    try {
      await sendPhotonText({
        apiKey,
        projectId,
        spaceId: conversation.photon.spaceId,
        senderId: conversation.photon.agentId,
        text: reply,
        idempotencyKey: `plan-${today}-${person.id}`,
      });
    } catch (error) {
      console.warn("Planner Photon send failed:", error instanceof Error ? error.message : error);
    }
  }

  await store.saveConversation(person.phone, {
    ...conversation,
    sentToday: { day: today, count: count + 1 },
  });
  return true;
}

function threadMessage(direction: "in" | "out", text: string, now: Date): ThreadMessage {
  return { id: randomUUID(), direction, text, at: now.toISOString(), imageUrl: null };
}

export function isClaimIntent(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (!lower) return false;
  if (/^(claim|i'?ll take|i will take|i can take|ill take|i'?ll do|i will do|i can do|assign me|put me on|i'?ll cover|i will cover)\b/.test(lower)) {
    return true;
  }
  return (
    /\b(i'?ll take|i can take|ill take|claim)\b/.test(lower) &&
    /\b(water|harvest|fill|meeting|task|watering|row|bed|plot|space|pea|peas)\b/.test(lower)
  );
}

export function claimHint(text: string): string {
  return text
    .trim()
    .replace(
      /^(claim|i'?ll take|i will take|i can take|ill take|i'?ll do|i will do|i can do|assign me|put me on|i'?ll cover|i will cover)\b[:\s-]*/i,
      "",
    )
    .trim();
}

export function isOpenTasksQuery(text: string): boolean {
  const lower = text.trim().toLowerCase();
  return (
    /\b(what('?s| is) (still )?open|what can i claim|what needs (doing|a volunteer)|open tasks|unclaimed)\b/.test(lower) ||
    /^(what('?s| is) (still )?needed\??)$/.test(lower)
  );
}

export function matchClaimTask(
  hint: string,
  tasks: Task[],
  beds: Bed[],
  plantings: Planting[],
): { task: Task | null; ambiguous: Task[] } {
  const claimable = tasks.filter(
    (task) => task.status === "open" || task.status === "proposed" || task.status === "approved" || task.status === "claimed",
  );
  const needle = hint.toLowerCase().trim();

  if (!needle) {
    const free = claimable.filter((task) => task.status !== "claimed");
    if (free.length === 1) return { task: free[0], ambiguous: [] };
    return { task: null, ambiguous: free };
  }

  const scored = claimable
    .map((task) => ({ task, score: scoreClaim(needle, task, beds, plantings) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { task: null, ambiguous: [] };
  const best = scored[0].score;
  const top = scored.filter((item) => item.score === best).map((item) => item.task);
  if (top.length === 1) return { task: top[0], ambiguous: [] };
  return { task: null, ambiguous: top };
}

function scoreClaim(needle: string, task: Task, beds: Bed[], plantings: Planting[]): number {
  let score = 0;
  const title = task.title.toLowerCase();
  const bed = beds.find((item) => item.id === task.bed_id);
  const planting = plantings.find((item) => item.id === task.planting_id);
  const hay = [title, task.type, task.detail, bed?.name, planting?.crop].filter(Boolean).join(" ").toLowerCase();

  if (needle.includes(task.type) || (task.type === "water" && /\bwater/.test(needle))) score += 3;
  if (task.type === "harvest" && /\bharvest/.test(needle)) score += 3;
  if (task.type === "fill" && /\bfill|empty|space/.test(needle)) score += 3;
  if (task.type === "meeting" && /\bmeeting/.test(needle)) score += 3;

  if (planting) {
    const crop = planting.crop.toLowerCase();
    if (needle.includes(crop) || softIncludes(needle, crop) || softIncludes(crop, needle)) score += 4;
  }
  if (bed) {
    const bedLower = bed.name.toLowerCase();
    if (needle.includes(bedLower)) score += 4;
    const row = bedLower.match(/\b(?:row|plot|space)\s*([a-z0-9]+)\b/i);
    if (row && new RegExp(`\\b(?:row|plot|space)\\s*${row[1]}\\b`, "i").test(needle)) score += 4;
  }

  for (const word of needle.split(/\s+/).filter((w) => w.length > 2)) {
    if (hay.includes(word) || softIncludes(hay, word)) score += 1;
  }
  if (title.includes(needle) || hay.includes(needle)) score += 2;
  return score;
}

/** pea ↔ peas, carrot ↔ carrots */
function softIncludes(hay: string, needle: string): boolean {
  if (!needle || needle.length < 3) return false;
  if (hay.includes(needle)) return true;
  if (needle.endsWith("s") && hay.includes(needle.slice(0, -1))) return true;
  if (!needle.endsWith("s") && hay.includes(`${needle}s`)) return true;
  return false;
}

export function openTasksReply(tasks: Task[]): string {
  const free = tasks.filter(
    (task) => task.status === "open" || task.status === "proposed" || task.status === "approved",
  );
  if (free.length === 0) return "Nothing is open to claim right now.";
  return `Still open: ${free.map((task) => task.title).join("; ")}. Reply "I'll take …" to claim one.`;
}

export const ALREADY_CLAIMED_REPLY =
  "Someone already claimed that one. Text what's still open, or claim a different task.";
