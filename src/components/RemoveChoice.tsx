"use client";

import { useEffect, useRef, useState } from "react";
import { spriteUrl } from "@/lib/pixel-sprites";
import type { Occupant } from "@/lib/drop-plan";

function shortDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function title(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Asked when Delete is pressed on a patch with several crops: which ones to take out. */
export function RemoveChoice(props: {
  bedName: string;
  there: Occupant[];
  sprites: Record<string, string>;
  busy: boolean;
  onRemove: (plantingIds: string[]) => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(props.there.map((o) => o.planting.id)));

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);

  return (
    <dialog ref={dialog} className="drop-dialog" onCancel={props.onCancel} onClose={props.onCancel} aria-labelledby="remove-title">
      <h2 id="remove-title">Remove from {props.bedName}?</h2>
      <fieldset className="drop-pick">
        <legend>Remove which?</legend>
        {props.there.map(({ planting, established }) => (
          <label key={planting.id}>
            <input
              type="checkbox"
              checked={picked.has(planting.id)}
              onChange={(event) =>
                setPicked((prev) => {
                  const next = new Set(prev);
                  if (event.target.checked) next.add(planting.id);
                  else next.delete(planting.id);
                  return next;
                })
              }
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="sprite" src={spriteUrl(planting.crop, props.sprites)} alt="" width={20} height={20} />
            <span>
              <strong>{title(planting.crop)}</strong>
              <small>
                {established ? `In the ground since ${shortDate(planting.planted_date)} · kept in history as pulled` : `Planned for ${shortDate(planting.planted_date)} · deleted`}
              </small>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="drop-choices">
        <button type="button" className="pill on" disabled={props.busy || picked.size === 0} onClick={() => props.onRemove([...picked])}>
          Remove {picked.size || ""}
        </button>
        <button type="button" className="texty" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
