import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectSketch, toFeet } from "./sketch-detect";

function canvas(w: number, h: number) {
  const data = new Uint8Array(w * h * 4).fill(255);
  const set = (x: number, y: number, rgb: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    [data[i], data[i + 1], data[i + 2]] = rgb;
  };
  const ink: [number, number, number] = [20, 20, 20];
  return {
    raster: { width: w, height: h, data },
    outline(points: Array<[number, number]>, t = 3) {
      for (let k = 0; k < points.length; k++) {
        const [x0, y0] = points[k];
        const [x1, y1] = points[(k + 1) % points.length];
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
          for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
            for (let d = 0; d < t; d++) set(x0 === x1 ? x + d : x, y0 === y1 ? y + d : y, ink);
      }
    },
    box(x: number, y: number, bw: number, bh: number, t = 3) {
      this.outline([[x, y], [x + bw, y], [x + bw, y + bh], [x, y + bh]], t);
    },
    fill(x: number, y: number, bw: number, bh: number, rgb: [number, number, number]) {
      for (let yy = y; yy < y + bh; yy++) for (let xx = x; xx < x + bw; xx++) set(xx, yy, rgb);
    },
  };
}

describe("reading a garden drawing", () => {
  it("uses the outer box as the garden edge and finds the beds inside it", () => {
    const c = canvas(400, 300);
    c.box(20, 20, 360, 260); // garden, 40 x 30 ft at 9 px/ft
    c.box(38, 38, 324, 54); // north border: 2,2 36x6
    c.box(38, 110, 72, 72); // carrots: 2,10 8x8
    c.box(146, 200, 108, 72); // space x: 14,20 12x8
    const d = detectSketch(c.raster);
    assert.equal(d.frameFromBorder, true);
    assert.equal(d.beds.length, 3);
    const ft = toFeet(d, 40, 30);
    const near = (a: number, b: number) => Math.abs(a - b) <= 0.75;
    for (const [want, got] of [
      [{ x: 2, y: 2, w: 36, h: 6 }, ft[0]],
      [{ x: 2, y: 10, w: 8, h: 8 }, ft[1]],
      [{ x: 14, y: 20, w: 12, h: 8 }, ft[2]],
    ] as const) {
      for (const key of ["x", "y", "w", "h"] as const) assert.ok(near(got[key], want[key]), `${key}: ${JSON.stringify(got)}`);
    }
  });

  it("splits an L-shaped bed and keeps a box beside it", () => {
    const c = canvas(400, 300);
    c.box(10, 10, 380, 280);
    c.outline([[40, 40], [360, 40], [360, 100], [140, 100], [140, 260], [40, 260]]);
    c.box(200, 150, 140, 100);
    const d = detectSketch(c.raster);
    const groups = new Set(d.beds.map((b) => b.group));
    assert.equal(groups.size, 2);
    assert.equal(d.beds.filter((b) => b.parts === 2).length, 2);
  });

  it("finds solid colored blocks", () => {
    const c = canvas(300, 200);
    c.fill(20, 20, 120, 60, [70, 160, 70]);
    c.fill(180, 100, 90, 70, [200, 80, 60]);
    const d = detectSketch(c.raster);
    assert.equal(d.beds.length, 2);
    assert.ok(d.beds.every((b) => b.source === "fill" && b.color));
  });

  it("finds nothing on a blank page", () => {
    assert.equal(detectSketch(canvas(200, 200).raster).beds.length, 0);
  });
});

describe("reading labels from Claude's reply", async () => {
  const { parseLabels } = await import("./sketch-labels");
  it("keeps valid beds, maps crop names, and ignores junk", () => {
    const text = `Here you go:
{"beds":[{"n":1,"name":"North border","crop":"Trees","skip":false},{"n":2,"name":"Carrots","crop":"carrot","skip":false},
{"n":2,"name":"dupe"},{"n":9,"name":"out of range"},{"n":3,"name":null,"crop":"unicorn grass","skip":true}],"widthFt":"40","lengthFt":30}`;
    const out = parseLabels(text, 3);
    assert.deepEqual(out.beds.map((b) => [b.n, b.name, b.crop, b.skip]), [
      [1, "North border", "trees", false],
      [2, "Carrots", "carrots", false],
      [3, null, null, true],
    ]);
    assert.equal(out.widthFt, 40);
    assert.equal(out.lengthFt, 30);
  });
  it("survives a reply that isn't JSON", () => {
    assert.deepEqual(parseLabels("sorry, I can't read that", 2).beds, []);
  });
});
