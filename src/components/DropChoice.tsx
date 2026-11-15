"use client";

import { useEffect, useRef, useState } from "react";
import { spriteUrl } from "@/lib/pixel-sprites";
import type { Occupant } from "@/lib/drop-plan";
import { isPerennial } from "@/lib/perennials";

function shortDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function title(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Asked when a crop is dropped on a patch that already has something established (or several crops) in it. */
export function DropChoice(props: {
  bedName: string;
  crop: string;
  there: Occupant[];
  sprites: Record<string, string>;
  /** When the new crop would go in for each choice. */
  dates: { replace: string; after: string; alongside: string };
  busy: boolean;
  onReplace: (plantingIds: string[]) => void;
  onAfter: () => void;
  onAlongside: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(props.there.map((o) => o.planting.id)));

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);

  const names = props.there.map((o) => o.planting.crop);
  const what = [...new Set(names)].join(" and ");
  const several = props.there.length > 1;
  // Perennials never clear out on their own, so "after" only makes sense if something annual is there.
  const canAfter = !props.there.every((o) => isPerennial(o.planting.crop));

  return (
    <dialog ref={dialog} className="drop-dialog" onCancel={props.onCancel} onClose={props.onCancel} aria-labelledby="drop-title">
      <h2 id="drop-title">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="sprite" src={spriteUrl(props.crop, props.sprites)} alt="" width={28} height={28} />
        {title(props.crop)} in {props.bedName}?
      </h2>
      <p className="drop-sub">
        {props.bedName} has {what} in it. Replace {several ? "some of it" : "it"}, or plant {props.crop}{" "}
        {canAfter ? "after it or next to it" : `next to it (${what} ${several ? "are perennials" : "is a perennial"} and stay${several ? "" : "s"} put)`}?
      </p>

      <fieldset className="drop-pick">
        <legend>{several ? "Replace which?" : "Replace"}</legend>
        {props.there.map(({ planting, established }) => (
          <label key={planting.id}>
            <input
              type="checkbox"
              checked={picked.has(planting.id)}
              disabled={!several}
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
                {established ? `In the ground since ${shortDate(planting.planted_date)} · kept in history as pulled` : `Planned for ${shortDate(planting.planted_date)} · removed`}
              </small>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="drop-choices">
        <button type="button" className="pill on" disabled={props.busy || picked.size === 0} onClick={() => props.onReplace([...picked])}>
          Replace{several && picked.size ? ` ${picked.size}` : ""}
          <small>{props.crop} from {shortDate(props.dates.replace)}</small>
        </button>
        {canAfter ? (
          <button type="button" className="pill" disabled={props.busy} onClick={props.onAfter}>
            Plant after
            <small>from {shortDate(props.dates.after)}</small>
          </button>
        ) : null}
        <button type="button" className="pill" disabled={props.busy} onClick={props.onAlongside}>
          Plant alongside
          <small>from {shortDate(props.dates.alongside)}</small>
        </button>
        <button type="button" className="texty" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
