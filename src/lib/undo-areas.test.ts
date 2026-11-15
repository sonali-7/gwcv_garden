import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addArea, areaFits, areaOfBed, bedsInArea, cleanAreas, resizeArea, shiftArea } from "./garden-areas";
import { defaultLayout, type Bed, type Planting } from "./types";
import { undoStep } from "./undo";

const bed = (id: string, x: number, y: number, extra: Partial<Bed> = {}): Bed => ({ id, name: id, row: "", geometry: { x, y, w: 4, h: 2 }, ...extra });
const planting = (id: string, crop: string): Planting => ({
  id,
  bed_id: "a",
  crop,
  planted_date: "2026-11-20",
  expected_harvest_date: "2027-01-20",
  removed_date: null,
  season_year: 2026,
  days_to_maturity: 60,
  source_session_id: null,
  status: "planned",
});

describe("undo", () => {
  const layout = defaultLayout();

  it("undoes a new planting by removing it, and a change by putting the old record back", () => {
    const before = { beds: [bed("a", 0, 0)], plantings: [planting("p1", "kale")], layout };
    const after = {
      beds: [bed("a", 5, 0)],
      plantings: [{ ...planting("p1", "kale"), removed_date: "2026-11-15" }, planting("p2", "beans")],
      layout,
    };
    const step = undoStep("replace the kale with beans", before, after)!;
    assert.deepEqual(step.plantings.remove, ["p2"]);
    assert.deepEqual(step.plantings.restore, [planting("p1", "kale")]);
    assert.deepEqual(step.beds.restore, [bed("a", 0, 0)]);
    assert.equal(step.layout, null);
  });

  it("puts back a deleted plot, and ignores records nobody touched", () => {
    const step = undoStep("remove b", { beds: [bed("a", 0, 0), bed("b", 6, 0)], plantings: [], layout }, { beds: [bed("a", 0, 0)], plantings: [], layout })!;
    assert.deepEqual(step.beds.restore.map((b) => b.id), ["b"]);
    assert.deepEqual(step.beds.remove, []);
  });

  it("treats the same record with keys in another order as unchanged", () => {
    const a = bed("a", 0, 0);
    const reordered = { geometry: a.geometry, row: "", name: "a", id: "a" } as Bed;
    assert.equal(undoStep("nothing", { beds: [a], plantings: [], layout }, { beds: [reordered], plantings: [], layout }), null);
  });

  it("remembers the old layout when an edit changed it", () => {
    const step = undoStep("change size", { beds: [], plantings: [], layout }, { beds: [], plantings: [], layout: { ...layout, widthFt: 60 } })!;
    assert.equal(step.layout?.widthFt, layout.widthFt);
  });
});

