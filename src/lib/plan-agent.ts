import { tool } from "langchain";
import { z } from "zod";
import { formatClock, partsInZone } from "./time";
import type { Bed, Person, Planting, Task, WorkSession } from "./types";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type PlanAssignment = {
  taskId: string;
  personId: string;
  reason: string;
};

export type PersonalPlanText = {
  personId: string;
  name: string;
  text: string;
};

export type PlanAgentSource = "agent" | "fallback" | "timeout" | "error" | "no_key";

export type PlanAgentResult = {
  assignments: PlanAssignment[];
  personalTexts: PersonalPlanText[];
  source: PlanAgentSource;
};

export type PlanSnapshot = {
  weekStart: string;
  weekEnd: string;
  timeZone: string;
  tasks: Task[];
  visitors: Person[];
  sessions: WorkSession[];
  beds: Bed[];
  plantings: Planting[];
  recipients: Person[];
};

const AGENT_TIMEOUT_MS = 45_000;

/** Deterministic suggestions: prefer same bed, then lightest load among next-week visitors. */
export function fallbackAssign(snapshot: PlanSnapshot): PlanAssignment[] {
  const open = snapshot.tasks.filter((task) => task.status !== "claimed" && task.status !== "done" && task.status !== "rejected");
  if (!snapshot.visitors.length || !open.length) return [];

  const load = new Map(snapshot.visitors.map((person) => [person.id, 0]));
  const byPerson = new Map<string, WorkSession[]>();
  for (const session of snapshot.sessions) {
    const list = byPerson.get(session.person_id) ?? [];
    list.push(session);
    byPerson.set(session.person_id, list);
  }

  const assignments: PlanAssignment[] = [];
  const used = new Set<string>();

  for (const task of open) {
    const candidates = snapshot.visitors
      .map((person) => {
        const sessions = byPerson.get(person.id) ?? [];
        const sameBed = task.bed_id ? sessions.some((session) => session.bed_id === task.bed_id) : false;
        const samePlanting = task.planting_id
          ? sessions.some((session) => session.planting_id === task.planting_id)
          : false;
        const meetingFit = task.type === "meeting" && sessions.some((session) => partsInZone(new Date(session.start), snapshot.timeZone).weekday === 6);
        let score = 0;
        if (samePlanting) score += 40;
        if (sameBed) score += 30;
        if (meetingFit) score += 20;
        if (task.type === "water" && sessions.some((session) => session.activity_type === "water" || session.activity_type === "weed")) {
          score += 10;
        }
        score += Math.max(0, 8 - (load.get(person.id) ?? 0) * 3);
        return { person, score, sessions };
      })
      .filter((item) => item.score > 0 || open.length <= snapshot.visitors.length)
      .sort((a, b) => b.score - a.score || (load.get(a.person.id) ?? 0) - (load.get(b.person.id) ?? 0));

    const pick = candidates[0];
    if (!pick) continue;
    if (used.has(`${task.id}:${pick.person.id}`)) continue;

    const when = pick.sessions[0]
      ? sessionWhen(pick.sessions[0], snapshot.timeZone)
      : "already coming next week";
    const reason = task.bed_id && pick.sessions.some((session) => session.bed_id === task.bed_id)
      ? `Already planned near that bed (${when})`
      : `Already on the calendar (${when})`;

    assignments.push({ taskId: task.id, personId: pick.person.id, reason });
    load.set(pick.person.id, (load.get(pick.person.id) ?? 0) + 1);
    used.add(`${task.id}:${pick.person.id}`);
  }

  return assignments;
}

