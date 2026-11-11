import { it, expect } from "vitest";
import { sourceMatchRanges } from "../apps/web/src/source-find.js";

it("always highlights the selected full-source match when excerpt overlap alignment differs", () => {
  const ranges = sourceMatchRanges("a".repeat(1000), "aaaaaaa", {
    start: 300,
    end: 307,
  });
  expect(ranges.filter((r) => r.active)).toEqual([
    { start: 300, end: 307, active: true },
  ]);
  for (let i = 1; i < ranges.length; i++)
    expect(ranges[i].start).toBeGreaterThanOrEqual(ranges[i - 1].end);
});

it("treats punctuation literally and keeps UTF-16 offsets for highlighted Unicode text", () => {
  expect(sourceMatchRanges("🐕 a.b A.B axb", "a.b")).toEqual([
    { start: 3, end: 6, active: false },
    { start: 7, end: 10, active: false },
  ]);
  expect(sourceMatchRanges("a", "", { start: 0, end: 1 })).toEqual([]);
});
