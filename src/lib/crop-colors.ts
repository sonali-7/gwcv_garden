import { familyOf } from "./crops";

const FAMILY_COLORS: Record<string, string> = {
  "morning glory": "#d4533c",
  brassica: "#8a63c4",
  umbellifer: "#3e6fd8",
  woody: "#4f9a3c",
  legume: "#1f9a8a",
  amaranth: "#c99a1c",
  grass: "#b9803a",
  nightshade: "#c2410c",
  allium: "#c4579c",
};

export function cropColor(crop: string | null | undefined): string {
  if (!crop) return "#9a8d7a";
  return FAMILY_COLORS[familyOf(crop)?.family ?? ""] ?? "#6f7f5a";
}
