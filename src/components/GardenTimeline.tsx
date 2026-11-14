"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { Planting } from "@/lib/types";

const DAY_MS = 86_400_000;
/** How many months the slider shows at once, and how far the ‹ › buttons move it. */
const WINDOW_MONTHS = 6;
const STEP_MONTHS = 3;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

function firstOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/** The window shown around a date: starts on the 1st, two months before it. */
function windowAround(day: string): string {
  return firstOfMonth(shiftMonths(day, -2));
}

/** How far the timeline can go: back to two seasons before this one (or the first planting), ahead five years. */
export function timelineRange(today: string, plantings: Planting[]): { start: string; end: string } {
  const year = Number(today.slice(0, 4));
  const dates = plantings.map((p) => p.planted_date).sort();
  let start = `${year - 2}-01-01`;
  if (dates[0] && dates[0] < start) start = `${dates[0].slice(0, 4)}-01-01`;
  let end = `${year + 5}-12-31`;
  const latest = dates.at(-1);
  if (latest && latest > end) end = `${latest.slice(0, 4)}-12-31`;
  return { start, end };
}

export function GardenTimeline(props: {
  today: string;
  day: string;
  plantings: Planting[];
  onChange: (day: string) => void;
}) {
  const { today, day } = props;
  const range = timelineRange(today, props.plantings);
  const clamp = (d: string) => (d < range.start ? range.start : d > range.end ? range.end : d);
  const go = (d: string) => props.onChange(clamp(d));

  // The six months on screen. Follows the date when it moves out of view (Month buttons, Today, a link).
  const [start, setStart] = useState(() => windowAround(day));
  const end = fromMs(toMs(shiftMonths(start, WINDOW_MONTHS)) - DAY_MS);
  useEffect(() => {
    if (day < start || day > end) setStart(windowAround(day));
  }, [day, start, end]);

  // ‹ › move the window three months and take the date with it.
  function step(direction: -1 | 1) {
    setStart(shiftMonths(start, direction * STEP_MONTHS));
    go(shiftMonths(day, direction * STEP_MONTHS));
  }

  const total = Math.round((toMs(end) - toMs(start)) / DAY_MS);
  const at = (d: string) => Math.min(100, Math.max(0, ((toMs(d) - toMs(start)) / DAY_MS / total) * 100));
  const inView = (d: string) => d >= start && d <= end;

  const months = Array.from({ length: WINDOW_MONTHS }, (_, i) => shiftMonths(start, i));

  const mode = day === today ? "today" : day < today ? "past" : "future";
  const caption =
    mode === "today" ? "Today" : mode === "past" ? "Looking back · view only" : "Planning ahead · drop crops on beds to plan them for this date";

  // One dot per planting, at the day it went in (or is planned to).
  const marks = props.plantings
    .filter((p) => inView(p.planted_date))
    .map((p) => ({ id: p.id, left: at(p.planted_date), plan: p.planted_date > today && !p.removed_date, crop: p.crop, date: p.planted_date }));

  const todayLeft = inView(today) ? `${at(today)}%` : today < start ? "0%" : "100%";

  return (
    <section className={`timeline ${mode}`} aria-label="Garden timeline" style={{ "--today": todayLeft } as CSSProperties}>
      <div className="timeline-head">
        <div className="timeline-date">
          <strong>{longDate(day)}</strong>
          <span>{caption}</span>
        </div>
        <div className="timeline-steps">
          <button type="button" className="icon-btn" onClick={() => go(shiftMonths(day, -1))} disabled={day <= range.start} aria-label="One month earlier">
            ‹ Month
          </button>
          <button type="button" className={mode === "today" ? "icon-btn on" : "icon-btn"} onClick={() => go(today)} disabled={mode === "today"}>
            Today
          </button>
          <button type="button" className="icon-btn" onClick={() => go(shiftMonths(day, 1))} disabled={day >= range.end} aria-label="One month later">
            Month ›
          </button>
        </div>
      </div>
      <div className="timeline-body">
        <button
          type="button"
          className="timeline-page"
          onClick={() => step(-1)}
          disabled={start <= range.start}
          aria-label="Three months earlier"
          title="Three months earlier"
        >
          ‹
        </button>
        <div className="timeline-track">
          <div className="timeline-rail" aria-hidden="true">
            {months.map((m) => (
              <i key={m} className={m.endsWith("-01-01") ? "tick year" : "tick"} style={{ left: `${at(m)}%` }} />
            ))}
            {marks.map((mark) => (
              <b key={mark.id} className={mark.plan ? "mark plan" : "mark"} style={{ left: `${mark.left}%` }} title={`${mark.crop}, ${longDate(mark.date)}`} />
            ))}
            {inView(today) ? <span className="today-line" style={{ left: `${at(today)}%` }} /> : null}
          </div>
          <input
            type="range"
            min={0}
            max={total}
            step={1}
            value={Math.round((Math.min(Math.max(toMs(day), toMs(start)), toMs(end)) - toMs(start)) / DAY_MS)}
            onChange={(event) => go(fromMs(toMs(start) + Number(event.target.value) * DAY_MS))}
            aria-label="Date shown on the map"
            aria-valuetext={`${longDate(day)}, ${caption}`}
          />
          <div className="timeline-years" aria-hidden="true">
            {months.map((m, i) => {
              const month = Number(m.slice(5, 7));
              const label = i === 0 || month === 1 ? `${MONTHS[month - 1]} ${m.slice(0, 4)}` : MONTHS[month - 1];
              return (
                <button
                  type="button"
                  key={m}
                  tabIndex={-1}
                  style={{ left: `${at(m)}%` }}
                  onClick={() => go(shiftMonths(m, 0).slice(0, 8) + String(Math.min(Number(day.slice(8, 10)), 28)).padStart(2, "0"))}
                  title={`Jump to ${MONTHS[month - 1]} ${m.slice(0, 4)}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          className="timeline-page"
          onClick={() => step(1)}
          disabled={end >= range.end}
          aria-label="Three months later"
          title="Three months later"
        >
          ›
        </button>
      </div>
    </section>
  );
}
