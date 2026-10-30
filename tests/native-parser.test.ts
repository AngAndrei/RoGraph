import { it, expect } from "vitest";
import { createHash } from "node:crypto";
import { parseSource } from "../packages/adapters/src/native.js";
const source = (text: string) => ({
  id: "source",
  scriptId: "script",
  text,
  sha256: createHash("sha256").update(text).digest("hex"),
  origin: { kind: "place" as const },
});
it("maps official parser spans through UTF8 and CRLF correctly", async () => {
  const s = source("-- café 🛒\r\nlocal price = Config.Prices.Sword\r\n");
  const p = await parseSource(s);
  const span = p.spans.find(
    (v) =>
      Buffer.from(s.text)
        .subarray(v.span.startByte, v.span.endByte)
        .toString() === "Config.Prices.Sword",
  )!.span;
  expect([
    span.startByte,
    span.endByte,
    span.startLine,
    span.startColumn,
  ]).toEqual([29, 48, 2, 15]);
  expect(p.diagnostics).toEqual([]);
});
it("parses typed Luau without running its body", async () => {
  const p = await parseSource(
    source(
      'local x: {number} = {1,2}\nfor _, v in x do print(`value {v}`) end\nerror("must never execute")',
    ),
  );
  expect(p.diagnostics).toEqual([]);
  expect(p.ast.type).toBe("AstStatBlock");
});
it("returns invalid syntax as a diagnostic and supports cancellation", async () => {
  expect(
    (await parseSource(source("local = ???"))).diagnostics.some(
      (v) => v.code === "LUAU_PARSE_ERROR",
    ),
  ).toBe(true);
  const c = new AbortController();
  c.abort();
  await expect(parseSource(source("return 1"), c.signal)).rejects.toBeDefined();
});
