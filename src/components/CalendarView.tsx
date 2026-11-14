"use client";

import {
  DAY_END,
  DAY_START,
  HOUR_PX,
  dayNumber,
  hourLabel,
  outsideDayGrid,
  placeSlices,
  sessionTouchesWeek,
  slicesForSession,
} from "@/lib/calendar";
import { eventSubtitle } from "@/lib/phrases";
import { addDays, partsInZone, weekdayShort, ymd } from "@/lib/time";
import type { Planting, PublicPerson, WorkSession } from "@/lib/types";

export function CalendarView({
  weekStart,
  today,
  timezone,
  people,
  sessions,
  plantings,
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
  selectedId: string | null;
  highlightBedId: string | null;
  onSelect: (id: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const visible = sessions.filter((session) => sessionTouchesWeek(session, weekStart, timezone));
  const placed = placeSlices(visible.flatMap((session) => slicesForSession(session, weekStart, timezone)));
  const offHours = visible.filter((session) => outsideDayGrid(session, weekStart, timezone));
  const hours = Array.from({ length: DAY_END - DAY_START + 1 }, (_, index) => DAY_START + index);
  const now = new Date();
  const nowParts = partsInZone(now, timezone);
  const nowDay = ymd(nowParts);
  const showNow = days.includes(nowDay) && nowParts.hour >= DAY_START && nowParts.hour < DAY_END;
  const nowTop = ((nowParts.hour - DAY_START) * 60 + nowParts.minute) / 60 * HOUR_PX;

  return (
    <div className="calendar">
      <div className="cal-legend">
        {people.map((person) => (
          <span key={person.id}>
            <i style={{ background: person.color }} />
            {person.name}
          </span>
        ))}
      </div>
      <div className="cal-scroll">
        <div className="cal-grid" style={{ ["--hour" as string]: `${HOUR_PX}px` }}>
          <div className="gutter-head" />
          {days.map((day) => (
            <div key={day} className={day === today ? "day-head today" : "day-head"}>
              <span>{weekdayShort(day)}</span>
              <strong>{dayNumber(day)}</strong>
            </div>
          ))}
          <div className="gutter" style={{ height: (DAY_END - DAY_START) * HOUR_PX }}>
            {hours.map((hour) => (
              <span key={hour} style={{ top: (hour - DAY_START) * HOUR_PX }}>
                {hourLabel(hour)}
              </span>
            ))}
          </div>
          {days.map((day) => (
            <div key={day} className={day === today ? "day-col today" : "day-col"} style={{ height: (DAY_END - DAY_START) * HOUR_PX }}>
              {hours.slice(0, -1).map((hour) => (
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
                  const subtitle = eventSubtitle(session.activity_type, planting?.crop ?? null);
                  const selected = session.id === selectedId;
                  const related = Boolean(highlightBedId && session.bed_id === highlightBedId);
                  return (
                    <button
                      key={`${slice.sessionId}-${slice.day}`}
                      type="button"
                      className={`event${selected ? " selected" : ""}${related && !selected ? " related" : ""}${slice.heightPx >= 42 ? " tall" : ""}`}
                      style={{
                        top: slice.topPx,
                        height: slice.heightPx,
                        background: person.color,
                        left: `calc(${slice.lane} * (100% / ${slice.lanes}) + 3px)`,
                        width: `calc(100% / ${slice.lanes} - 6px)`,
                      }}
                      onClick={() => onSelect(session.id)}
                    >
                      <span className="event-name">{person.name}</span>
                      <span className="event-sub">{subtitle}</span>
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
      {offHours.length > 0 ? (
        <div className="offhours">
          <span>Outside 7am–7pm</span>
          {offHours.map((session) => {
            const person = people.find((item) => item.id === session.person_id);
            return (
              <button key={session.id} type="button" onClick={() => onSelect(session.id)}>
                <i style={{ background: person?.color }} />
                {person?.name}: {session.notes}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
