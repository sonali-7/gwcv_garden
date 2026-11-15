"use client";

import { useState } from "react";
import { CROP_MIME } from "@/components/GardenMap";
import { PlantSearch } from "@/components/PlantSearch";
import { SustainabilityCard } from "@/components/SustainabilityCard";
import { spriteUrl } from "@/lib/pixel-sprites";
import type { BedIdea } from "@/lib/bed-ideas";
import type { GardenData } from "@/lib/garden-data";
import { harvestSeason, isPerennial, monthsLabel, nextReady, perennialInfo } from "@/lib/perennials";
import { nitrogenReason, nitrogenTip, type NitrogenBalance } from "@/lib/nitrogen";
import type { BedAdvice, Recommendation } from "@/lib/recommend";
import { areaOfBed, areasOf } from "@/lib/garden-areas";
import type { Bed, GardenArea, Planting } from "@/lib/types";
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
  onPlan: (bedId: string, crop: string, how?: "after" | "alongside" | "replace") => void;
  onRename: (bed: Bed, name: string) => void;
  /** The plot whose name is being edited (double-click its name here or on the map), if any. */
  renamingId: string | null;
  onStartRename: (id: string) => void;
  onStopRename: () => void;
  onDeleteBed: (bed: Bed) => void;
  /** Take crops out of a patch: plans are deleted, anything planted is marked pulled on the date shown. */
  onRemove: (plantingIds: string[]) => void;
  /** Confirm a plan was planted (today). Until then it doesn't count as in the ground. */
  onConfirm: (plantingId: string) => void;
  /** The real date, so overdue plans can be spotted while the timeline looks ahead. */
  realToday: string;
}) {
  const { selected } = props;
  return (
    <aside className="plant-list" aria-label="Plant list">
      {selected ? <BedDetail key={selected.id} {...props} bed={selected} /> : <Overview {...props} />}
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
      <SustainabilityCard beds={data.beds} plantings={data.plantings} day={data.today} today={props.realToday} />
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
        {groupByArea(
          byHarvest(data.beds, advice, data.today)
            // Open plots already have their own green cards above; only looking back (no cards) lists them here.
            .filter((bed) => props.mode === "past" || !open.includes(bed)),
          areasOf(data.layout),
        ).map((item) => {
          if ("heading" in item) {
            return (
              <li key={item.key} className="area-heading">
                {item.heading}
              </li>
            );
          }
          const bed = item.bed;
          const a = advice.get(bed.id);
          const now = soonestHarvest(a?.current ?? [], data.today);
          const next = a?.planned[0];
          const others = (a?.current ?? []).filter((p) => p !== now).map((p) => p.crop);
          const nextCrops = [...new Set((a?.planned ?? []).filter((p) => p.planted_date === next?.planted_date).map((p) => p.crop))];
          return (
            <li key={bed.id}>
              <button type="button" onClick={() => props.onSelect(bed.id)}>
                {now || next ? (
                  <Sprite crop={(now ?? next)!.crop} sprites={data.sprites} ghost={!now} />
                ) : (
                  <i className="hollow" />
                )}
                <span>
                  <strong>
                    {bed.name}
                    {a?.nitrogen.level === "low" ? (
                      <span className="n-flag" title="Low on nitrogen: try beans, peas or clover next">
                        Low N
                      </span>
                    ) : null}
                  </strong>
                  <small>
                    {now
                      ? statusLine(now, data.today) + (others.length ? ` · also ${others.join(", ")}` : "")
                      : next
                        ? `${title(nextCrops.join(" + "))} planned for ${shortDate(next.planted_date)}${next.planted_date <= props.realToday ? " · not planted yet" : ""}`
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

/**
 * With two or more growing areas, the list is split under each area's name (plots outside every area go under
 * "Elsewhere"), keeping the harvest order within each. With one area or none, it's the plain list.
 */
function groupByArea(beds: Bed[], areas: GardenArea[]): Array<{ bed: Bed } | { heading: string; key: string }> {
  if (areas.length < 2) return beds.map((bed) => ({ bed }));
  const out: Array<{ bed: Bed } | { heading: string; key: string }> = [];
  for (const area of areas) {
    const mine = beds.filter((bed) => areaOfBed(bed, areas)?.id === area.id);
    if (!mine.length) continue;
    out.push({ heading: area.name, key: `area-${area.id}` }, ...mine.map((bed) => ({ bed })));
  }
  const loose = beds.filter((bed) => !areaOfBed(bed, areas));
  if (loose.length) out.push({ heading: "Elsewhere", key: "area-none" }, ...loose.map((bed) => ({ bed })));
  return out;
}

/**
 * The growing crop ready first. Perennials go by their next harvest season (today if in season);
 * ones that aren't picked, like roses and trees, go last.
 */
function soonestHarvest(current: Planting[], day: string): Planting | undefined {
  return [...current].sort((x, y) => nextReady(x, day).localeCompare(nextReady(y, day)))[0];
}

/**
 * Plant list order: empty plots first, then planted ones by harvest date (soonest or overdue on top),
 * then plots that only have plans, by when they go in. Ties go by name, with numbers in order (Plot 2 before Plot 10).
 */
function byHarvest(beds: Bed[], advice: Map<string, BedAdvice>, day: string): Bed[] {
  const rank = (bed: Bed): [number, string] => {
    const a = advice.get(bed.id);
    const growing = soonestHarvest(a?.current ?? [], day);
    if (growing) return [1, nextReady(growing, day)];
    if (a?.planned[0]) return [2, a.planned[0].planted_date];
    return [0, ""];
  };
  return [...beds].sort((x, y) => {
    const [gx, kx] = rank(x);
    const [gy, ky] = rank(y);
    return gx - gy || kx.localeCompare(ky) || x.name.localeCompare(y.name, undefined, { numeric: true });
  });
}

function statusLine(planting: Planting, today: string): string {
  if (isPerennial(planting.crop)) return `${title(planting.crop)} · ${perennialStatus(planting, today)}`;
  const until = daysBetween(today, planting.expected_harvest_date);
  if (until < 0) return `${title(planting.crop)} · past harvest date`;
  if (until === 0) return `${title(planting.crop)} · harvest today`;
  return `${title(planting.crop)} · harvest in ${until} day${until === 1 ? "" : "s"}`;
}

const N_LABEL: Record<NitrogenBalance["level"], string> = { low: "Low", balanced: "Balanced", rich: "Rich" };
/** Ends of the meter; scores outside are pinned to the ends. */
const N_MIN = -6;
const N_MAX = 4;

/** Soil nitrogen for a plot: a meter, what moved it, and what to plant about it. */
function Nitrogen({ balance }: { balance: NitrogenBalance }) {
  const at = (Math.min(N_MAX, Math.max(N_MIN, balance.score)) - N_MIN) / (N_MAX - N_MIN);
  return (
    <section className="block nitrogen">
      <h3>
        Soil nitrogen <span className={`n-level ${balance.level}`}>{N_LABEL[balance.level]}</span>
      </h3>
      <div
        className="n-meter"
        role="meter"
        aria-label="Soil nitrogen"
        aria-valuemin={N_MIN}
        aria-valuemax={N_MAX}
        aria-valuenow={balance.score}
        aria-valuetext={N_LABEL[balance.level]}
      >
        <i style={{ left: `${at * 100}%` }} />
      </div>
      <p>{nitrogenReason(balance)}</p>
      <p className="quiet small">{nitrogenTip(balance.level)} An estimate from what grew here, not a soil test.</p>
    </section>
  );
}

function permanentNote(crops: string[]): string {
  const one = crops.length === 1;
  return `${title(crops.join(" and "))} come${one ? "s" : ""} back every year, so this plot stays as it is: no rotation and no suggestions. Remove ${one ? "it" : "them"} to plan something new here.`;
}

/** Where a perennial is in its yearly harvest: "harvest season, until Sep 30", "first harvest Jul 2028", … */
function perennialStatus(planting: Planting, day: string): string {
  const season = harvestSeason(planting, day);
  if (season.state === "none") return `perennial since ${shortDate(planting.planted_date, true)}`;
  if (season.state === "now") return `harvest season, until ${shortDate(season.until)}`;
  const wait = daysBetween(day, season.from);
  if (season.first) {
    const when = new Date(`${season.from}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
    return `first harvest ${when}`;
  }
  if (wait <= 60) return `harvest season in ${wait} day${wait === 1 ? "" : "s"}`;
  return `harvest ${monthsLabel(perennialInfo(planting.crop)?.harvestMonths ?? [])} each year`;
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
  // What a new crop would share the bed with, or follow.
  const occupant = [...new Set([...a.current, ...a.planned].map((p) => p.crop))].join(" and ") || null;
  const g = bed.geometry;

  return (
    <>
      <button type="button" className="back" onClick={() => props.onSelect(null)}>
        ‹ All beds
      </button>
      {props.editing || props.renamingId === bed.id ? (
        <input
          className="bed-name-input"
          defaultValue={bed.name}
          key={bed.id + bed.name}
          aria-label="Plot name"
          autoFocus={props.renamingId === bed.id}
          onFocus={(event) => event.target.select()}
          onBlur={(event) => {
            const name = event.target.value.trim();
            if (event.target.dataset.cancel !== "1" && name && name !== bed.name) props.onRename(bed, name);
            props.onStopRename();
          }}
          onKeyDown={(event) => {
            const input = event.target as HTMLInputElement;
            if (event.key === "Enter") input.blur();
            if (event.key === "Escape") {
              event.stopPropagation();
              input.dataset.cancel = "1";
              input.blur();
            }
          }}
        />
      ) : (
        <h2 className="bed-name" title="Double-click to rename" onDoubleClick={() => props.onStartRename(bed.id)}>
          {bed.name}
        </h2>
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

      <Nitrogen balance={a.nitrogen} />

      <section className="block">
        <h3>{props.mode === "today" ? "Now growing" : `Growing on ${shortDate(data.today, true)}`}</h3>
        {a.current.length ? (
          a.current.map((planting) => (
            <div key={planting.id} className="growing">
              <Sprite crop={planting.crop} sprites={data.sprites} size={28} />
              <div>
                <strong>
                  {title(planting.crop)}
                  {isPerennial(planting.crop) ? <span className="perennial-tag">Perennial</span> : null}
                </strong>
                <small>
                  {isPerennial(planting.crop) ? `Since ${shortDate(planting.planted_date, true)}` : `Planted ${shortDate(planting.planted_date)}`} ·{" "}
                  {statusLine(planting, data.today).split(" · ")[1] ?? "growing"}
                </small>
                {props.mode === "future" ? null : (
                  <small>
                    {lastWater
                      ? `Last watered ${shortDate(lastWater.start.slice(0, 10))} by ${peopleById.get(lastWater.person_id)?.name ?? "someone"}`
                      : "No watering logged"}
                  </small>
                )}
              </div>
              {props.mode === "past" ? null : (
                <button
                  type="button"
                  className="texty small"
                  onClick={() => props.onRemove([planting.id])}
                  disabled={props.busy}
                  aria-label={`Remove ${planting.crop}`}
                >
                  Remove
                </button>
              )}
            </div>
          ))
        ) : (
          <p className="quiet">Nothing in the ground{a.planned.length ? " yet" : ""}.</p>
        )}
      </section>

      {a.planned.length ? (
        <section className="block">
          <h3>Planned</h3>
          {a.planned.map((planting) => {
            const overdue = planting.planted_date <= props.realToday;
            return (
              <div key={planting.id} className={`growing planned${overdue ? " overdue" : ""}`}>
                <Sprite crop={planting.crop} sprites={data.sprites} size={28} ghost />
                <div>
                  <strong>{title(planting.crop)}</strong>
                  <small>
                    Planned for {shortDate(planting.planted_date, true)}
                    {overdue ? <em> · not planted yet</em> : null}
                  </small>
                </div>
                <span className="plan-actions">
                  <button
                    type="button"
                    className="pill small"
                    onClick={() => props.onConfirm(planting.id)}
                    disabled={props.busy}
                    title={`Confirm the ${planting.crop} went in today`}
                  >
                    Mark planted
                  </button>
                  <button
                    type="button"
                    className="texty small"
                    onClick={() => props.onRemove([planting.id])}
                    disabled={props.busy}
                    aria-label={`Remove planned ${planting.crop}`}
                  >
                    Remove
                  </button>
                </span>
              </div>
            );
          })}
          <p className="quiet small">
            A plan only counts as planted once it's confirmed: someone texts that they planted it, or you click Mark
            planted. Until then it stays a plan, even after its date.
          </p>
        </section>
      ) : null}

      {props.mode !== "past" && a.permanent ? (
        <section className="block">
          <h3>Perennial plot</h3>
          <p className="quiet small">
            {permanentNote([...new Set(a.current.map((p) => p.crop))])}
          </p>
        </section>
      ) : null}

      {props.mode === "past" ? null : (
        <PlantSearch
          bed={bed}
          advice={a}
          occupant={occupant}
          future={props.mode === "future"}
          thisYear={data.today.slice(0, 4)}
          location={data.layout.location}
          sprites={data.sprites}
          busy={props.busy}
          onPlan={props.onPlan}
        />
      )}

      {props.mode === "past" || a.permanent ? null : <GeminiIdeas {...props} bed={bed} occupant={occupant} />}

      {props.mode === "past" || a.permanent ? null : (
      <section className="block">
        <h3>
          {occupant ? `Add to this bed (free ${shortDate(a.freeFrom)})` : "Suggested for this bed"}
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
                  {rec.now ? (props.mode === "future" ? "Plant then" : "Plant now") : `From ${shortDate(rec.soonest, rec.soonest.slice(0, 4) !== data.today.slice(0, 4))}`}
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
                {occupant ? (
                  <span className="rec-actions">
                    <button
                      type="button"
                      className="pill"
                      onClick={() => props.onPlan(bed.id, rec.crop, "replace")}
                      disabled={props.busy}
                      title={`Take out the ${occupant} and plant ${rec.crop} instead`}
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      className="pill"
                      onClick={() => props.onPlan(bed.id, rec.crop, "alongside")}
                      disabled={props.busy}
                      title={`Share the bed with the ${occupant}, from ${shortDate(rec.alongsideOn, true)}`}
                    >
                      Alongside
                    </button>
                    <button
                      type="button"
                      className="pill"
                      onClick={() => props.onPlan(bed.id, rec.crop, "after")}
                      disabled={props.busy}
                      title={`After the ${occupant}, from ${shortDate(rec.plantOn, true)}`}
                    >
                      After
                    </button>
                  </span>
                ) : (
                  <button type="button" className="pill" onClick={() => props.onPlan(bed.id, rec.crop)} disabled={props.busy}>
                    Add to plan
                  </button>
                )}
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

type IdeasState = { status: "idle" } | { status: "busy" } | { status: "done"; ideas: BedIdea[] } | { status: "error"; message: string };

/** Answers already fetched this session, by bed and date, so reopening a bed doesn't spend another request. */
const ideaCache = new Map<string, BedIdea[]>();

/**
 * Crops Gemini suggests for this bed on the date shown: right for the month and season, good neighbors for
 * what's in and next to the bed, and never from a family rotation rules out (the server checks).
 * Only asks when the button is pressed, to save the daily quota.
 */
function GeminiIdeas(props: Parameters<typeof PlantList>[0] & { bed: Bed; occupant: string | null }) {
  const { bed, data, occupant } = props;
  const key = `${bed.id}|${data.today}`;
  const fromCache = (): IdeasState => {
    const cached = ideaCache.get(key);
    return cached ? { status: "done", ideas: cached } : { status: "idle" };
  };
  const [state, setState] = useState<IdeasState>(fromCache);
  // Moving the timeline to another date shows that date's answer (or the button again).
  const [stateKey, setStateKey] = useState(key);
  if (stateKey !== key) {
    setStateKey(key);
    setState(fromCache());
  }
  const shown = state;

  async function ask() {
    setState({ status: "busy" });
    try {
      const response = await fetch(`/api/beds/${bed.id}/ideas`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ day: data.today }),
      });
      const body = (await response.json().catch(() => ({}))) as { ideas?: BedIdea[]; error?: string };
      if (!response.ok || !body.ideas) throw new Error(body.error || "Couldn't get ideas from Gemini.");
      ideaCache.set(key, body.ideas);
      setState({ status: "done", ideas: body.ideas });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "Couldn't get ideas from Gemini." });
    }
  }

  const earliest = data.today;
  return (
    <section className="block ideas">
      <h3>Ideas from Gemini</h3>
      {shown.status === "done" ? (
        <>
          <div className="recs">
            {shown.ideas.map((idea) => (
              <article
                key={idea.crop}
                className="rec idea"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(CROP_MIME, idea.crop);
                  event.dataTransfer.setData("text/plain", idea.crop);
                  event.dataTransfer.effectAllowed = "copy";
                }}
              >
                <header>
                  <Sprite crop={idea.crop} sprites={data.sprites} size={30} />
                  <strong>{title(idea.crop)}</strong>
                  <span className={idea.plantOn <= earliest || idea.plantOn === nextDay(earliest) ? "chip now" : "chip"}>
                    {idea.plantOn <= earliest || idea.plantOn === nextDay(earliest)
                      ? props.mode === "future"
                        ? "Plant then"
                        : "Plant now"
                      : `From ${shortDate(idea.plantOn, idea.plantOn.slice(0, 4) !== data.today.slice(0, 4))}`}
                  </span>
                </header>
                <ul className="why">
                  <li>{idea.reason}</li>
                  {idea.neighbors ? <li>{idea.neighbors}</li> : null}
                </ul>
                {idea.known ? null : (
                  <p className="idea-new">New to this app: no drawing yet, and check its rotation yourself.</p>
                )}
                <footer>
                  <a href={seedLink(idea.crop, data.layout.location)} target="_blank" rel="noreferrer">
                    Find seeds nearby ↗
                  </a>
                  {occupant ? (
                    <span className="rec-actions">
                      <button type="button" className="pill" onClick={() => props.onPlan(bed.id, idea.crop, "replace")} disabled={props.busy} title={`Take out the ${occupant} and plant ${idea.crop} instead`}>
                        Replace
                      </button>
                      <button type="button" className="pill" onClick={() => props.onPlan(bed.id, idea.crop, "alongside")} disabled={props.busy} title={`Share the bed with the ${occupant}`}>
                        Alongside
                      </button>
                      <button type="button" className="pill" onClick={() => props.onPlan(bed.id, idea.crop, "after")} disabled={props.busy} title={`After the ${occupant}`}>
                        After
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="pill" onClick={() => props.onPlan(bed.id, idea.crop)} disabled={props.busy}>
                      Add to plan
                    </button>
                  )}
                </footer>
              </article>
            ))}
          </div>
          <button type="button" className="texty small" onClick={() => void ask()}>
            Ask again
          </button>
        </>
      ) : (
        <div className="ideas-ask">
          <p className="quiet small">
            Gemini looks up crops for {shortDate(data.today, true)}: what suits the season
            {data.layout.location ? ` near ${data.layout.location}` : ""}, and what grows well next to
            {occupant ? ` the ${occupant}` : " the beds around it"}. Rotation is still checked.
            {data.layout.location ? "" : " Set your town under Near in Edit layout for local advice."}
          </p>
          <button type="button" className="pill" onClick={() => void ask()} disabled={shown.status === "busy"}>
            {shown.status === "busy" ? "Asking Gemini…" : "Ask Gemini"}
          </button>
          {shown.status === "error" ? <p className="ideas-error" role="alert">{shown.message}</p> : null}
        </div>
      )}
    </section>
  );
}

function nextDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
