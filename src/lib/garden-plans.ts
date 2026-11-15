import { maturityDays } from "./crops";
import { isPerennial } from "./perennials";
import { addDays } from "./time";
import type { Bed, GardenLayout, Planting } from "./types";

/**
 * The garden's real plans, traced from the organizers' drawings:
 * - 2026 (this year, the red plan): becomes the plots on the map, with this season's plantings.
 * - 2025 (last year, the black plan): history. Each old bed's crops are attached to the 2026 plot in the same
 *   spot, so rotation, nitrogen and the sustainability score can compare the two years.
 *
 * Rectangles are pixel boxes [x1, y1, x2, y2] measured on each drawing; they're converted to feet using the
 * garden's outer edges. The drawings put the garden at about 15 m wide and 18.7 m long (the black plan labels
 * the sides 4 m, 7 m, 7 m and 8 m).
 */

const FT_PER_M = 3.28084;
export const GARDEN_W_FT = Math.round(15 * FT_PER_M * 10) / 10;
export const GARDEN_L_FT = Math.round(18.7 * FT_PER_M * 10) / 10;

type Box = [number, number, number, number];
type Frame = { x0: number; y0: number; x1: number; y1: number };

/** The red (2026) drawing's garden edges, in its pixels. */
const RED: Frame = { x0: 278, y0: 762, x1: 1197, y1: 1908 };

/**
 * The two drawings aren't to the same proportions (the black one squeezes the middle rows together), so the black
 * plan is lined up with the red one section by section: matching outer edges, the column's edge, and the middle rows.
 * Each pair is [black px, red px]; positions in between are interpolated.
 */
const BLACK_TO_RED_X: Array<[number, number]> = [
  [402, 278], [610, 505], [978, 1057], [1180, 1197],
];
const BLACK_TO_RED_Y: Array<[number, number]> = [
  [176, 762], [540, 1165], [551, 1165], [592, 1195], [635, 1246], [672, 1298], [730, 1380], [821, 1522], [1188, 1908],
];

function piecewise(anchors: Array<[number, number]>, v: number): number {
  for (let i = 1; i < anchors.length; i++) {
    const [a0, b0] = anchors[i - 1];
    const [a1, b1] = anchors[i];
    if (v <= a1 || i === anchors.length - 1) return b0 + ((v - a0) * (b1 - b0)) / (a1 - a0 || 1);
  }
  return v;
}

/** A box on the black drawing, moved onto the red drawing. */
function blackOnRed([x1, y1, x2, y2]: Box): Box {
  return [piecewise(BLACK_TO_RED_X, x1), piecewise(BLACK_TO_RED_Y, y1), piecewise(BLACK_TO_RED_X, x2), piecewise(BLACK_TO_RED_Y, y2)];
}

function toFeet(frame: Frame, [x1, y1, x2, y2]: Box) {
  const kx = GARDEN_W_FT / (frame.x1 - frame.x0);
  const ky = GARDEN_L_FT / (frame.y1 - frame.y0);
  const r = (n: number) => Math.round(n * 10) / 10;
  const x = r((x1 - frame.x0) * kx);
  const y = r((y1 - frame.y0) * ky);
  return { x, y, w: r((x2 - frame.x0) * kx) - x, h: r((y2 - frame.y0) * ky) - y };
}

/** The garden's outline on the red drawing: the L-shaped top, the curved mint corner, and the long curved edge. */
const OUTLINE_PX: Array<[number, number]> = [
  [278, 762], [505, 762], [505, 1165], [1057, 1165],
  // The curved mint corner (a quarter circle around the top-right corner).
  [1076, 1213], [1115, 1255], [1150, 1285], [1197, 1305],
  [1197, 1908], [1055, 1908],
  // The long curved edge back to the left side.
  [990, 1795], [918, 1700], [835, 1612], [735, 1525], [588, 1430], [500, 1383], [400, 1342], [278, 1310],
];

