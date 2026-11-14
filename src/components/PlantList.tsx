"use client";

import { useState } from "react";
import { CROP_MIME } from "@/components/GardenMap";
import { spriteUrl } from "@/lib/pixel-sprites";
import type { GardenData } from "@/lib/garden-data";
import type { BedAdvice, Recommendation } from "@/lib/recommend";
import type { Bed, Planting } from "@/lib/types";
import { showArea, showSize } from "@/lib/units";

function shortDate(day: string, withYear = false): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: withYear ? "numeric" : undefined,
    timeZone: "UTC",
  });
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

function Sprite({ crop, sprites, size = 22, ghost = false }: { crop: string | null; sprites: Record<string, string>; size?: number; ghost?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={ghost ? "sprite ghost" : "sprite"} src={spriteUrl(crop, sprites)} alt="" width={size} height={size} />;
}

function title(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function seedLink(crop: string, location: string): string {
  const q = location ? `garden center seeds near ${location}` : "garden center seeds near me";
  return `https://www.google.com/maps/search/${encodeURIComponent(`${q} ${crop}`.trim())}`;
}

const WATER: Record<Recommendation["water"], string> = {
  low: "Low water",
  medium: "Water weekly",
  high: "Water often",
};

export function PlantList(props: {
  /** The garden as of the date shown on the timeline (data.today is that date). */
  data: GardenData;
  /** Whether that date is before, on, or after the real today. Looking back is view only. */
  mode: "past" | "today" | "future";
  advice: Map<string, BedAdvice>;
  selected: Bed | null;
  editing: boolean;
  busy: boolean;
  onSelect: (id: string | null) => void;
  onPlan: (bedId: string, crop: string) => void;
  onRename: (bed: Bed, name: string) => void;
  onDeleteBed: (bed: Bed) => void;
  onUnplan: (plantingId: string) => void;
}) {
  const { selected } = props;
  return (
    <aside className="plant-list" aria-label="Plant list">
      {selected ? <BedDetail {...props} bed={selected} /> : <Overview {...props} />}
    </aside>
  );
}

function Overview(props: Parameters<typeof PlantList>[0]) {
  const { data, advice } = props;
  const open = data.beds.filter((bed) => {
    const a = advice.get(bed.id);
    return a && a.current.length === 0 && a.planned.length === 0;
  });
  return (
    <>
      <h2>Plant list</h2>
      <p className="sub">
        {props.mode === "past"
          ? `What was in each bed on ${shortDate(data.today, true)}.`
          : props.mode === "future"
            ? `What will be in each bed on ${shortDate(data.today, true)}, and ideas for the open spots.`
            : "What's in each bed, and ideas for open spots based on rotation and the season."}
      </p>
      {open.length && props.mode !== "past" ? (
        <div className="open-spots">
          {open.map((bed) => {
            const top = advice.get(bed.id)?.recommendations[0];
            return (
              <button type="button" key={bed.id} className="open-spot" onClick={() => props.onSelect(bed.id)}>
                <span className="dot routine" aria-hidden="true" />
                <span>
                  <strong>{bed.name} is open</strong>
                  {top ? (
                    <small>
                      Try {top.crop}
                      {top.now ? (props.mode === "future" ? " (can go in then)" : " (can go in now)") : ` from ${shortDate(top.plantOn)}`}
                    </small>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      <ul className="bed-rows">
        {data.beds.map((bed) => {
          const a = advice.get(bed.id);
          const now = a?.current[0];
          const next = a?.planned[0];
          const others = (a?.current ?? []).slice(1).map((p) => p.crop);
          return (
            <li key={bed.id}>
              <button type="button" onClick={() => props.onSelect(bed.id)}>
                {now || next ? (
                  <Sprite crop={(now ?? next)!.crop} sprites={data.sprites} ghost={!now} />
                ) : (
                  <i className="hollow" />
                )}
                <span>
                  <strong>{bed.name}</strong>
                  <small>
                    {now
                      ? statusLine(now, data.today) + (others.length ? ` · also ${others.join(", ")}` : "")
                      : next
                        ? `${title(next.crop)} planned for ${shortDate(next.planted_date)}`
                        : props.mode === "past"
                          ? "Empty"
                          : "Open"}
                  </small>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function statusLine(planting: Planting, today: string): string {
  if (planting.crop.toLowerCase().includes("tree")) return `${title(planting.crop)} since ${shortDate(planting.planted_date)}`;
  const until = daysBetween(today, planting.expected_harvest_date);
  if (until < 0) return `${title(planting.crop)} · past harvest date`;
  if (until === 0) return `${title(planting.crop)} · harvest today`;
  return `${title(planting.crop)} · harvest in ${until} day${until === 1 ? "" : "s"}`;
}

function BedDetail(props: Parameters<typeof PlantList>[0] & { bed: Bed }) {
  const { bed, data, advice } = props;
  const a = advice.get(bed.id);
  const [more, setMore] = useState(false);
  if (!a) return null;
  const peopleById = new Map(data.people.map((person) => [person.id, person]));
  const sessions = data.sessions
    .filter((session) => session.bed_id === bed.id)
    .sort((x, y) => y.start.localeCompare(x.start));
  const lastWater = sessions.find((session) => session.activity_type === "water");
  const photos = data.photos
    .filter((photo) => sessions.some((session) => session.id === photo.session_id))
    .sort((x, y) => y.taken_at.localeCompare(x.taken_at))
    .slice(0, 3);
  const tasks = data.tasks.filter((task) => task.bed_id === bed.id);
  const recs = a.recommendations.slice(0, more ? 8 : 3);
  const g = bed.geometry;

  return (
    <>
      <button type="button" className="back" onClick={() => props.onSelect(null)}>
        ‹ All beds
      </button>
      {props.editing ? (
        <input
          className="bed-name-input"
          defaultValue={bed.name}
          key={bed.id + bed.name}
          aria-label="Bed name"
          onBlur={(event) => {
            if (event.target.value.trim() && event.target.value.trim() !== bed.name) props.onRename(bed, event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          }}
        />
      ) : (
        <h2>{bed.name}</h2>
      )}
      <p className="sub">
        {g ? `${showSize(g.w, g.h, data.layout.units ?? "ft")} · ${showArea(g.w, g.h, data.layout.units ?? "ft")}` : "Not on the map yet"}
      </p>

      {tasks.length ? (
        <ul className="bed-tasks">
          {tasks.map((task) => (
            <li key={task.id}>
              <span className={`dot ${task.severity}`} aria-hidden="true" />
              {task.title}
            </li>
          ))}
        </ul>
      ) : null}

      <section className="block">
        <h3>{props.mode === "today" ? "Now growing" : `Growing on ${shortDate(data.today, true)}`}</h3>
        {a.current.length ? (
          a.current.map((planting) => (
            <div key={planting.id} className="growing">
              <Sprite crop={planting.crop} sprites={data.sprites} size={28} />
              <div>
                <strong>{title(planting.crop)}</strong>
                <small>
                  Planted {shortDate(planting.planted_date)} · {statusLine(planting, data.today).split(" · ")[1] ?? "growing"}
                </small>
                <small>
                  {props.mode === "future" ? "" : lastWater
                    ? `Last watered ${shortDate(lastWater.start.slice(0, 10))} by ${peopleById.get(lastWater.person_id)?.name ?? "someone"}`
                    : "No watering logged"}
                </small>
              </div>
            </div>
          ))
        ) : (
          <p className="quiet">Nothing in the ground{a.planned.length ? " yet" : ""}.</p>
        )}
      </section>

      {a.planned.length ? (
        <section className="block">
          <h3>Planned</h3>
          {a.planned.map((planting) => (
          <div key={planting.id} className="growing planned">
            <Sprite crop={planting.crop} sprites={data.sprites} size={28} ghost />
            <div>
              <strong>{title(planting.crop)}</strong>
              <small>Planned for {shortDate(planting.planted_date, true)}</small>
            </div>
            <button
              type="button"
              className="texty small"
              onClick={() => props.onUnplan(planting.id)}
              disabled={props.busy}
              aria-label={`Remove planned ${planting.crop}`}
            >
              Remove
            </button>
          </div>
          ))}
          <p className="quiet small">When someone texts that they planted it, the plan becomes the real planting.</p>
        </section>
      ) : null}

      {props.mode === "past" ? null : (
      <section className="block">
        <h3>
          {a.current.length || a.planned.length ? `Plant next (bed free ${shortDate(a.freeFrom)})` : "Suggested for this bed"}
        </h3>
        <div className="recs">
          {recs.map((rec) => (
            <article
              key={rec.crop}
              className="rec"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(CROP_MIME, rec.crop);
                event.dataTransfer.setData("text/plain", rec.crop);
                event.dataTransfer.effectAllowed = "copy";
              }}
            >
              <header>
                <Sprite crop={rec.crop} sprites={data.sprites} size={30} />
                <strong>{title(rec.crop)}</strong>
                <span className={rec.now ? "chip now" : "chip"}>
                  {rec.now ? (props.mode === "future" ? "Plant then" : "Plant now") : `From ${shortDate(rec.plantOn, rec.plantOn.slice(0, 4) !== data.today.slice(0, 4))}`}
                </span>
              </header>
              <ul className="why">
                {rec.reasons.slice(0, 2).map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <dl>
                <div>
                  <dt>Water</dt>
                  <dd>{WATER[rec.water]}</dd>
                </div>
                <div>
                  <dt>Sun</dt>
                  <dd>{rec.sun}</dd>
                </div>
                <div>
                  <dt>Soil</dt>
                  <dd>{rec.soil}</dd>
                </div>
              </dl>
              <footer>
                <a href={seedLink(rec.crop, data.layout.location)} target="_blank" rel="noreferrer">
                  Find seeds nearby ↗
                </a>
                <button type="button" className="pill" onClick={() => props.onPlan(bed.id, rec.crop)} disabled={props.busy}>
                  Add to plan
                </button>
              </footer>
            </article>
          ))}
        </div>
        {a.recommendations.length > 3 ? (
          <button type="button" className="texty small" onClick={() => setMore((v) => !v)}>
            {more ? "Fewer ideas" : `More ideas (${Math.min(8, a.recommendations.length) - 3})`}
          </button>
        ) : null}
        {a.avoid.length ? (
          <p className="avoid">
            <strong>Skip here in {data.today.slice(0, 4)}:</strong> {a.avoid.map((item) => item.crop).join(", ")}. {uniqueReasons(a)}
          </p>
        ) : null}
      </section>
      )}

      {a.history.length ? (
        <section className="block">
          <h3>Past seasons</h3>
          <p className="history">
            {a.history.slice(0, 6).map((planting) => (
              <span key={planting.id}>
                <b>{planting.season_year}</b> {planting.crop}
              </span>
            ))}
          </p>
        </section>
      ) : null}

      {sessions.length ? (
        <section className="block">
          <h3>Recent work</h3>
          <ul className="work">
            {sessions.slice(0, 4).map((session) => {
              const person = peopleById.get(session.person_id);
              return (
                <li key={session.id}>
                  <i style={{ background: person?.color ?? "#999" }} />
                  <span>
                    <strong>{person?.name ?? "Someone"}</strong> {session.notes.replace(/\.$/, "").toLowerCase()}
                    <small>{new Date(session.start).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: data.timezone })}</small>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {photos.length ? (
        <section className="block">
          <h3>Photos from texts</h3>
          <div className="thumbs">
            {photos.map((photo) => (
              <figure key={photo.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt={photo.caption} />
                <figcaption>{photo.caption}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ) : null}

      {props.editing ? (
        <button type="button" className="texty danger" onClick={() => props.onDeleteBed(bed)} disabled={props.busy}>
          Remove bed
        </button>
      ) : null}
    </>
  );
}

function uniqueReasons(a: BedAdvice): string {
  return [...new Set(a.avoid.map((item) => item.reason))].join(" ");
}
