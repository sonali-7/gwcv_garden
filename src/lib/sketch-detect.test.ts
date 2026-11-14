import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boxDownscale, detectBest, detectSketch, scaleFromDimensions, toFeet } from "./sketch-detect";

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
    line(x0: number, y0: number, x1: number, y1: number, t = 2) {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let k = 0; k <= n; k++) {
        const x = Math.round(x0 + ((x1 - x0) * k) / n);
        const y = Math.round(y0 + ((y1 - y0) * k) / n);
        for (let dx = 0; dx < t; dx++) for (let dy = 0; dy < t; dy++) set(x + dx, y + dy, ink);
      }
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

  it("traces an odd-shaped garden, mends a bed its edge cuts through, and reads the scale off a side", () => {
    const c = canvas(500, 400);
    // A garden with a slanted bottom-left edge.
    c.line(40, 20, 460, 20);
    c.line(460, 20, 460, 380);
    c.line(460, 380, 200, 380);
    c.line(200, 380, 40, 220);
    c.line(40, 220, 40, 20);
    c.box(70, 50, 150, 30, 2);
    c.box(260, 50, 160, 30, 2);
    c.box(90, 200, 140, 60, 2); // the slanted edge runs through this one's bottom-left corner
    c.box(300, 300, 120, 40, 2);
    const d = detectSketch(c.raster);
    assert.equal(new Set(d.beds.map((b) => b.group)).size, 4);
    assert.ok(d.outline && d.outline.length >= 5, "outline traced");
    const cut = d.beds.find((b) => Math.abs(b.rect.x - 90) < 6 && Math.abs(b.rect.y - 200) < 6);
    assert.ok(cut && Math.abs(cut.rect.w - 140) < 8 && Math.abs(cut.rect.h - 60) < 8, JSON.stringify(cut?.rect));
    // The top side is 420 px; call it 21 m.
    const top = d.edges.find((e) => Math.abs(e.a.y - e.b.y) < 3 && Math.min(e.a.y, e.b.y) < 30);
    assert.ok(top);
    const perUnit = scaleFromDimensions(d, [{ edge: top!.label, value: 21 }]);
    assert.ok(perUnit && Math.abs(perUnit - 20) < 1, String(perUnit));
  });

  it("keeps thin lines when shrinking and picks a sensitivity that finds the beds", () => {
    const c = canvas(1200, 900);
    c.box(100, 100, 1000, 700, 1);
    for (let i = 0; i < 6; i++) c.box(160, 160 + i * 100, 400, 40, 1);
    const small = boxDownscale(c.raster, 480, 360);
    const { detection } = detectBest(small);
    assert.equal(new Set(detection.beds.map((b) => b.group)).size, 6);
  });

  it("finds nothing on a blank page", () => {
    assert.equal(detectSketch(canvas(200, 200).raster).beds.length, 0);
  });
});

describe("reading labels from Claude's reply", async () => {
  const { parseLabels } = await import("./sketch-labels");
  it("keeps valid beds, maps crop names, and ignores junk", () => {
    const text = `Here you go:
{"beds":[{"n":1,"name":"North border","crops":["Trees"],"skip":false},{"n":2,"name":"Kale / Peas","crops":["kale","Peas","nothing"]},
{"n":2,"name":"dupe"},{"n":9,"name":"out of range"},{"n":3,"name":null,"crops":["Bitter melons","luffa!"],"skip":true}],
"missed":[{"name":"Flowers","crops":["marigold"],"box":[0.2,0.1,0.3,0.12]},{"name":"bad","box":[2,0,1,1]}],
"dimensions":[{"edge":"a","value":9,"unit":"m"},{"edge":"Z","value":3,"unit":"m"},{"edge":"B","value":"x"}],
"units":"m","widthFt":"40","lengthFt":30}`;
    const out = parseLabels(text, 3, ["A", "B"]);
    assert.deepEqual(out.beds.map((b) => [b.n, b.name, b.crops, b.skip]), [
      [1, "North border", ["trees"], false],
      [2, "Kale / Peas", ["kale", "peas"], false],
      [3, null, ["bitter melon", "luffa"], true],
    ]);
    assert.deepEqual(out.missed.map((m) => m.name), ["Flowers"]);
    assert.deepEqual(out.dimensions, [{ edge: "A", value: 9, unit: "m" }]);
    assert.equal(out.units, "m");
    assert.equal(out.widthFt, 40);
    assert.equal(out.lengthFt, 30);
  });
  it("survives a reply that isn't JSON", () => {
    assert.deepEqual(parseLabels("sorry, I can't read that", 2).beds, []);
  });
});
