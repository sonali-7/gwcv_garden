import type { GardenLayout } from "./types";

export type Units = GardenLayout["units"];
export const FT_PER_M = 3.28084;

/** A length stored in feet, shown in the garden's units. */
export function showLength(ft: number, units: Units): string {
  if (units === "m") return `${trim(ft / FT_PER_M, 1)} m`;
  return `${trim(ft, 1)} ft`;
}

export function showSize(wFt: number, hFt: number, units: Units): string {
  if (units === "m") return `${trim(wFt / FT_PER_M, 1)} × ${trim(hFt / FT_PER_M, 1)} m`;
  return `${trim(wFt, 1)} × ${trim(hFt, 1)} ft`;
}

export function showArea(wFt: number, hFt: number, units: Units): string {
  if (units === "m") return `${trim((wFt * hFt) / (FT_PER_M * FT_PER_M), 1)} m²`;
  return `${trim(wFt * hFt, 0)} sq ft`;
}

export function toFt(value: number, units: Units): number {
  return units === "m" ? value * FT_PER_M : value;
}

export function fromFt(ft: number, units: Units): number {
  return units === "m" ? Math.round((ft / FT_PER_M) * 10) / 10 : Math.round(ft * 10) / 10;
}

/** Grid spacing in feet: 1 m for metric gardens, 5 ft otherwise. */
export function gridStepFt(units: Units): number {
  return units === "m" ? FT_PER_M : 5;
}

function trim(n: number, digits: number): string {
  return String(Math.round(n * 10 ** digits) / 10 ** digits);
}