export function buildPersonalTexts(
  snapshot: PlanSnapshot,
  assignments: PlanAssignment[],
): PersonalPlanText[] {
  const peopleById = new Map(snapshot.recipients.map((person) => [person.id, person]));
  const tasksById = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const bedsById = new Map(snapshot.beds.map((bed) => [bed.id, bed]));
  const byPerson = new Map<string, PlanAssignment[]>();
  for (const item of assignments) {
    const list = byPerson.get(item.personId) ?? [];
    list.push(item);
    byPerson.set(item.personId, list);
  }

  const open = snapshot.tasks.filter(
    (task) => task.status !== "claimed" && task.status !== "done" && task.status !== "rejected",
  );

  return snapshot.recipients.map((person) => {
    const mine = byPerson.get(person.id) ?? [];
    const mineIds = new Set(mine.map((item) => item.taskId));
    const lines: string[] = [];
    lines.push(`Hi ${person.name} — garden plan for ${shortRange(snapshot.weekStart, snapshot.weekEnd)}:`);

    const visits = snapshot.sessions.filter((session) => session.person_id === person.id);
    if (visits.length) {
      const first = visits[0];
      const bed = first.bed_id ? bedsById.get(first.bed_id)?.name : null;
      lines.push(
        `You're already on ${sessionWhen(first, snapshot.timeZone)}${bed ? ` (${bed})` : ""}.`,
      );
    }

    if (mine.length) {
      lines.push("Suggested for you:");
      for (const item of mine.slice(0, 5)) {
        const task = tasksById.get(item.taskId);
        if (!task) continue;
        const mark = task.severity === "urgent" ? "!" : "·";
        lines.push(`${mark} ${task.title}${item.reason ? ` — ${item.reason}` : ""}`);
      }
      const others = open.filter((task) => !mineIds.has(task.id)).slice(0, 3);
      if (others.length) {
        lines.push(`Also still open: ${others.map((task) => task.title).join("; ")}`);
      }
    } else if (visits.length) {
      lines.push("Nothing specifically matched to your visit; open chores if you can help:");
      for (const task of open.slice(0, 5)) {
        const mark = task.severity === "urgent" ? "!" : "·";
        lines.push(`${mark} ${task.title}`);
      }
    } else {
      // Recipients should already be next-week visitors; keep a short fallback.
      lines.push("Open chores next week:");
      for (const task of open.slice(0, 5)) {
        const mark = task.severity === "urgent" ? "!" : "·";
        lines.push(`${mark} ${task.title}`);
      }
    }

    lines.push(`Reply "I'll take watering" (or harvest / fill / a bed name) to claim.`);
    return { personId: person.id, name: person.name, text: lines.join("\n") };
  }).filter((item) => peopleById.has(item.personId));
}

export function sanitizeAssignments(
  raw: PlanAssignment[],
  snapshot: PlanSnapshot,
): PlanAssignment[] {
  const taskIds = new Set(
    snapshot.tasks
      .filter((task) => task.status !== "claimed" && task.status !== "done" && task.status !== "rejected")
      .map((task) => task.id),
  );
  const visitorIds = new Set(snapshot.visitors.map((person) => person.id));
  const seen = new Set<string>();
  const out: PlanAssignment[] = [];
  for (const item of raw) {
    if (!taskIds.has(item.taskId) || !visitorIds.has(item.personId)) continue;
    if (seen.has(item.taskId)) continue;
    seen.add(item.taskId);
    out.push({
      taskId: item.taskId,
      personId: item.personId,
      reason: (item.reason || "Already coming next week").slice(0, 120),
    });
  }
  return out;
}

/**
 * Ask deepagents (Gemini) to match open tasks to people already on next week's calendar.
 * Falls back to deterministic matching when there is no key, no visitors, or the agent fails.
 */
export async function runPlanAgent(snapshot: PlanSnapshot): Promise<PlanAgentResult> {
  const fallback = fallbackAssign(snapshot);
  if (!snapshot.visitors.length) {
    return { assignments: [], personalTexts: buildPersonalTexts(snapshot, []), source: "fallback" };
  }

  const key = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
  if (!key) {
    console.warn("Plan agent: GEMINI_API_KEY / GOOGLE_API_KEY not set in this process.");
    return { assignments: fallback, personalTexts: buildPersonalTexts(snapshot, fallback), source: "no_key" };
  }

  try {
    let timedOut = false;
    const agentResult = await Promise.race([
      invokeDeepAgent(snapshot, key),
      new Promise<null>((resolve) =>
        setTimeout(() => {
          timedOut = true;
          resolve(null);
        }, AGENT_TIMEOUT_MS),
      ),
    ]);
    if (!agentResult) {
      console.warn(
        timedOut ? "Plan agent timed out; using fallback assignments." : "Plan agent returned nothing; using fallback.",
      );
      return {
        assignments: fallback,
        personalTexts: buildPersonalTexts(snapshot, fallback),
        source: timedOut ? "timeout" : "fallback",
      };
    }
    const assignments = sanitizeAssignments(agentResult.assignments, snapshot);
    const finalAssignments = assignments.length ? assignments : fallback;
    const personalTexts =
      agentResult.messages.length > 0
        ? mergeAgentMessages(snapshot, finalAssignments, agentResult.messages)
        : buildPersonalTexts(snapshot, finalAssignments);
    // Agent ran and submitted — even if we filled gaps with fallback matching.
    return { assignments: finalAssignments, personalTexts, source: "agent" };
  } catch (error) {
    console.warn("Plan agent failed:", error instanceof Error ? error.message : error);
    return { assignments: fallback, personalTexts: buildPersonalTexts(snapshot, fallback), source: "error" };
  }
}

