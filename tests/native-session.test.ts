import { it, expect } from "vitest";
import {
  createNativeSession,
  parseSource,
} from "../packages/adapters/src/native.js";
import { hash } from "../packages/core/src/util.js";
it("reuses one owned parser process and closes it after distinct source requests", async () => {
  const session = createNativeSession("luau-parser");
  try {
    for (const [id, text] of [
      ["a", "return 1"],
      ["b", 'return "é😀"'],
    ]) {
      const p = await parseSource(
        {
          id: id + ":source",
          scriptId: id,
          text,
          sha256: hash(text),
          origin: { kind: "place" },
        },
        undefined,
        session,
      );
      expect(p.scriptId).toBe(id);
    }
    expect(session.stats.spawns).toBe(1);
    expect(session.stats.requests).toBe(2);
  } finally {
    await session.close();
  }
  expect(session.stats.active).toBe(false);
});
it("cancels and reaps its owned parser without leaving a live helper", async () => {
  const session = createNativeSession("luau-parser"),
    c = new AbortController();
  const pending = session.run(
    { protocolVersion: 1, text: 'return "' + "x".repeat(1000000) + '"' },
    c.signal,
  );
  c.abort();
  await expect(pending).rejects.toBeDefined();
  await session.close();
  expect(session.stats.active).toBe(false);
});