/** 2026 plots, top to bottom then left to right, with what the red plan says grows in each. */
const PLOTS_2026: Array<{ box: Box; crops: string[] }> = [
  { box: [278, 762, 505, 793], crops: ["marigold", "zinnia"] },
  { box: [484, 793, 505, 1165], crops: ["mint"] },
  { box: [278, 828, 484, 865], crops: ["lettuce"] },
  { box: [278, 900, 484, 933], crops: ["lettuce"] },
  { box: [278, 964, 484, 990], crops: ["collards"] },
  { box: [278, 1018, 484, 1043], crops: ["carrots"] },
  { box: [278, 1075, 332, 1106], crops: ["kale"] },
  { box: [332, 1075, 484, 1106], crops: ["collards"] },
  { box: [278, 1135, 484, 1165], crops: ["turnip"] },
  { box: [484, 1165, 1032, 1182], crops: ["marigold", "zinnia", "mint"] },
  { box: [278, 1199, 491, 1223], crops: ["lettuce"] },
  { box: [515, 1195, 1035, 1228], crops: ["beans"] },
  { box: [1062, 1215, 1150, 1290], crops: ["mint"] }, // the curved mint bed, as the box inside its curve
  { box: [502, 1246, 1057, 1276], crops: ["okra"] },
  { box: [493, 1298, 1104, 1335], crops: ["broccoli"] },
  { box: [1130, 1338, 1192, 1450], crops: ["sunflower"] },
  { box: [600, 1380, 965, 1522], crops: ["sweet potato"] },
  { box: [970, 1465, 1062, 1533], crops: ["basil"] },
  { box: [1065, 1472, 1190, 1557], crops: ["pepper"] },
  { box: [971, 1564, 1014, 1607], crops: ["tomatoes"] },
  { box: [1029, 1568, 1072, 1611], crops: ["tomatoes"] },
  { box: [1085, 1564, 1128, 1606], crops: ["tomatoes"] },
  { box: [1140, 1568, 1183, 1611], crops: ["tomatoes"] },
  { box: [1134, 1622, 1184, 1680], crops: ["grain"] }, // "unknown grain??" on the plan
  { box: [966, 1655, 1009, 1697], crops: ["tomatoes"] },
  { box: [1021, 1655, 1064, 1697], crops: ["tomatoes"] },
  { box: [1132, 1688, 1192, 1748], crops: ["corn"] }, // "unknown corn??" on the plan
  { box: [1050, 1770, 1195, 1905], crops: ["cucumber"] },
];

/** 2025 beds from the black plan. Its pond (the blue box) isn't a bed. Mint is left out: it's the same perennial still growing in 2026. */
const BEDS_2025: Array<{ label: string; box: Box; crops: string[] }> = [
  { label: "Marigold / Forget-me-not / Flowers", box: [422, 187, 589, 216], crops: ["marigold", "forget-me-not", "flowers"] },
  { label: "Cabbage", box: [423, 260, 590, 289], crops: ["cabbage"] },
  { label: "Lettuce", box: [423, 308, 590, 338], crops: ["lettuce"] },
  { label: "Leeks; Herbs", box: [423, 372, 590, 401], crops: ["leeks", "herbs"] },
  { label: "Kale", box: [423, 429, 590, 458], crops: ["kale"] },
  { label: "Kale", box: [423, 477, 590, 506], crops: ["kale"] },
  { label: "Carrots", box: [422, 533, 589, 562], crops: ["carrots"] },
  { label: "Kale / Peas", box: [422, 578, 589, 607], crops: ["kale", "peas"] },
  { label: "Kale / Peas", box: [426, 622, 593, 651], crops: ["kale", "peas"] },
  { label: "Mints / Marigold", box: [624, 551, 981, 580], crops: ["marigold"] },
  { label: "Beans", box: [615, 592, 972, 621], crops: ["beans"] },
  { label: "Bitter melons; carrots", box: [616, 635, 968, 664], crops: ["bitter melon", "carrots"] },
  { label: "Luffa; Goldenberry", box: [615, 672, 972, 702], crops: ["luffa", "goldenberry"] },
  { label: "Sweet potatoes", box: [679, 730, 982, 821], crops: ["sweet potato"] },
  { label: "Some herbs", box: [997, 729, 1164, 758], crops: ["herbs"] },
  { label: "Pumpkins", box: [997, 776, 1164, 805], crops: ["pumpkin"] },
  { label: "Cucumber", box: [1002, 815, 1159, 844], crops: ["cucumber"] },
  { label: "Tomato", box: [1000, 854, 1167, 883], crops: ["tomatoes"] },
  { label: "Tomato", box: [1003, 894, 1170, 923], crops: ["tomatoes"] },
  { label: "Squash", box: [1009, 937, 1176, 966], crops: ["squash"] },
  { label: "Spinach", box: [1070, 978, 1170, 1007], crops: ["spinach"] },
  { label: "Radish", box: [1090, 1019, 1178, 1048], crops: ["radish"] },
];

