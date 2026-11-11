import { it, expect } from "vitest";
import {
  readAnnotations,
  writeAnnotations,
} from "../apps/web/src/node-annotations.js";

it("round-trips node labels and markers in separate analysis scopes", () => {
  const items = new Map<string, string>();
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
  writeAnnotations(
    "one",
    { a: { label: "Punch animation", highlighted: true } },
    storage,
  );
  expect(readAnnotations("one", storage)).toEqual({
    a: { label: "Punch animation", highlighted: true },
  });
  expect(readAnnotations("two", storage)).toEqual({});
  items.set(
    "rograph:node-annotations:v1:one",
    '{"a":{"label":12,"highlighted":"yes"},"b":{"label":"Good","highlighted":true}}',
  );
  expect(readAnnotations("one", storage)).toEqual({
    b: { label: "Good", highlighted: true },
  });
  items.set("rograph:node-annotations:v1:one", "invalid-json");
  expect(readAnnotations("one", storage)).toEqual({});
});
