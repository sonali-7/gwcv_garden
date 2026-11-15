"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  DAY_END,
  DAY_START,
  HOUR_PX,
  VIEW_START,
  dayNumber,
  hourLabel,
  placeSlices,
  sessionStatus,
  sessionTouchesWeek,
  slicesForSession,
} from "@/lib/calendar";
import { eventSubtitle, planPhrase } from "@/lib/phrases";
import { addDays, partsInZone, weekdayShort, ymd } from "@/lib/time";
import type { Bed, Photo, Planting, PublicPerson, WorkSession } from "@/lib/types";
import { DetailCard } from "@/components/DetailCard";

export function CalendarView({
  weekStart,
  today,
  timezone,
  people,
  sessions,
  plantings,
  beds,
  photos,
  selectedId,
  highlightBedId,
  onSelect,
}: {
  weekStart: string;
  today: string;
  timezone: string;
  people: PublicPerson[];
  sessions: WorkSession[];
  plantings: Planting[];
  beds: Bed[];
  photos: Photo[];
  selectedId: string | null;
  highlightBedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  // Client-only clock so SSR and the first client paint don't disagree on the now-line.
  const [clock, setClock] = useState<number | null>(null);

  useEffect(() => {
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = VIEW_START * HOUR_PX;
  }, [weekStart]);

  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const visible = sessions.filter((session) => sessionTouchesWeek(session, weekStart, timezone));
  const placed = placeSlices(visible.flatMap((session) => slicesForSession(session, weekStart, timezone)));
  const hours = Array.from({ length: DAY_END - DAY_START }, (_, index) => DAY_START + index);
  const gridHeight = (DAY_END - DAY_START) * HOUR_PX;
  // Until the client clock mounts, use noon on `today` so event status classes hydrate cleanly.
  const now = clock != null ? new Date(clock) : new Date(`${today}T12:00:00`);
  const liveClock = clock != null;
  const nowParts = partsInZone(now, timezone);
  const nowDay = ymd(nowParts);
  const showNow = liveClock && days.includes(nowDay);
  const nowTop = ((nowParts.hour * 60 + nowParts.minute) / 60) * HOUR_PX;
  const selected = sessions.find((session) => session.id === selectedId) ?? null;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!selectedId || !root) {
      setBox(null);
      return;
    }
    const button = root.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(selectedId)}"]`);
    if (!button) {
      setBox(null);
      return;
    }
    const host = root.getBoundingClientRect();
    const block = button.getBoundingClientRect();
    const width = 280;
    let left = block.left - host.left;
    if (left + width > host.width - 8) left = Math.max(8, host.width - width - 8);
    const roomBelow = host.bottom - block.bottom;
    if (roomBelow < 210) {
      setBox({ bottom: host.bottom - block.top + 8, left });
    } else {
      setBox({ top: block.bottom - host.top + 8, left });
    }
  }, [selectedId, weekStart, sessions]);

  useEffect(() => {
    if (!selectedId) return;
    function down(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".event")) return;
      onSelect(null);
    }
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [selectedId, onSelect]);

  return (
    <div className="calendar" ref={rootRef}>
      <div className="cal-legend">
        {people.map((person) => (
          <span key={person.id}>
            <i style={{ background: person.color }} />
            {person.name}
          </span>
        ))}
        <span className="status-key">
          <span><i className="key done" />Done</span>
          <span><i className="key now" />Now</span>
          <span><i className="key planned" />Planned</span>
        </span>
      </div>
      <div className="cal-scroll" ref={scrollRef}>
        <div className="cal-grid" style={{ ["--hour" as string]: `${HOUR_PX}px` }}>
          <div className="gutter-head" />
          {days.map((day) => (
            <div key={day} className={day === today ? "day-head today" : "day-head"}>
              <span>{weekdayShort(day)}</span>
              <strong>{dayNumber(day)}</strong>
            </div>
          ))}
          <div className="gutter" style={{ height: gridHeight }}>
            {hours.map((hour) => (
              <span key={hour} style={{ top: (hour - DAY_START) * HOUR_PX }}>
                {hourLabel(hour)}
              </span>
            ))}
          </div>
          {days.map((day) => (
            <div key={day} className={day === today ? "day-col today" : "day-col"} style={{ height: gridHeight }}>
              {hours.map((hour) => (
                <div key={hour} className="hour-line" style={{ top: (hour - DAY_START) * HOUR_PX }} />
              ))}
              {showNow && day === nowDay ? <div className="now-line" style={{ top: nowTop }} /> : null}
              {placed
                .filter((slice) => slice.day === day)
                .map((slice) => {
                  const session = sessions.find((item) => item.id === slice.sessionId);
                  const person = people.find((item) => item.id === session?.person_id);
                  if (!session || !person) return null;
                  const planting = plantings.find((item) => item.id === session.planting_id);
                  const status = sessionStatus(session, now);
                  const subtitle =
                    status === "planned"
                      ? planPhrase(session.activity_type, planting?.crop ?? null, null)
                      : eventSubtitle(session.activity_type, planting?.crop ?? null);
                  const isSelected = session.id === selectedId;
                  const related = Boolean(highlightBedId && session.bed_id === highlightBedId);
                  const inset = slice.lanes > 1 ? 1 : 0;
                  return (
                    <button
                      key={`${slice.sessionId}-${slice.day}`}
                      type="button"
                      data-session-id={session.id}
                      className={`event ${status}${isSelected ? " selected" : ""}${related && !isSelected ? " related" : ""}${slice.heightPx >= 42 ? " tall" : ""}`}
                      style={{
                        top: slice.topPx,
                        height: slice.heightPx,
                        ["--who" as string]: person.color,
                        left: `calc(${slice.lane} * (100% / ${slice.lanes}) + ${inset}px)`,
                        width: `calc(100% / ${slice.lanes} - ${inset * 2}px)`,
                      }}
                      title={`${person.name} · ${status === "done" ? "done" : status === "now" ? "happening now" : "planned"}`}
                      onClick={() => onSelect(isSelected ? null : session.id)}
                    >
                      <span className="event-name">
                        {status === "now" ? <b className="live-dot" aria-hidden="true" /> : null}
                        {person.name}
                      </span>
                      <span className="event-sub">{subtitle}</span>
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
      {selected && box ? (
        <div
          className="session-pop"
          ref={popRef}
          role="dialog"
          aria-label="Session"
          style={{ top: box.top, bottom: box.bottom, left: box.left }}
        >
          <button type="button" className="pop-x" onClick={() => onSelect(null)} aria-label="Close">
            ×
          </button>
          <DetailCard
            session={selected}
            task={null}
            people={people}
            beds={beds}
            plantings={plantings}
            photos={photos}
            timezone={timezone}
            now={now}
          />
        </div>
      ) : null}
    </div>
  );
}
