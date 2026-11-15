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
  cucumber: 60,
  squash: 55,
  pumpkin: 100,
  "bitter melon": 75,
  luffa: 120,
  melon: 85,
  radish: 28,
  goldenberry: 75,
  marigold: 55,
  "forget-me-not": 60,
  flowers: 60,
  herbs: 60,
  mint: 90,
  basil: 60,
  leeks: 120,
  okra: 60,
  turnip: 50,
  zinnia: 60,
  sunflower: 80,
  collards: 60,
  // Perennials: roughly the time to their first harvest. Their yearly seasons are in perennials.ts.
  raspberry: 365,
  blackberry: 365,
  blueberry: 730,
  strawberry: 365,
  asparagus: 730,
  rhubarb: 365,
  rose: 365,
  lavender: 365,
  chives: 60,
  rosemary: 90,
  thyme: 90,
  oregano: 90,
  sage: 90,
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
  cucumbers: "cucumber",
  cucumber: "cucumber",
  squashes: "squash",
  squash: "squash",
  zucchini: "squash",
  pumpkins: "pumpkin",
  pumpkin: "pumpkin",
  "bitter melons": "bitter melon",
  "bitter melon": "bitter melon",
  luffa: "luffa",
  melons: "melon",
  melon: "melon",
  radishes: "radish",
  radish: "radish",
  goldenberries: "goldenberry",
  goldenberry: "goldenberry",
  "ground cherry": "goldenberry",
  marigolds: "marigold",
  marigold: "marigold",
  "forget me not": "forget-me-not",
  "forgot me not": "forget-me-not",
  "forget-me-not": "forget-me-not",
  flower: "flowers",
  flowers: "flowers",
  herb: "herbs",
  herbs: "herbs",
  "some herbs": "herbs",
  mints: "mint",
  mint: "mint",
  basil: "basil",
  leek: "leeks",
  leeks: "leeks",
  okra: "okra",
  turnip: "turnip",
  turnips: "turnip",
  zinnia: "zinnia",
  zinnias: "zinnia",
  sunflower: "sunflower",
  sunflowers: "sunflower",
  collard: "collards",
  collards: "collards",
  "collard greens": "collards",
  raspberry: "raspberry",
  raspberries: "raspberry",
  blackberry: "blackberry",
  blackberries: "blackberry",
  blueberry: "blueberry",
  blueberries: "blueberry",
  strawberry: "strawberry",
  strawberries: "strawberry",
  asparagus: "asparagus",
  rhubarb: "rhubarb",
  rose: "rose",
  roses: "rose",
  "rose bush": "rose",
  "rose bushes": "rose",
  lavender: "lavender",
  chive: "chives",
  chives: "chives",
  rosemary: "rosemary",
  thyme: "thyme",
  oregano: "oregano",
  sage: "sage",
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