describe("growing areas", () => {
  const layout = { ...defaultLayout(), widthFt: 40, lengthFt: 30, outline: [[0, 0], [30, 0], [30, 20], [0, 30]] as Array<[number, number]> };

  it("turns the garden into Area 1 (keeping its shape) and adds Area 2 beside it, growing the map", () => {
    const next = addArea(layout);
    assert.equal(next.areas!.length, 2);
    assert.deepEqual(next.areas![0], { id: "area-1", name: "Area 1", x: 0, y: 0, w: 30, h: 30, outline: layout.outline });
    const two = next.areas![1];
    assert.equal(two.name, "Area 2");
    assert.ok(two.x >= 30 + 4, "space between the areas");
    assert.equal(next.widthFt, two.x + two.w);
    assert.equal(next.outline, null);
    // A third goes beside the second.
    const third = addArea({ ...layout, ...next }).areas![2];
    assert.ok(third.x > two.x + two.w);
  });

  it("moves an area's shape with it and stretches it on resize", () => {
    const area = { id: "a", name: "A", x: 0, y: 0, w: 10, h: 10, outline: [[0, 0], [10, 0], [0, 10]] as Array<[number, number]> };
    assert.deepEqual(shiftArea(area, 5, 2).outline, [[5, 2], [15, 2], [5, 12]]);
    assert.deepEqual(resizeArea(area, 20, 5).outline, [[0, 0], [20, 0], [0, 5]]);
  });

  it("keeps areas on the map and apart", () => {
    const a = { id: "a", name: "A", x: 0, y: 0, w: 10, h: 10, outline: null };
    const b = { id: "b", name: "B", x: 15, y: 0, w: 10, h: 10, outline: null };
    assert.ok(areaFits(shiftArea(b, 2, 0), [a, b], 40, 30));
    assert.ok(!areaFits(shiftArea(b, -10, 0), [a, b], 40, 30), "overlaps A");
    assert.ok(!areaFits(shiftArea(b, 20, 0), [a, b], 40, 30), "off the map");
  });

  it("knows which plots sit in which area", () => {
    const areas = [
      { id: "a", name: "A", x: 0, y: 0, w: 10, h: 10, outline: null },
      { id: "b", name: "B", x: 15, y: 0, w: 10, h: 10, outline: null },
    ];
    assert.equal(areaOfBed(bed("p", 16, 2), areas)?.id, "b");
    assert.equal(areaOfBed(bed("q", 11, 20), areas), null);
    assert.deepEqual(bedsInArea([bed("p", 16, 2), bed("r", 1, 1)], areas[0]).map((b) => b.id), ["r"]);
  });

  it("cleans areas sent to the server", () => {
    const out = cleanAreas([{ id: "x", name: "  Back lot ", x: 35, y: -2, w: 10, h: 5 }, { id: "x", name: "dupe", x: 0, y: 0, w: 5, h: 5 }, "junk"], 40, 30)!;
    assert.deepEqual(out, [{ id: "x", name: "Back lot", x: 30, y: 0, w: 10, h: 5, outline: null }]);
    assert.equal(cleanAreas([], 40, 30), undefined);
  });
});

describe("plots inside an odd-shaped area", async () => {
  const { rectInArea } = await import("./garden-areas");
  const triangle = { id: "t", name: "T", x: 0, y: 0, w: 10, h: 10, outline: [[0, 0], [10, 0], [0, 10]] as Array<[number, number]> };
  it("only counts a plot as inside when all of it is within the shape", () => {
    assert.ok(rectInArea({ x: 1, y: 1, w: 3, h: 2 }, triangle));
    assert.ok(!rectInArea({ x: 6, y: 6, w: 3, h: 2 }, triangle), "the empty corner of the box");
  });
});

describe("reshaping areas", async () => {
  const { areaFits, polygonsOverlap, reshapeArea, selfCrossing } = await import("./garden-areas");
  const a = { id: "a", name: "A", x: 0, y: 0, w: 10, h: 10, outline: null };
  const b = { id: "b", name: "B", x: 12, y: 0, w: 10, h: 10, outline: null };

  it("follows the new corners, box and all", () => {
    const l = reshapeArea(a, [[0, 0], [10, 0], [10, 4], [4, 4], [4, 12], [0, 12]]);
    assert.deepEqual([l.x, l.y, l.w, l.h], [0, 0, 10, 12]);
    assert.equal(l.outline!.length, 6);
  });

  it("refuses a bow tie", () => {
    assert.ok(selfCrossing([[0, 0], [10, 10], [10, 0], [0, 10]]));
    assert.ok(!selfCrossing([[0, 0], [10, 0], [10, 10], [0, 10]]));
  });

  it("lets odd shapes tuck in close as long as they don't share ground", () => {
    // A's slanted edge leaves room in the corner of its box, where B's corner can sit.
    const slanted = reshapeArea(a, [[0, 0], [10, 0], [0, 10]]);
    const tucked = reshapeArea(b, [[7, 7], [12, 7], [12, 12], [7, 12]]);
    assert.ok(!polygonsOverlap(slanted.outline!, tucked.outline!));
    assert.ok(areaFits(tucked, [slanted, tucked], 40, 30));
    assert.ok(!areaFits(reshapeArea(b, [[2, 2], [12, 2], [12, 12], [2, 12]]), [slanted, b], 40, 30), "covers A's ground");
  });
});
