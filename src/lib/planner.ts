import { randomUUID } from "node:crypto";
import { sessionTouchesWeek } from "./calendar";
import { buildPersonalTexts, runPlanAgent, type PersonalPlanText, type PlanAssignment } from "./plan-agent";
import { photonDailyLimit, photonReply, sendPhotonText } from "./photon";
import { buildTasks } from "./priority";
import type { Store } from "./store";
import {
  addDays,
  gardenTz,
  startOfWeekYmd,
  todayYmd,
} from "./time";
import type { Bed, Person, Planting, Task, ThreadMessage, WorkSession } from "./types";

export type WeekPlanPreview = {
  weekStart: string;
  tasks: Task[];
  plannedSessions: WorkSession[];
  recipients: Array<{ id: string; name: string }>;
  personalTexts: PersonalPlanText[];
  agentSource: "agent" | "fallback" | "timeout" | "error" | "no_key";
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
    suggested_assignee_id: task.suggested_assignee_id ?? null,
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
        suggested_assignee_id: null,
        source: prev.source === "planner" ? "planner" : task.source,
        rationale: prev.rationale || task.rationale,
      };
    }
    if (prev.status === "proposed" || prev.status === "approved") {
      return {
        ...task,
        status: prev.status,
        assignee_id: null,
        suggested_assignee_id: prev.suggested_assignee_id ?? null,
        source: "planner",
        rationale: prev.rationale || task.rationale,
      };
    }
    if (prev.status === "rejected" || prev.status === "done") {
      return {
        ...task,
        status: prev.status,
        assignee_id: prev.assignee_id,
        suggested_assignee_id: prev.suggested_assignee_id ?? null,
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
  return mergeTaskState(buildTasks({ now, beds, plantings, sessions, timeZone }), saved);
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
  const computed = buildTasks({ now, beds, plantings: cleanedPlantings, sessions, timeZone });
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
  const weekEnd = addDays(weekStart, 6);
  const [beds, plantings, sessions, people, saved] = await Promise.all([
    store.listBeds(),
    store.listPlantings(),
    store.listSessions(),
    store.listPeople(),
    store.listTasks(),
  ]);
  const merged = mergeTaskState(buildTasks({ now, beds, plantings, sessions, timeZone }), saved);
  const baseTasks = merged.map((task) => {
    if (task.status === "claimed" && task.assignee_id) {
      return { ...task, source: "planner" as const, suggested_assignee_id: null };
    }
    return {
      ...task,
      status: "proposed" as const,
      assignee_id: null,
      suggested_assignee_id: null,
      source: "planner" as const,
      rationale: task.rationale || task.detail,
    };
  });

  const plannedSessions = upcomingPlannedSessions(sessions, now, weekStart, timeZone);
  const visitorIds = new Set(plannedSessions.map((session) => session.person_id));
  const visitors = people.filter((person) => visitorIds.has(person.id));
  // Targeted texts only go to people already on next week's calendar who have texted in.
  // (Everyone who ever texted used to get the same "still open" blast — that felt identical.)
  const texted = await volunteersWhoTexted(store);
  const recipients = visitors.filter((person) => texted.some((item) => item.id === person.id));

  const agent = await runPlanAgent({
    weekStart,
    weekEnd,
    timeZone,
    tasks: baseTasks,
    visitors,
    sessions: plannedSessions,
    beds,
    plantings,
    recipients,
  });

  const tasks = applySuggestions(baseTasks, agent.assignments, people);
  await store.saveTasks(tasks);
  return {
    weekStart,
    tasks,
    plannedSessions,
    recipients: recipients.map((person) => ({ id: person.id, name: person.name })),
    personalTexts: agent.personalTexts,
    agentSource: agent.source,
  };
}

/** Approve the latest proposed plan and send each volunteer their personal text (not one shared blast). */
export async function approveAndSendPlan(store: Store, now = new Date()): Promise<WeekPlanPreview & { sent: number }> {
  const timeZone = gardenTz();
  const weekStart = nextWeekStartYmd(now, timeZone);
  const [beds, plantings, sessions, people, saved] = await Promise.all([
    store.listBeds(),
    store.listPlantings(),
    store.listSessions(),
    store.listPeople(),
    store.listTasks(),
  ]);
  const merged = mergeTaskState(buildTasks({ now, beds, plantings, sessions, timeZone }), saved);
  const hasProposal = merged.some((task) => task.status === "proposed" || task.status === "approved" || task.suggested_assignee_id);
  const preview = hasProposal
    ? null
    : await proposeWeekPlan(store, now);

  const live = preview?.tasks ?? merged;
  const tasks = live.map((task) => (task.status === "claimed" ? task : { ...task, status: "approved" as const }));
  await store.saveTasks(tasks);

  const plannedSessions = preview?.plannedSessions ?? upcomingPlannedSessions(sessions, now, weekStart, timeZone);
  const visitorIds = new Set(plannedSessions.map((session) => session.person_id));
  const visitors = people.filter((person) => visitorIds.has(person.id));
  const texted = await volunteersWhoTexted(store);
  const recipients = preview
    ? preview.recipients
        .map((item) => people.find((person) => person.id === item.id))
        .filter((person): person is Person => Boolean(person))
    : visitors.filter((person) => texted.some((item) => item.id === person.id));

  const assignments: PlanAssignment[] = tasks
    .filter((task) => task.suggested_assignee_id)
    .map((task) => ({
      taskId: task.id,
      personId: task.suggested_assignee_id!,
      reason: task.rationale || "",
    }));

  const personalTexts =
    preview?.personalTexts?.length
      ? preview.personalTexts
      : buildPersonalTexts(
          {
            weekStart,
            weekEnd: addDays(weekStart, 6),
            timeZone,
            tasks,
            visitors,
            sessions: plannedSessions,
            beds,
            plantings,
            recipients,
          },
          assignments,
        );

  // Never fall back to a shared organizer summary — that made every thread look identical.
  const byPerson = new Map(personalTexts.map((item) => [item.personId, item.text]));
  let sent = 0;
  for (const person of recipients) {
    const body = byPerson.get(person.id);
    if (!body) continue;
    const ok = await deliverPlannerText(store, person, body, now);
    if (ok) sent += 1;
  }

  return {
    weekStart,
    tasks,
    plannedSessions,
    recipients: recipients.map((person) => ({ id: person.id, name: person.name })),
    personalTexts,
    agentSource: preview?.agentSource ?? "fallback",
    sent,
  };
}

function applySuggestions(tasks: Task[], assignments: PlanAssignment[], people: Person[]): Task[] {
  const byTask = new Map(assignments.map((item) => [item.taskId, item]));
  return tasks.map((task) => {
    if (task.status === "claimed") return task;
    const hit = byTask.get(task.id);
    if (!hit) return { ...task, suggested_assignee_id: null };
    const who = people.find((person) => person.id === hit.personId);
    const reason = hit.reason || (who ? `Suggested for ${who.name}` : "Suggested from next week's calendar");
    return {
      ...task,
      suggested_assignee_id: hit.personId,
      rationale: reason,
    };
  });
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
