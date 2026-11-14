import families from "../data/crop-families.json";

export type CropFamily = {
  family: string;
  crops: string[];
  nitrogenFixer: boolean;
  feeder: "heavy" | "light" | "medium";
};

export const CROP_FAMILIES = families as CropFamily[];

const MATURITY_DAYS: Record<string, number> = {
  carrots: 70,
  carrot: 70,
  "sweet potato": 120,
  "sweet potatoes": 120,
  cabbage: 80,
  kale: 55,
  beans: 60,
  peas: 60,
  lettuce: 45,
  tomatoes: 80,
  tomato: 80,
  corn: 80,
  trees: 365,
  tree: 365,
  garlic: 240,
  onion: 100,
  spinach: 40,
  beet: 60,
  broccoli: 70,
  pepper: 75,
  potato: 90,
  clover: 60,
  "winter rye": 180,
};

const CANONICAL: Record<string, string> = {
  carrot: "carrots",
  carrots: "carrots",
  "sweet potato": "sweet potato",
  "sweet potatoes": "sweet potato",
  tree: "trees",
  trees: "trees",
  tomato: "tomatoes",
  tomatoes: "tomatoes",
  cabbage: "cabbage",
  kale: "kale",
  beans: "beans",
  peas: "peas",
  lettuce: "lettuce",
  corn: "corn",
  garlic: "garlic",
  onion: "onion",
  onions: "onion",
  spinach: "spinach",
  beet: "beet",
  beets: "beet",
  broccoli: "broccoli",
  pepper: "pepper",
  peppers: "pepper",
  potato: "potato",
  potatoes: "potato",
  clover: "clover",
  "winter rye": "winter rye",
  rye: "winter rye",
};

export function canonicalCrop(crop: string): string {
  const key = crop.toLowerCase().trim();
  return CANONICAL[key] ?? key;
}

export function maturityDays(crop: string): number {
  return MATURITY_DAYS[crop.toLowerCase().trim()] ?? MATURITY_DAYS[canonicalCrop(crop)] ?? 60;
}

export function knownCrops(): string[] {
  return Object.keys(CANONICAL).sort((a, b) => b.length - a.length);
}

export function familyOf(crop: string): CropFamily | null {
  const key = canonicalCrop(crop);
  return (
    CROP_FAMILIES.find((family) =>
      family.crops.some((name) => canonicalCrop(name) === key || name === crop.toLowerCase()),
    ) ?? null
  );
}
