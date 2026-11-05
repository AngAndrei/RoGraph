import { expect, it } from "vitest";
import { measureLayout } from "../apps/web/src/layout-quality.js";

it("counts unique nonincident crossings and unrelated edge obstructions", () => {
  const points = [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 100, y: 100 },
    { id: "c", x: 0, y: 100 },
    { id: "d", x: 100, y: 0 },
    { id: "near", x: 50, y: 48 },
  ];
  const m = measureLayout(points, [
    { source: "a", target: "b" },
    { source: "c", target: "d" },
  ]);
  expect(m.crossings).toBe(1);
  expect(m.obstructions).toBe(2);
  expect(m.minimumSeparation).toBeGreaterThan(60);
  expect(m.edgeLengths.max).toBeCloseTo(Math.sqrt(20000));
});

it("does not multiply geometry scores for reverse/duplicate/invalid edges", () => {
  const points = [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 100, y: 0 },
  ];
  expect(
    measureLayout(points, [
      { source: "a", target: "b" },
      { source: "b", target: "a" },
      { source: "a", target: "a" },
      { source: "a", target: "missing" },
    ]).edgeLengths.median,
  ).toBe(100);
  expect(measureLayout([], []).minimumSeparation).toBe(0);
});
