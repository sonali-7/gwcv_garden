"use client";

import { useMemo } from "react";
import { CAR_KG_PER_MILE } from "@/lib/carbon";
import { compareYears, MIN_PLANTINGS } from "@/lib/sustainability";
import type { Bed, Planting } from "@/lib/types";

/** Below this, a percentage swings wildly (11 → 82 is "645% better"), so the change is shown in points instead. */
const PERCENT_FROM = 25;

function kg(n: number): string {
  return n >= 10 ? String(Math.round(n)) : n.toFixed(1);
}

function shortDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * This year's sustainability score against last year's, over the same stretch of the year.
 * Follows the timeline: looking back shows that year; looking ahead stops at today (plans haven't happened).
 */
export function SustainabilityCard(props: { beds: Bed[]; plantings: Planting[]; day: string; today: string }) {
  const endOn = props.day < props.today ? props.day : props.today;
  const result = useMemo(() => compareYears(props.beds, props.plantings, endOn, props.today), [props.beds, props.plantings, endOn, props.today]);
  const { current, previous, change, score, previousScore } = result;
  if (score === null) {
    return (
      <section className="eco-card" aria-label="Sustainability score">
        <h3>Sustainability, {current.year}</h3>
        <p className="quiet small">
          Your score starts once something has grown in a plot this year. It tracks soil cover, crop rotation and nitrogen, and
          compares with {previous.year}.
        </p>
      </section>
    );
  }
  const range = `Jan 1–${shortDate(current.to)}`;
  const direction = change === null ? "" : change > 0 ? "up" : change < 0 ? "down" : "same";

  return (
    <section className="eco-card" aria-label="Sustainability score">
      <div className="eco-head">
        <div className="eco-score" aria-label={`Score ${score} out of 100`}>
          {score}
          <small>/100</small>
        </div>
        <div>
          <h3>Sustainability, {current.year}</h3>
          {change !== null ? (
            <p className={`eco-change ${direction}`}>
              {change === 0
                ? `Same as ${previous.year} (${previousScore})`
                : (previousScore ?? 0) >= PERCENT_FROM
                  ? `${Math.abs(change)}% ${change > 0 ? "better" : "lower"} than ${previous.year} (${previousScore})`
                  : `${change > 0 ? "Up" : "Down"} ${Math.abs(score - (previousScore ?? 0))} points from ${previous.year} (${previousScore})`}
            </p>
          ) : (
            <p className="eco-change">Not enough data from {previous.year} to compare yet.</p>
          )}
          <p className="quiet small">{range}, both years</p>
        </div>
      </div>
      <div className="eco-co2" aria-label="Estimated CO₂ saved">
        <p>
          <strong>≈ {kg(current.carbon.kg)} kg CO₂</strong> saved
          {current.carbon.kg >= 1 ? <span className="quiet"> · about {Math.round(current.carbon.kg / CAR_KG_PER_MILE)} miles not driven</span> : null}
        </p>
        <p className="quiet small">
          {current.carbon.harvests
            ? `${kg(current.carbon.foodKg)} kg of food grown instead of bought${current.carbon.top.length ? `, mostly ${current.carbon.top.map((t) => t.crop).join(", ")}` : ""}.`
            : "Counts once something reaches harvest."}{" "}
          {previous.carbon.harvests ? `${previous.year}: ≈ ${kg(previous.carbon.kg)} kg.` : ""}
        </p>
      </div>
      {result.reasons.length ? (
        <ul className="eco-reasons">
          {result.reasons.slice(0, 2).map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      <details className="eco-more">
        <summary>How it&apos;s worked out</summary>
        <dl>
          {current.measures.map((m, i) => (
            <div key={m.key}>
              <dt>{m.label}</dt>
              <dd>
                {m.score === null ? "–" : m.score}
                {previous.measures[i].score !== null ? <small className="was"> ({previous.year}: {previous.measures[i].score})</small> : null}
                {m.key === "cover" ? null : <small className="detail">{m.detail}</small>}
              </dd>
            </div>
          ))}
        </dl>
        <p className="quiet small">
          Soil covered (35%): how much of the time plots had something growing. Rotation kept (35%): plantings that didn&apos;t
          repeat a family grown in that plot the year before. Healthy nitrogen (30%): plot area that isn&apos;t low on
          nitrogen. A plot counts from the year it was first planted, and rotation only counts plots with a record from the
          year before. When last year scored under {PERCENT_FROM}, the change is shown in points,
          since a percentage of a small number exaggerates it. CO₂ is a rough estimate, kept separate from the
          score: each crop that reached harvest counts its share of the plot&apos;s area × a typical home-garden yield per
          square foot × what the same food costs in CO₂ from a store (Poore &amp; Nemecek 2018), plus fertilizer that legumes
          made unnecessary ({kg(current.carbon.fertilizerKg)} kg this year). Miles use an average car (400 g CO₂ a mile).{" "}
          {change === null ? `It compares once ${previous.year} has at least ${MIN_PLANTINGS} plantings.` : ""}
        </p>
      </details>
    </section>
  );
}
