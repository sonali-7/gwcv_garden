"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarView } from "@/components/CalendarView";
import { Phone } from "@/components/Phone";
import { PriorityPanel } from "@/components/PriorityPanel";
import { ViewTabs } from "@/components/ViewTabs";
import { addDays, formatWeekTitle, startOfWeekYmd } from "@/lib/time";
import type { DashboardData } from "@/lib/types";

export function Dashboard({ initial }: { initial: DashboardData }) {
  const [data, setData] = useState(initial);
  const [week, setWeek] = useState(initial.weekStart);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedId(null);
        setTaskId(null);
        setPhoneOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function reload(nextWeek = week) {
    const response = await fetch(`/api/dashboard?week=${nextWeek}`, { cache: "no-store" });
    if (!response.ok) throw new Error("The week didn't load.");
    const body = (await response.json()) as DashboardData;
    setData(body);
    setWeek(body.weekStart);
    return body;
  }

  async function shift(days: number) {
    setBusy(true);
    setError("");
    try {
      await reload(addDays(week, days));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The week didn't load.");
    } finally {
      setBusy(false);
    }
  }

  async function goThisWeek() {
    setBusy(true);
    setError("");
    try {
      await reload(initial.weekStart);
    } catch {
      setError("The week didn't load.");
    } finally {
      setBusy(false);
    }
  }

  async function resetDemo() {
    if (!window.confirm("Reset the demo log back to the sample week?")) return;
    setBusy(true);
    setError("");
    try {
      await fetch("/api/reset", { method: "POST" });
      await reload(initial.weekStart);
      setSelectedId(null);
      setTaskId(null);
    } catch {
      setError("Reset didn't finish.");
    } finally {
      setBusy(false);
    }
  }

  const selected = data.sessions.find((session) => session.id === selectedId) ?? null;
  const task = data.tasks.find((item) => item.id === taskId) ?? null;
  const highlightBedId = task?.bed_id ?? selected?.bed_id ?? null;
  const title = useMemo(() => formatWeekTitle(week), [week]);
  const onThisWeek = week === initial.weekStart;

  return (
    <div className="app calendar-app">
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
            <h1>Calendar view</h1>
          </div>
          <ViewTabs current="calendar" />
        </div>
        <div className="garden-actions">
          <button
            type="button"
            className={phoneOpen ? "pill on" : "pill"}
            aria-expanded={phoneOpen}
            aria-controls="phone-drawer"
            onClick={() => setPhoneOpen((open) => !open)}
          >
            {phoneOpen ? "Hide texts" : "Texts"}
          </button>
          <button type="button" className="pill" onClick={resetDemo} disabled={busy}>
            Reset demo
          </button>
        </div>
      </header>
      {error ? <p className="banner">{error}</p> : null}
      <section className={`week-bar${onThisWeek ? " current" : ""}`} aria-label="Week">
        <div className="week-bar-head">
          <div className="week-bar-date">
            <strong>{title}</strong>
            <span>{onThisWeek ? "This week" : "Browsing another week"} · Sun–Sat</span>
          </div>
          <div className="week-bar-steps">
            <button type="button" className="icon-btn" onClick={() => shift(-7)} disabled={busy} aria-label="Previous week">
              ‹ Week
            </button>
            <button
              type="button"
              className={onThisWeek ? "icon-btn on" : "icon-btn"}
              onClick={goThisWeek}
              disabled={busy || onThisWeek}
            >
              This week
            </button>
            <button type="button" className="icon-btn" onClick={() => shift(7)} disabled={busy} aria-label="Next week">
              Week ›
            </button>
          </div>
        </div>
      </section>
      <div className="workspace">
        <section className="calendar-card">
          <CalendarView
            weekStart={data.weekStart}
            today={data.today}
            timezone={data.timezone}
            people={data.people}
            sessions={data.sessions}
            plantings={data.plantings}
            beds={data.beds}
            photos={data.photos}
            selectedId={selectedId}
            highlightBedId={highlightBedId}
            onSelect={(id) => {
              setSelectedId(id);
              if (id) setTaskId(null);
            }}
          />
        </section>
        <PriorityPanel
          tasks={data.tasks}
          beds={data.beds}
          plantings={data.plantings}
          people={data.people}
          selectedId={taskId}
          onSelect={(id) => {
            setTaskId(id);
            setSelectedId(null);
          }}
          onPlanChange={async () => {
            await reload(week);
          }}
        />
      </div>
      {phoneOpen ? (
        <>
          <button
            type="button"
            className="phone-scrim"
            aria-label="Close texts"
            onClick={() => setPhoneOpen(false)}
          />
          <aside id="phone-drawer" className="phone-drawer" aria-label="Text simulator">
            <header className="phone-drawer-head">
              <h2>Texts</h2>
              <button type="button" className="pill" onClick={() => setPhoneOpen(false)}>
                Close
              </button>
            </header>
            <Phone
              people={data.people}
              threads={data.threads}
              newSender={data.newSender}
              onSent={async (info) => {
                const target = info.sessionStart
                  ? startOfWeekYmd(new Date(info.sessionStart), data.timezone)
                  : week;
                const next = await reload(target);
                if (info.sessionId && next.sessions.some((session) => session.id === info.sessionId)) {
                  setSelectedId(info.sessionId);
                  setTaskId(null);
                }
              }}
            />
          </aside>
        </>
      ) : null}
    </div>
  );
}
