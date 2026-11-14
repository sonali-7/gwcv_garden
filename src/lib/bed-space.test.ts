import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowedMove, allowedResize, openSpot, overlaps } from "./bed-space";

const r = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe("patches can't share ground", () => {
  it("counts shared ground but not touching edges", () => {
    assert.equal(overlaps(r(0, 0, 4, 2), r(3, 1, 4, 2)), true);
    assert.equal(overlaps(r(0, 0, 4, 2), r(4, 0, 4, 2)), false, "side by side");
    assert.equal(overlaps(r(0, 0, 4, 2), r(0, 2, 4, 2)), false, "one above the other");
  });

  it("stops a drag at a neighbor, sliding along the free direction", () => {
    const wall = [r(5, 0, 2, 10)];
    const last = r(0, 2, 4, 2);
    assert.deepEqual(allowedMove(r(3, 2, 4, 2), last, wall), last, "can't push into the wall");
    assert.deepEqual(allowedMove(r(3, 5, 4, 2), last, wall), r(0, 5, 4, 2), "keeps the vertical part of the drag");
    assert.deepEqual(allowedMove(r(8, 2, 4, 2), last, wall), r(8, 2, 4, 2), "can jump to open ground past it");
  });

  it("stops a resize at a neighbor", () => {
    const wall = [r(5, 0, 2, 10)];
    assert.deepEqual(allowedResize(r(0, 0, 6, 3), r(0, 0, 4, 2), wall), r(0, 0, 4, 3));
  });

  it("puts a new patch on open ground, smaller if it has to", () => {
    assert.deepEqual(openSpot([r(0, 0, 10, 5)], 10, 10, 8, 4), r(0.5, 5, 8, 4));
    assert.deepEqual(openSpot([r(0, 0, 10, 8)], 10, 10, 8, 4), r(0.5, 8, 4, 2));
    assert.equal(openSpot([r(0, 0, 10, 10)], 10, 10, 8, 4), null);
  });
});
