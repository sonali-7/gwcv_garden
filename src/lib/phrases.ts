import type { ActivityType } from "./types";

export function workPhrase(
  activity: ActivityType,
  crop: string | null,
  bedName: string | null,
): string {
  const bed = bedName ? bedName.toLowerCase() : null;
  switch (activity) {
    case "plant":
      return `planted ${crop ?? "crops"}${bed ? ` on the ${bed}` : ""}`;
    case "weed":
      if (bed) return `weeded the ${bed}`;
      if (crop) return `weeded ${crop}`;
      return "weeded";
    case "water":
      if (bed) return `watered the ${bed}`;
      if (crop) return `watered ${crop}`;
      return "watered";
    case "harvest":
      return `harvested ${crop ?? "crops"}${bed ? ` from the ${bed}` : ""}`;
    case "prep":
      return bed ? `prepped the ${bed}` : "prepped a bed";
    case "meeting":
      return "came to the weekly meeting";
    default:
      return crop ? `worked on ${crop}` : "logged garden work";
  }
}

export function eventSubtitle(activity: ActivityType, crop: string | null): string {
  switch (activity) {
    case "weed":
      return crop ? `${crop} weeds` : "weeding";
    case "plant":
      return crop ? `planted ${crop}` : "planting";
    case "water":
      return crop ? `watered ${crop}` : "watering";
    case "harvest":
      return crop ? `harvested ${crop}` : "harvest";
    case "prep":
      return "bed prep";
    case "meeting":
      return "meeting";
    default:
      return crop ? crop : "garden work";
  }
}

export function sentence(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function cropTitle(crop: string): string {
  const lower = crop.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
