"use client";

import type { CSSProperties } from "react";
import type { Planting } from "@/lib/types";

const DAY_MS = 86_400_000;

function toMs(day: string): number {
  return Date.parse(`${day}T12:00:00Z`);
}

function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function longDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Same day of the month, `n` months away (clamped to the month's last day). */
function shiftMonths(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return fromMs(Date.UTC(y, m - 1 + n, Math.min(d, last), 12));
}

/** The slider runs from Jan 1 two seasons back to Dec 31 next year, stretched to cover any plans beyond that. */
export function timelineRange(today: string, plantings: Planting[]): { start: string; end: string } {
  const year = Number(today.slice(0, 4));
  const latest = plantings.map((p) => p.planted_date).sort().at(-1);
  let end = `${year + 1}-12-31`;
  if (latest && latest > end) end = `${latest.slice(0, 4)}-12-31`;
  return { start: `${year - 2}-01-01`, end };
}

export function GardenTimeline(props: {
  today: string;
  day: string;
  plantings: Planting[];
  onChange: (day: string) => void;
}) {
  const { today, day } = props;
  const { start, end } = timelineRange(today, props.plantings);
  const total = Math.round((toMs(end) - toMs(start)) / DAY_MS);
  const at = (d: string) => Math.min(100, Math.max(0, ((toMs(d) - toMs(start)) / DAY_MS / total) * 100));
  const clamp = (d: string) => (d < start ? start : d > end ? end : d);
  const go = (d: string) => props.onChange(clamp(d));

  const years: number[] = [];
  for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) years.push(y);

  const mode = day === today ? "today" : day < today ? "past" : "future";
  const caption =
    mode === "today" ? "Today" : mode === "past" ? "Looking back · view only" : "Planning ahead · drop crops on beds to plan them for this date";

  // One dot per planting, at the day it went in (or is planned to).
  const marks = props.plantings
    .filter((p) => p.planted_date >= start && p.planted_date <= end)
    .map((p) => ({ id: p.id, left: at(p.planted_date), plan: p.planted_date > today && !p.removed_date, crop: p.crop, date: p.planted_date }));

  return (
    <section className={`timeline ${mode}`} aria-label="Garden timeline" style={{ "--today": `${at(today)}%` } as CSSProperties}>
      <div className="timeline-head">
        <div className="timeline-date">
          <strong>{longDate(day)}</strong>
          <span>{caption}</span>
        </div>
        <div className="timeline-steps">
          <button type="button" className="icon-btn" onClick={() => go(shiftMonths(day, -1))} disabled={day <= start} aria-label="One month earlier">
            ‹ Month
          </button>
          <button type="button" className={mode === "today" ? "icon-btn on" : "icon-btn"} onClick={() => go(today)} disabled={mode === "today"}>
            Today
          </button>
          <button type="button" className="icon-btn" onClick={() => go(shiftMonths(day, 1))} disabled={day >= end} aria-label="One month later">
            Month ›
          </button>
        </div>
      </div>
      <div className="timeline-track">
        <div className="timeline-rail" aria-hidden="true">
          {years.map((y) =>
            Array.from({ length: 12 }, (_, m) => {
              const d = `${y}-${String(m + 1).padStart(2, "0")}-01`;
              if (d < start || d > end) return null;
              return <i key={d} className={m === 0 ? "tick year" : "tick"} style={{ left: `${at(d)}%` }} />;
            }),
          )}
          {marks.map((mark) => (
            <b key={mark.id} className={mark.plan ? "mark plan" : "mark"} style={{ left: `${mark.left}%` }} title={`${mark.crop}, ${longDate(mark.date)}`} />
          ))}
          <span className="today-line" style={{ left: `${at(today)}%` }} />
        </div>
        <input
          type="range"
          min={0}
          max={total}
          step={1}
          value={Math.round((toMs(day) - toMs(start)) / DAY_MS)}
          onChange={(event) => go(fromMs(toMs(start) + Number(event.target.value) * DAY_MS))}
          aria-label="Date shown on the map"
          aria-valuetext={`${longDate(day)}, ${caption}`}
        />
        <div className="timeline-years" aria-hidden="true">
          {years.map((y) => (
            <button
              type="button"
              key={y}
              tabIndex={-1}
              style={{ left: `${at(`${y}-01-01`)}%` }}
              onClick={() => go(shiftMonths(today, (y - Number(today.slice(0, 4))) * 12))}
              title={`Jump to ${y}`}
            >
              {y}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
