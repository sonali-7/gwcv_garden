"use client";

import { useEffect, useMemo, useState } from "react";
import { GardenMap } from "@/components/GardenMap";
import { GardenTimeline, timelineRange } from "@/components/GardenTimeline";
import { PlantList } from "@/components/PlantList";
import { SketchImport } from "@/components/SketchImport";
import { ViewTabs } from "@/components/ViewTabs";
import type { GardenData } from "@/lib/garden-data";
import { adviseBed, type Recommendation } from "@/lib/recommend";
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
  const mode: "past" | "today" | "future" = day === data.today ? "today" : day < data.today ? "past" : "future";

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      <GardenTimeline today={data.today} day={day} plantings={data.plantings} onChange={showDay} />
      <div className="garden-workspace">
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
          onDropCrop={plan}
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
        <PlantList
          data={shown}
          mode={mode}
          advice={advice}
          selected={selected}
          editing={editing}
          busy={busy}
          onSelect={setSelectedId}
          onPlan={plan}
          onRename={(bed, name) =>
            run(async () => {
              await send(`/api/beds/${bed.id}`, "PATCH", { name });
            })
          }
          onDeleteBed={(bed) => {
            if (!window.confirm(`Remove ${bed.name} from the map?`)) return;
            run(async () => {
              await send(`/api/beds/${bed.id}`, "DELETE");
              setSelectedId(null);
            });
          }}
          onUnplan={(id) =>
            run(async () => {
              await send(`/api/plantings/${id}`, "DELETE");
            })
          }
        />
      </div>
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
