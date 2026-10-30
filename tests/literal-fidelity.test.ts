import { it, expect } from "vitest";
import { parseSource, runNative } from "../packages/adapters/src/native.js";
import { hash } from "../packages/core/src/util.js";
it("encodes nonfinite numbers and binary Luau strings without losing other syntax", async () => {
  const text = 'return {Huge=1e400,Bytes="\\255"}',
    p = await parseSource({
      id: "s",
      scriptId: "i",
      text,
      sha256: hash(text),
      origin: { kind: "place" },
    });
  expect(p.diagnostics).toEqual([]);
  const values = p.ast.body[0].list[0].items.map((i: any) => i.value.value);
  expect(values[0]).toEqual({ nonFinite: "Infinity" });
  expect(values[1]).toEqual({ bytesHex: "ff", encoding: "luau-bytes" });
});
it("does not silently turn a saved infinite numeric property into null", async () => {
  const r = await runNative<any>("rbx-import", {
    protocolVersion: 1,
    xml: '<roblox version="4"><Item class="NumberValue" referent="n"><Properties><string name="Name">Huge</string><double name="Value">1e309</double></Properties></Item></roblox>',
  });
  expect(
    r.instances.find((i: any) => i.name === "Huge").properties.Value.value,
  ).toEqual({ nonFinite: "Infinity" });
});
it("retains large saved integers exactly and labels unmodeled nonfinite components", async () => {
  const r = await runNative<any>("rbx-import", {
    protocolVersion: 1,
    xml: '<roblox version="4"><Item class="IntValue" referent="i"><Properties><string name="Name">Integer</string><int64 name="Value">9223372036854775807</int64></Properties></Item><Item class="SpecialMesh" referent="m"><Properties><string name="Name">Mesh</string><Vector3 name="Scale"><X>1e309</X><Y>0</Y><Z>1</Z></Vector3></Properties></Item></roblox>',
  });
  expect(
    r.instances.find((i: any) => i.name === "Integer").properties.Value.value,
  ).toEqual({ int64: "9223372036854775807" });
  expect(
    r.instances.find((i: any) => i.name === "Mesh").properties.Scale
      .unsupported,
  ).toBe(true);
  expect(r.diagnostics.some((d: any) => d.code === "NON_FINITE_PROPERTY")).toBe(
    true,
  );
});
