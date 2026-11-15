import type { Bed, GardenLayout, Planting } from "./types";

/** What the garden view knows before and after an edit. */
export type Snapshot = { beds: Bed[]; plantings: Planting[]; layout: GardenLayout };

/**
 * How to undo one edit: put back the records it changed or removed, and remove the ones it created.
 * Only records the edit touched are listed, so undo never wipes out someone else's change made in the meantime
 * (a planting logged by text, say).
 */
export type UndoStep = {
  label: string;
  beds: { restore: Bed[]; remove: string[] };
  plantings: { restore: Planting[]; remove: string[] };
  /** The layout before the edit, if the edit changed it. */
  layout: GardenLayout | null;
};

/** JSON with keys sorted, so the same record always compares equal however it was built. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v,
  );
}

function changes<T extends { id: string }>(before: T[], after: T[]): { restore: T[]; remove: string[] } {
  const was = new Map(before.map((item) => [item.id, item]));
  const now = new Map(after.map((item) => [item.id, item]));
  return {
    restore: before.filter((item) => {
      const current = now.get(item.id);
      return !current || stable(current) !== stable(item);
    }),
    remove: after.filter((item) => !was.has(item.id)).map((item) => item.id),
  };
}

/** The undo step for an edit, or null if it didn't change anything. */
export function undoStep(label: string, before: Snapshot, after: Snapshot): UndoStep | null {
  const beds = changes(before.beds, after.beds);
  const plantings = changes(before.plantings, after.plantings);
  const layout = stable(before.layout) !== stable(after.layout) ? before.layout : null;
  if (!beds.restore.length && !beds.remove.length && !plantings.restore.length && !plantings.remove.length && !layout) return null;
  return { label, beds, plantings, layout };
}

/** Undo history is kept short: older steps fall off. */
export const UNDO_LIMIT = 30;