function mergeAgentMessages(
  snapshot: PlanSnapshot,
  assignments: PlanAssignment[],
  messages: Array<{ personId: string; text: string }>,
): PersonalPlanText[] {
  const generated = buildPersonalTexts(snapshot, assignments);
  const byId = new Map(messages.map((item) => [item.personId, item.text.trim()]));
  return generated.map((item) => {
    const custom = byId.get(item.personId);
    if (custom && custom.length > 20 && custom.length < 900) {
      return { ...item, text: custom };
    }
    return item;
  });
}

async function invokeDeepAgent(
  snapshot: PlanSnapshot,
  apiKey: string,
): Promise<{ assignments: PlanAssignment[]; messages: Array<{ personId: string; text: string }> }> {
  if (!process.env.GOOGLE_API_KEY) process.env.GOOGLE_API_KEY = apiKey;

  const { createDeepAgent } = await import("deepagents");
  const { ChatGoogle } = await import("@langchain/google/node");

  const modelName = process.env.GEMINI_MODEL || "gemini-flash-latest";
  let submitted: { assignments: PlanAssignment[]; messages: Array<{ personId: string; text: string }> } | null = null;

  const openTasks = snapshot.tasks
    .filter((task) => task.status !== "claimed" && task.status !== "done" && task.status !== "rejected")
    .map((task) => ({
      id: task.id,
      type: task.type,
      severity: task.severity,
      title: task.title,
      bed_id: task.bed_id,
      planting_id: task.planting_id,
    }));

  const visitors = snapshot.visitors.map((person) => ({
    id: person.id,
    name: person.name,
    sessions: snapshot.sessions
      .filter((session) => session.person_id === person.id)
      .map((session) => ({
        when: sessionWhen(session, snapshot.timeZone),
        activity: session.activity_type,
        bed_id: session.bed_id,
        planting_id: session.planting_id,
      })),
  }));

  const submitWeekPlan = tool(
    async ({ assignments, messages }: {
      assignments: Array<{ taskId: string; personId: string; reason: string }>;
      messages: Array<{ personId: string; text: string }>;
    }) => {
      submitted = { assignments, messages };
      return `Recorded ${assignments.length} suggestions and ${messages.length} personal texts.`;
    },
    {
      name: "submit_week_plan",
      description:
        "Submit final soft task suggestions and a short personal text for each garden recipient. Call this once when done.",
      schema: z.object({
        assignments: z.array(
          z.object({
            taskId: z.string().describe("Open task id from the snapshot"),
            personId: z.string().describe("Visitor id from the snapshot"),
            reason: z.string().describe("Short reason tied to their planned visit"),
          }),
        ),
        messages: z.array(
          z.object({
            personId: z.string().describe("Recipient person id"),
            text: z.string().describe("Personal SMS under 700 characters"),
          }),
        ),
      }),
    },
  );

  // One tool only — snapshot is inlined so Gemini can answer in a single tool call (avoids 25s+ multi-step timeouts).
  const agent = await createDeepAgent({
    model: new ChatGoogle({ model: modelName, apiKey, temperature: 0 }),
    tools: [submitWeekPlan],
    systemPrompt: `You assign garden chores for a community garden week plan.
Rules:
- Only suggest people in visitors (already coming next week).
- Prefer matching a task's bed/planting to a visit at that bed.
- Do not overload one person; spread urgent watering when possible.
- Never invent task or person ids.
- Keep each personal message under 700 characters, friendly and concrete.
- Soft suggestions only — volunteers still claim by texting.
- Call submit_week_plan exactly once. Do not write files or use other tools.
Week: ${snapshot.weekStart} to ${snapshot.weekEnd} (${snapshot.timeZone}).`,
  });

  await agent.invoke({
    messages: [
      {
        role: "user",
        content: [
          "Using this snapshot, assign open tasks to visitors and draft a personal text for each recipient, then call submit_week_plan.",
          JSON.stringify({
            openTasks,
            visitors,
            recipients: snapshot.recipients.map((person) => ({ id: person.id, name: person.name })),
          }),
        ].join("\n"),
      },
    ],
  });

  return submitted ?? { assignments: [], messages: [] };
}

function sessionWhen(session: WorkSession, timeZone: string): string {
  const start = partsInZone(new Date(session.start), timeZone);
  const end = partsInZone(new Date(session.end), timeZone);
  return `${DAY[start.weekday]} ${formatClock(start.hour, start.minute)}–${formatClock(end.hour, end.minute)}`;
}

function shortRange(weekStart: string, weekEnd: string): string {
  return `${shortDay(weekStart)}–${shortDay(weekEnd)}`;
}

function shortDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
