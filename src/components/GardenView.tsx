"use client";

import { useEffect, useMemo, useState } from "react";
import { DropChoice } from "@/components/DropChoice";
import { GardenMap } from "@/components/GardenMap";
import { RemoveChoice } from "@/components/RemoveChoice";
import { GardenTimeline, timelineRange } from "@/components/GardenTimeline";
import { PlantList } from "@/components/PlantList";
import { SketchImport } from "@/components/SketchImport";
import { ViewTabs } from "@/components/ViewTabs";
import type { GardenData } from "@/lib/garden-data";
import { canDelete, clearing, cropsInPatch, dropSituation, isEstablished, replacementDate, type Occupant } from "@/lib/drop-plan";
import { adviseBed, guideFor, type Recommendation } from "@/lib/recommend";
import type { Bed, GardenLayout } from "@/lib/types";

async function send<T>(url: string, method: string, body?: unknown): Promise<T | null> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return null;
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "That didn't save.");
  return data;
}

export function GardenView({ initial }: { initial: GardenData }) {
  const [data, setData] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importing, setImporting] = useState(false);
  // The date the map shows. The timeline moves it into the past (view only) or the future (to plan).
  const [day, setDay] = useState(initial.today);
  // A crop dropped on a patch that already has something established in it (or several crops), waiting for a choice.
  const [dropping, setDropping] = useState<{ bedId: string; crop: string; there: Occupant[] } | null>(null);
  // Delete pressed on a patch with several crops, waiting for which to remove.
  const [removing, setRemoving] = useState<{ bedId: string; there: Occupant[] } | null>(null);
  const mode: "past" | "today" | "future" = day === data.today ? "today" : day < data.today ? "past" : "future";

  // Escape deselects. Delete or Backspace removes the selected patch itself in Edit layout; otherwise it removes
  // the patch's plant (asking which, if there are several).
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedId(null);
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (!selectedId || mode === "past" || busy || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      const bed = data.beds.find((item) => item.id === selectedId);
      if (editing) {
        if (bed) deleteBed(bed);
        return;
      }
      const there = cropsInPatch(selectedId, data.plantings, day, data.today);
      if (!there.length) {
        setNotice(`Nothing growing or planned in ${bed?.name ?? "this bed"} to remove.`);
        return;
      }
      if (there.length === 1) removeCrops([there[0].id]);
      else setRemoving({ bedId: selectedId, there: there.map((planting) => ({ planting, established: isEstablished(planting, day) })) });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Re-attached each render so it always sees the current selection, date, and data.
  });

  // A link like /garden?day=2027-05-01 opens the timeline on that date.
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("day");
    if (asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && !Number.isNaN(Date.parse(`${asked}T12:00:00Z`))) {
      const { start, end } = timelineRange(initial.today, initial.plantings);
      setDay(asked < start ? start : asked > end ? end : asked);
    }
  }, [initial.today, initial.plantings]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function reload() {
    const response = await fetch("/api/garden", { cache: "no-store" });
    if (response.ok) setData((await response.json()) as GardenData);
  }

  async function run(job: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await job();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save.");
      await reload().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  const advice = useMemo(() => {
    const map = new Map<string, ReturnType<typeof adviseBed>>();
    for (const bed of data.beds) map.set(bed.id, adviseBed(bed, data.plantings, day, data.today));
    return map;
  }, [data.beds, data.plantings, day, data.today]);

  // What the plant list sees: the garden as of `day`. Priority tasks are about right now, so they only show today.
  const shown = useMemo<GardenData>(() => {
    const end = `${day}T23:59:59`;
    return {
      ...data,
      today: day,
      tasks: day === data.today ? data.tasks : [],
      sessions: data.sessions.filter((session) => session.start.slice(0, 19) <= end),
      photos: data.photos.filter((photo) => photo.taken_at.slice(0, 19) <= end),
    };
  }, [data, day]);

  function showDay(next: string) {
    setDay(next);
    if (next < data.today) setEditing(false);
  }

  const selected = data.beds.find((bed) => bed.id === selectedId) ?? null;

  function moveBed(bed: Bed, geometry: NonNullable<Bed["geometry"]>) {
    setData((prev) => ({ ...prev, beds: prev.beds.map((item) => (item.id === bed.id ? { ...item, geometry } : item)) }));
    run(async () => {
      await send(`/api/beds/${bed.id}`, "PATCH", { geometry });
    });
  }

  /** Plan a crop in a bed: "after" waits until the bed is free; "alongside" shares the bed with what's there. */
  function plan(bedId: string, crop: string, how: "after" | "alongside" = "after") {
    const bed = data.beds.find((item) => item.id === bedId);
    if (!bed || mode === "past") return;
    const rec: Recommendation | undefined = advice.get(bedId)?.recommendations.find((item) => item.crop === crop);
    const avoided = advice.get(bedId)?.avoid.find((item) => item.crop === crop);
    if (avoided && !window.confirm(`${avoided.reason} Plan ${crop} here anyway?`)) return;
    const best = how === "alongside" ? (rec?.alongsideOn ?? day) : (rec?.plantOn ?? advice.get(bedId)?.freeFrom ?? day);
    const date = best > data.today ? best : addOne(data.today);
    const company = advice.get(bedId)?.current.map((p) => p.crop).filter((c) => c !== crop) ?? [];
    const label = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    run(async () => {
      await send("/api/plantings", "POST", { bed_id: bedId, crop, planted_date: date });
      setSelectedId(bedId);
      setNotice(
        how === "alongside" && company.length
          ? `Planned ${crop} alongside the ${company.join(" and ")} in ${bed.name} on ${label}.`
          : `Planned ${crop} for ${bed.name} on ${label}.`,
      );
    });
  }

  /**
   * Remove a patch from the map, with any plans in it that haven't started. A patch with real planting history
   * stays (rotation needs it), the same rule the server enforces; say so up front instead of asking first.
   */
  function deleteBed(bed: Bed) {
    const mine = data.plantings.filter((planting) => planting.bed_id === bed.id);
    if (mine.some((planting) => !canDelete(planting, data.today))) {
      setError(`${bed.name} has planting history, so it stays. Rename or move it instead.`);
      return;
    }
    const plans = [...new Set(mine.map((planting) => planting.crop))];
    const question = plans.length
      ? `Remove ${bed.name} from the map, and its plan for ${plans.join(" and ")}?`
      : `Remove ${bed.name} from the map?`;
    if (!window.confirm(question)) return;
    run(async () => {
      await send(`/api/beds/${bed.id}`, "DELETE");
      setSelectedId(null);
      setNotice(`Removed ${bed.name}.`);
    });
  }

  /** Take crops out: plans that haven't started are deleted; anything planted is marked pulled on the date shown. */
  function removeCrops(plantingIds: string[]) {
    if (mode === "past") return;
    const old = data.plantings.filter((p) => plantingIds.includes(p.id));
    if (!old.length) return;
    const bed = data.beds.find((item) => item.id === old[0].bed_id);
    const steps = old.map((p) => ({ planting: p, how: clearing(p, day, data.today) }));
    const pulled = steps.filter((s) => s.how.action === "pull").map((s) => s.planting.crop);
    if (pulled.length && !window.confirm(`Mark the ${[...new Set(pulled)].join(" and ")} pulled on ${longDate(day)}? It stays in ${bed?.name ?? "the bed"}'s history.`)) return;
    const names = [...new Set(old.map((p) => p.crop))].join(" and ");
    run(async () => {
      for (const { planting, how } of steps) {
        if (how.action === "delete") await send(`/api/plantings/${planting.id}`, "DELETE");
        else await send(`/api/plantings/${planting.id}`, "PATCH", { removed_date: how.on });
      }
      setNotice(`Removed the ${names} from ${bed?.name ?? "the bed"}.`);
    });
  }

  /** The buttons on a suggestion card. Replace swaps what's in the patch (asking which, if there are several). */
  function planFromCard(bedId: string, crop: string, how: "after" | "alongside" | "replace" = "after") {
    if (how !== "replace") return plan(bedId, crop, how);
    if (mode === "past") return;
    const there = cropsInPatch(bedId, data.plantings, day, data.today);
    if (!there.length) return plan(bedId, crop, "after");
    if (there.length === 1) return replace(bedId, crop, [there[0].id]);
    setDropping({ bedId, crop, there: there.map((planting) => ({ planting, established: isEstablished(planting, day) })) });
  }

  /**
   * Dropping a crop on a patch, as of the timeline date: an empty patch gets it planned as usual; a single crop that
   * hasn't been in the ground a full day is swapped without asking; anything else asks (replace, after, alongside).
   */
  function dropCrop(bedId: string, crop: string) {
    if (mode === "past") return;
    const situation = dropSituation(bedId, data.plantings, day, data.today);
    if (situation.kind === "empty") plan(bedId, crop, "after");
    else if (situation.kind === "replace") replace(bedId, crop, [situation.old.id]);
    else setDropping({ bedId, crop, there: situation.there });
  }

  /** Swap crops out of a patch: fresh plans are deleted, anything real or established is marked pulled. */
  function replace(bedId: string, crop: string, plantingIds: string[]) {
    const bed = data.beds.find((item) => item.id === bedId);
    const old = data.plantings.filter((p) => plantingIds.includes(p.id));
    if (!bed || !old.length) return;
    const steps = old.map((p) => ({ planting: p, how: clearing(p, day, data.today) }));
    // Rotation is checked as if the deleted plans had never been there.
    const deleted = new Set(steps.filter((s) => s.how.action === "delete").map((s) => s.planting.id));
    const avoided = adviseBed(bed, data.plantings.filter((p) => !deleted.has(p.id)), day, data.today).avoid.find((item) => item.crop === crop);
    if (avoided && !window.confirm(`${avoided.reason} Plant ${crop} here anyway?`)) return;
    const date = replacementDate(old, day, data.today, guideFor(crop)?.sowMonths);
    const swapped = [...new Set(old.map((p) => p.crop))].join(" and ");
    run(async () => {
      for (const { planting, how } of steps) {
        if (how.action === "delete") await send(`/api/plantings/${planting.id}`, "DELETE");
        else await send(`/api/plantings/${planting.id}`, "PATCH", { removed_date: how.on });
      }
      await send("/api/plantings", "POST", { bed_id: bedId, crop, planted_date: date });
      setSelectedId(bedId);
      setNotice(`Replaced the ${swapped} in ${bed.name} with ${crop}, from ${longDate(date)}.`);
    });
  }

  const dropBed = dropping ? data.beds.find((bed) => bed.id === dropping.bedId) : null;
  const dropRec = dropping ? advice.get(dropping.bedId)?.recommendations.find((item) => item.crop === dropping.crop) : undefined;
  const tomorrow = addOne(data.today);
  const notBeforeTomorrow = (d: string) => (d > data.today ? d : tomorrow);

  return (
    <div className="app garden-app">
      <header className="top">
        <div className="brand">
          <span className="leaf" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="28" height="28">
              <path d="M6 20c8-1 12-8 18-14-1 10-6 16-14 18 2 2 4 4 4 6H8c0-3-1-6-2-10z" fill="#3f7d3a" />
              <path d="M10 22c4-1 7-5 9-9" fill="none" stroke="#e7f0d8" strokeWidth="1.4" />
            </svg>
          </span>
          <div>
            <p className="eyebrow">GWCV garden</p>
            <h1>Garden view</h1>
          </div>
          <ViewTabs current="garden" />
        </div>
        <div className="garden-actions">
          {notice ? <span className="toast" role="status">{notice}</span> : null}
          <button
            type="button"
            className={editing ? "pill on" : "pill"}
            onClick={() => setEditing((value) => !value)}
            aria-pressed={editing}
            disabled={mode === "past"}
            title={mode === "past" ? "Go back to today to change the layout" : undefined}
          >
            {editing ? "Done editing" : "Edit layout"}
          </button>
        </div>
      </header>
      {error ? <p className="banner">{error}</p> : null}
      <div className="garden-workspace">
        <div className="garden-main">
        <GardenTimeline today={data.today} day={day} plantings={data.plantings} onChange={showDay} />
        <GardenMap
          layout={data.layout}
          beds={data.beds}
          plantings={data.plantings}
          tasks={shown.tasks}
          today={data.today}
          day={day}
          sprites={data.sprites}
          selectedId={selectedId}
          editing={editing}
          busy={busy}
          onSelect={setSelectedId}
          onMove={moveBed}
          onDropCrop={dropCrop}
          onImport={() => setImporting(true)}
          onAddBed={() =>
            run(async () => {
              const bed = await send<Bed>("/api/beds", "POST", {});
              if (bed) setSelectedId(bed.id);
            })
          }
          onLayout={(patch: Partial<GardenLayout> & { imageDataUrl?: string | null }) =>
            run(async () => {
              await send("/api/layout", "PUT", patch);
            })
          }
        />
        </div>
        <PlantList
          data={shown}
          mode={mode}
          advice={advice}
          selected={selected}
          editing={editing}
          busy={busy}
          onSelect={setSelectedId}
          onPlan={planFromCard}
          onRename={(bed, name) =>
            run(async () => {
              await send(`/api/beds/${bed.id}`, "PATCH", { name });
            })
          }
          onDeleteBed={deleteBed}
          onRemove={removeCrops}
        />
      </div>
      {removing ? (
        <RemoveChoice
          key={removing.bedId}
          bedName={data.beds.find((bed) => bed.id === removing.bedId)?.name ?? "this bed"}
          there={removing.there}
          sprites={data.sprites}
          busy={busy}
          onRemove={(ids) => {
            setRemoving(null);
            removeCrops(ids);
          }}
          onCancel={() => setRemoving(null)}
        />
      ) : null}
      {dropping && dropBed ? (
        <DropChoice
          key={`${dropping.bedId}-${dropping.crop}`}
          bedName={dropBed.name}
          crop={dropping.crop}
          there={dropping.there}
          sprites={data.sprites}
          busy={busy}
          dates={{
            replace: replacementDate(
              dropping.there.map((o) => o.planting),
              day,
              data.today,
              guideFor(dropping.crop)?.sowMonths,
            ),
            after: notBeforeTomorrow(dropRec?.plantOn ?? advice.get(dropping.bedId)?.freeFrom ?? day),
            alongside: notBeforeTomorrow(dropRec?.alongsideOn ?? day),
          }}
          onReplace={(ids) => {
            const { bedId, crop } = dropping;
            setDropping(null);
            replace(bedId, crop, ids);
          }}
          onAfter={() => {
            const { bedId, crop } = dropping;
            setDropping(null);
            plan(bedId, crop, "after");
          }}
          onAlongside={() => {
            const { bedId, crop } = dropping;
            setDropping(null);
            plan(bedId, crop, "alongside");
          }}
          onCancel={() => setDropping(null)}
        />
      ) : null}
      <SketchImport
        open={importing}
        layout={data.layout}
        onClose={() => setImporting(false)}
        onDone={(result) => {
          setImporting(false);
          setSelectedId(null);
          const bits = [
            result.created ? `${result.created} new bed${result.created === 1 ? "" : "s"}` : "",
            result.moved ? `${result.moved} moved` : "",
            result.removed ? `${result.removed} removed` : "",
            result.archived.length ? `${result.archived.length} archived` : "",
          ].filter(Boolean);
          setNotice(`Garden built: ${bits.join(", ") || "no changes"}.`);
          void reload();
        }}
      />
    </div>
  );
}

function addOne(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function longDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
