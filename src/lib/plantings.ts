import type { Planting } from "./types";

export function isActive(planting: Planting, onYmd: string): boolean {
  if (planting.planted_date > onYmd) return false;
  if (planting.removed_date && planting.removed_date <= onYmd) return false;
  return true;
}

export function activePlantings(plantings: Planting[], onYmd: string): Planting[] {
  return plantings.filter((planting) => isActive(planting, onYmd));
}