/** When each crop went in (month-day). Cool crops in early spring, warm crops after the last frost. */
const SOWN: Record<string, string> = {
  lettuce: "04-01", cabbage: "04-01", kale: "04-01", collards: "04-01", peas: "04-01", carrots: "04-05",
  turnip: "04-05", radish: "04-05", spinach: "04-01", broccoli: "04-10", leeks: "04-10", "forget-me-not": "04-15",
  herbs: "05-01", flowers: "05-10", marigold: "05-15", zinnia: "05-15", beans: "05-20", okra: "05-25",
  "sweet potato": "05-25", tomatoes: "05-20", pepper: "05-20", basil: "05-20", cucumber: "05-25", squash: "05-25",
  pumpkin: "05-25", "bitter melon": "05-25", luffa: "05-25", goldenberry: "05-25", sunflower: "05-15", corn: "05-15",
  grain: "05-01",
  // Mint went in the spring before last and is still there.
  mint: "05-01",
};

/** Days after the expected harvest that a crop is assumed cleared (the timeline's own rule). */
const CLEARED_AFTER = 14;

export const PLAN_PREFIX = "plan2026";
export const HISTORY_PREFIX = "hist2025";

function planting(id: string, bedId: string, crop: string, year: number, today: string): Planting {
  const perennial = isPerennial(crop);
  const planted = `${perennial ? 2025 : year}-${SOWN[crop] ?? "05-01"}`;
  const days = maturityDays(crop);
  const harvest = addDays(planted, days);
  const cleared = addDays(harvest, CLEARED_AFTER);
  return {
    id,
    bed_id: bedId,
    crop,
    planted_date: planted,
    expected_harvest_date: harvest,
    // Past seasons are closed out; perennials stay until someone pulls them.
    removed_date: perennial || cleared > today ? null : cleared,
    season_year: Number(planted.slice(0, 4)),
    days_to_maturity: days,
    source_session_id: null,
  };
}

function overlapArea(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function distance(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  return Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2));
}

export type GardenPlans = {
  layout: Pick<GardenLayout, "widthFt" | "lengthFt" | "outline">;
  beds: Bed[];
  plantings: Planting[];
  /** Where each 2025 bed's history went, for checking: [old label, new plot name]. */
  mapping: Array<[string, string]>;
};

/** Build the plots and both years' plantings. `today` closes out anything whose season is over. */
export function buildGardenPlans(today: string): GardenPlans {
  const beds: Bed[] = PLOTS_2026.map((plot, i) => ({
    id: `${PLAN_PREFIX}-bed-${i + 1}`,
    name: `Plot ${i + 1}`,
    row: "",
    geometry: toFeet(RED, plot.box),
  }));
  const plantings: Planting[] = PLOTS_2026.flatMap((plot, i) =>
    plot.crops.map((crop, k) => planting(`${PLAN_PREFIX}-p-${i + 1}-${k + 1}`, beds[i].id, crop, 2026, today)),
  );

  const mapping: Array<[string, string]> = [];
  BEDS_2025.forEach((old, i) => {
    const where = toFeet(RED, blackOnRed(old.box));
    // The 2026 plot covering most of the old bed; failing that, the nearest one. Perennial-only plots (the mint
    // borders) didn't hold last year's annuals.
    const ranked = beds
      .filter((bed, b) => !PLOTS_2026[b].crops.every(isPerennial))
      .map((bed) => ({ bed, overlap: overlapArea(where, bed.geometry!), near: distance(where, bed.geometry!) }))
      .sort((a, b) => b.overlap - a.overlap || a.near - b.near);
    const target = ranked[0].bed;
    mapping.push([old.label, target.name]);
    old.crops.forEach((crop, k) => plantings.push(planting(`${HISTORY_PREFIX}-p-${i + 1}-${k + 1}`, target.id, crop, 2025, today)));
  });

  const outline = OUTLINE_PX.map(([x, y]) => {
    const f = toFeet(RED, [x, y, x, y]);
    return [f.x, f.y] as [number, number];
  });
  return { layout: { widthFt: GARDEN_W_FT, lengthFt: GARDEN_L_FT, outline }, beds, plantings, mapping };
}
