import { it, expect } from "vitest";
import { runNative } from "../packages/adapters/src/native.js";
import { fixturePath } from "./support/fixtures.js";
it("retains unknown typed properties and dangling serialized references", async () => {
  const r = await runNative<any>("rbx-import", {
    protocolVersion: 1,
    requestId: "import-test",
    operation: "import",
    path: fixturePath("adversarial/partial.rbxlx"),
  });
  expect(r.diagnostics.map((d: any) => d.code)).toEqual(
    expect.arrayContaining(["UNKNOWN_PROPERTY_TYPE", "DANGLING_REFERENT"]),
  );
  expect(r.inventory.items.length).toBeGreaterThan(5);
  expect(
    r.instances.some(
      (i: any) => i.name === "Purchase" && i.className === "RemoteEvent",
    ),
  ).toBe(true);
});
it("rejects DTD-bearing input without resolving entities", async () => {
  await expect(
    runNative("rbx-import", {
      protocolVersion: 1,
      requestId: "bad",
      operation: "import",
      xml: '<!DOCTYPE roblox [<!ENTITY secret SYSTEM "file:///x">]><roblox version="4"/>',
    }),
  ).rejects.toThrow(/DTD|DOCTYPE/);
});
