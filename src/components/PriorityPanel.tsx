"use client";

import { useState } from "react";
import { cropTitle } from "@/lib/phrases";
import type { Bed, Planting, PublicPerson, Task } from "@/lib/types";

const MARK: Record<Task["type"], string> = {
  water: "urgent",
  harvest: "upcoming",
  fill: "fill",
  meeting: "meeting",
};

export function PriorityPanel({
  tasks,
  beds,
  plantings,
  people,
  selectedId,
  onSelect,
  onPlanChange,
}: {
  tasks: Task[];
  beds: Bed[];
  plantings: Planting[];
  people: PublicPerson[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPlanChange: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{
    recipients: number;
    personalTexts: Array<{ personId: string; name: string; text: string }>;
    agentSource: "agent" | "fallback" | "timeout" | "error" | "no_key";
  } | null>(null);
  const [sentNote, setSentNote] = useState("");

  async function propose() {
    setBusy(true);
    setError("");
    setSentNote("");
    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "propose" }),
      });
      const body = (await response.json()) as {
        recipients?: Array<{ id: string }>;
        personalTexts?: Array<{ personId: string; name: string; text: string }>;
        agentSource?: "agent" | "fallback" | "timeout" | "error" | "no_key";
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "Could not build the plan.");
      setPreview({
        recipients: body.recipients?.length ?? 0,
        personalTexts: body.personalTexts ?? [],
        agentSource: body.agentSource ?? "fallback",
      });
      await onPlanChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the plan.");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      const body = (await response.json()) as { sent?: number; error?: string; recipients?: Array<{ id: string }> };
      if (!response.ok) throw new Error(body.error || "Could not send the plan.");
      const n = body.sent ?? 0;
      setSentNote(
        n === 0
          ? "Plan approved. Nobody both on next week’s calendar and already texting got a message."
          : `Plan approved and texted personally to ${n} volunteer${n === 1 ? "" : "s"} already coming next week.`,
      );
      setPreview(null);
      await onPlanChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the plan.");
    } finally {
      setBusy(false);
    }
  }

  const sample = preview?.personalTexts[0] ?? null;

  return (
    <aside className="priority">
      <header>
        <h2>Priority</h2>
        <p>From the work log and planting dates.</p>
        <div className="priority-plan">
          <button type="button" className="icon-btn" onClick={propose} disabled={busy}>
            {busy ? "Planning…" : "Plan next week"}
          </button>
          {preview ? (
            <button type="button" className="icon-btn on" onClick={approve} disabled={busy}>
              Approve &amp; text ({preview.recipients})
            </button>
          ) : null}
        </div>
        {error ? <p className="priority-note error">{error}</p> : null}
        {sentNote ? <p className="priority-note">{sentNote}</p> : null}
        {preview ? (
          <>
            <p className="priority-note">
              {preview.recipients === 0
                ? "Nobody is on next week’s calendar yet (who has also texted), so Approve won’t send texts. Schedule visits first."
                : preview.agentSource === "agent"
                  ? `Agent suggestions for ${preview.recipients} volunteer${preview.recipients === 1 ? "" : "s"} already on next week’s calendar.`
                  : preview.agentSource === "timeout"
                    ? `Agent timed out — used calendar matching for ${preview.recipients} volunteer${preview.recipients === 1 ? "" : "s"} already coming.`
                    : preview.agentSource === "error"
                      ? `Agent errored — used calendar matching for ${preview.recipients} volunteer${preview.recipients === 1 ? "" : "s"} already coming.`
                      : preview.agentSource === "no_key"
                        ? `Calendar matching for ${preview.recipients} volunteer${preview.recipients === 1 ? "" : "s"} (GEMINI_API_KEY not loaded — restart npm run dev).`
                        : `Calendar matching for ${preview.recipients} volunteer${preview.recipients === 1 ? "" : "s"} already coming.`}
            </p>
            {sample ? (
              <pre className="plan-preview personal" aria-label={`Sample text for ${sample.name}`}>
                {`Sample text → ${sample.name}\n${sample.text}`}
              </pre>
            ) : null}
          </>
        ) : null}
      </header>
      <ul>
        {tasks.map((task) => {
          const bed = beds.find((item) => item.id === task.bed_id);
          const planting = plantings.find((item) => item.id === task.planting_id);
          const where = bed?.name ?? (planting ? cropTitle(planting.crop) : null);
          const assignee = people.find((person) => person.id === task.assignee_id);
          const suggested = people.find((person) => person.id === task.suggested_assignee_id);
          const claimLabel =
            task.status === "claimed"
              ? assignee
                ? `Claimed · ${assignee.name}`
                : "Claimed"
              : task.status === "proposed"
                ? suggested
                  ? `Suggested · ${suggested.name}`
                  : "Proposed"
                : task.status === "approved"
                  ? suggested
                    ? `Open · suggested ${suggested.name}`
                    : "Open to claim"
                  : null;
          return (
            <li key={task.id}>
              <button
                type="button"
                className={task.id === selectedId ? "task on" : "task"}
                onClick={() => onSelect(task.id)}
              >
                <i className={`mark ${MARK[task.type]}`} aria-hidden="true" />
                <span>
                  <strong>{task.title}</strong>
                  {where ? <em>{where}</em> : <em>Garden</em>}
                  {claimLabel ? <em className="claim-tag">{claimLabel}</em> : null}
                  {task.id === selectedId ? <small>{task.detail}</small> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
