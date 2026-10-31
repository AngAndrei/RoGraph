import { it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importPlace } from "../packages/core/src/import.js";
import { parseSource } from "../packages/adapters/src/native.js";
import { hash } from "../packages/core/src/util.js";
it.each([
  '<Region3 name="SavedRegion"/>',
  '<BinaryString name="AttributesSerialize">AQ==</BinaryString>',
])(
  "marks lost/fallback serialized properties partial: %s",
  async (property) => {
    const directory = await mkdtemp(join(tmpdir(), "rograph-fidelity-"));
    try {
      const path = join(directory, "place.rbxlx");
      await writeFile(
        path,
        `<roblox version="4"><Item class="Folder" referent="f"><Properties><string name="Name">Folder</string>${property}</Properties></Item></roblox>`,
      );
      const snapshot = await importPlace(path);
      expect(snapshot.coverage.partialImport).toBe(true);
      expect(
        snapshot.diagnostics.some((d) =>
          [
            "PROPERTY_NOT_RETAINED",
            "PROPERTY_DECODE_FALLBACK",
            "DECODER_WARNING",
          ].includes(d.code),
        ),
      ).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
it("imports official binary places without changing their bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rograph-binary-"));
  try {
    const path = join(directory, "saved.rbxl"),
      bytes = Buffer.from(
        await readFile("fixtures/binary/shop.rbxl.base64", "utf8"),
        "base64",
      );
    await writeFile(path, bytes);
    const snapshot = await importPlace(path);
    expect(snapshot.sources.length).toBeGreaterThan(0);
    expect(snapshot.sources.some((s) => s.text.includes("TryPurchase"))).toBe(
      true,
    );
    expect(snapshot.coverage.partialImport).toBe(false);
    expect(await readFile(path)).toEqual(bytes);
    expect(snapshot.inventory.rawInput.byteLength).toBe(bytes.length);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("retains indexed parse-error locations with Unicode and CRLF", async () => {
  const text = "-- café 🐤\r\nlocal broken =\r\n";
  const parsed = await parseSource({
    id: "diagnostic-source",
    scriptId: "diagnostic-script",
    text,
    sha256: hash(text),
    origin: { kind: "place" },
  });
  const diagnostic = parsed.diagnostics[0];
  expect(diagnostic.sourceId).toBe("diagnostic-source");
  expect(diagnostic.span).toBeDefined();
  expect(diagnostic.span!.startLine).toBeGreaterThanOrEqual(2);
  expect(diagnostic.span!.endByte).toBeLessThanOrEqual(Buffer.byteLength(text));
});
