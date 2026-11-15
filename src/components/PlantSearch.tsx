"use client";

import { useMemo, useState } from "react";
import { CROP_MIME } from "@/components/GardenMap";
import { canonicalCrop } from "@/lib/crops";
import { monthsLabel } from "@/lib/perennials";
import { spriteUrl } from "@/lib/pixel-sprites";
import { searchPlants, type SearchHit } from "@/lib/plant-search";
import type { BedAdvice } from "@/lib/recommend";
import type { Bed } from "@/lib/types";

type How = "after" | "alongside" | "replace";

function title(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function shortDate(day: string, withYear = false): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: withYear ? "numeric" : undefined,
    timeZone: "UTC",
  });
}

/** One line on growing it here: rotation warnings first, then timing, then what kind of plant it is. */
function note(hit: SearchHit, future: boolean, thisYear: string): { text: string; warn: boolean } {
  if (hit.avoid) return { text: `${hit.avoid.reason} Better somewhere else this year.`, warn: true };
  if (hit.rec) {
    const when = hit.rec.now ? (future ? "Can go in then" : "Can go in now") : `From ${shortDate(hit.rec.soonest, hit.rec.soonest.slice(0, 4) !== thisYear)}`;
    const why = hit.rec.reasons.find((reason) => !reason.startsWith("Can go in"));
    return { text: why ? `${when}. ${why}` : `${when}.`, warn: false };
  }
  if (hit.perennial) {
    const months = monthsLabel(hit.perennial.harvestMonths);
    const wait = hit.perennial.yearsToFirstHarvest;
    return {
      text: `Perennial: stays planted year to year${months ? `, picked ${months}` : ""}${wait ? `, first harvest after ${wait} year${wait === 1 ? "" : "s"}` : ""}.`,
      warn: false,
    };
  }
  return { text: "No planting guide for this one yet; check the seed packet for when to sow.", warn: false };
}

/** Search for any plant to grow in the selected plot, and plan it from the results. */
export function PlantSearch(props: {
  bed: Bed;
  advice: BedAdvice;
  /** What's in the plot now (for button titles), or null if it's open. */
  occupant: string | null;
  future: boolean;
  thisYear: string;
  location: string;
  sprites: Record<string, string>;
  busy: boolean;
  onPlan: (bedId: string, crop: string, how?: How) => void;
}) {
  const [query, setQuery] = useState("");
  const hits = useMemo(() => searchPlants(query, props.advice), [query, props.advice]);
  const typed = query.trim().toLowerCase();
  const { bed, occupant, advice } = props;

  function plan(hit: { crop: string; avoid?: SearchHit["avoid"] }, how?: How) {
    // The page asks before planting a crop rotation rules out by name; a family match is only caught here.
    if (hit.avoid && hit.avoid.crop !== hit.crop && !window.confirm(`${hit.avoid.reason} Plan ${hit.crop} here anyway?`)) return;
    props.onPlan(bed.id, hit.crop, how);
    setQuery("");
  }

  function actions(hit: { crop: string; avoid?: SearchHit["avoid"] }) {
    if (!occupant) {
      return (
        <button type="button" className="pill" onClick={() => plan(hit)} disabled={props.busy}>
          Add to plan
        </button>
      );
    }
    return (
      <span className="rec-actions">
        <button type="button" className="pill" onClick={() => plan(hit, "replace")} disabled={props.busy} title={`Take out the ${occupant} and plant ${hit.crop} instead`}>
          Replace
        </button>
        <button type="button" className="pill" onClick={() => plan(hit, "alongside")} disabled={props.busy} title={`Share the plot with the ${occupant}`}>
          Alongside
        </button>
        {/* Perennials never clear out, so there's no "after" in a plot of them. */}
        {advice.permanent ? null : (
          <button type="button" className="pill" onClick={() => plan(hit, "after")} disabled={props.busy} title={`After the ${occupant}`}>
            After
          </button>
        )}
      </span>
    );
  }

  return (
    <section className="block plant-search">
      <h3>Find a plant</h3>
      <input
        type="search"
        className="plant-search-input"
        placeholder="Search plants: garlic, berries, brassica…"
        aria-label={`Search for a plant to grow in ${bed.name}`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && query) {
            event.stopPropagation();
            setQuery("");
          }
        }}
      />
      {hits.length ? (
        <ul className="search-hits" aria-label="Matching plants">
          {hits.map((hit) => {
            const { text, warn } = note(hit, props.future, props.thisYear);
            return (
              <li
                key={hit.crop}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(CROP_MIME, hit.crop);
                  event.dataTransfer.setData("text/plain", hit.crop);
                  event.dataTransfer.effectAllowed = "copy";
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="sprite" src={spriteUrl(hit.crop, props.sprites)} alt="" width={26} height={26} />
                <div>
                  <strong>
                    {title(hit.crop)}
                    {hit.family ? <small> · {hit.family}</small> : null}
                  </strong>
                  <p className={warn ? "hit-note warn" : "hit-note"}>{text}</p>
                  <footer>
                    <a href={seedLink(hit.crop, props.location)} target="_blank" rel="noreferrer">
                      Find seeds ↗
                    </a>
                    {actions(hit)}
                  </footer>
                </div>
              </li>
            );
          })}
        </ul>
      ) : typed.length >= 2 ? (
        <div className="search-none">
          <p className="quiet small">No plant called “{query.trim()}” in the app&apos;s list. You can still add it; set its timing yourself.</p>
          {actions({ crop: canonicalCrop(typed).slice(0, 40) })}
        </div>
      ) : (
        <p className="quiet small">Look up any plant to see if it suits this plot now, then add it. You can also drag a result onto the map.</p>
      )}
    </section>
  );
}

function seedLink(crop: string, location: string): string {
  const q = location ? `garden center seeds near ${location}` : "garden center seeds near me";
  return `https://www.google.com/maps/search/${encodeURIComponent(`${q} ${crop}`.trim())}`;
}
