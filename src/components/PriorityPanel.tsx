"use client";

import { cropTitle } from "@/lib/phrases";
import type { Bed, Planting, Task } from "@/lib/types";

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
  selectedId,
  onSelect,
}: {
  tasks: Task[];
  beds: Bed[];
  plantings: Planting[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="priority">
      <header>
        <h2>Priority task</h2>
        <p>From the work log and planting dates.</p>
      </header>
      <ul>
        {tasks.map((task) => {
          const bed = beds.find((item) => item.id === task.bed_id);
          const planting = plantings.find((item) => item.id === task.planting_id);
          const where = bed?.name ?? (planting ? cropTitle(planting.crop) : null);
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
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
