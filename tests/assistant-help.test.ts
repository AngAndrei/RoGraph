import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import maintainedHelp from "../docs/app-functionalities.json";
import packageInfo from "../package.json";
import {
  chatRequestSchema,
  helpFileSchema,
  intentSchema,
} from "../packages/contracts/src/assistant.js";
import {
  features,
  helpIdentity,
  searchHelp,
} from "../packages/assistant/src/help.js";

describe("maintained assistant help", () => {
  it.each([
    ["what breaks if I change this component?", "impact"],
    ["which components does this script depend on?", "dependencies"],
    ["Find a script anywhere in the project", "project-search"],
    ["Search nodes on the current canvas", "canvas-search"],
    ["Find text inside the saved source file", "source-find"],
    ["Search for a string inside a script", "source-find"],
    ["Who depends on this script?", "impact"],
    ["What does the selected module depend on?", "dependencies"],
    ["CTRL+F, then next match in source", "source-find"],
    ["How do I import my rbxl place?", "import-place"],
    ["watch saved changes in a Rojo project", "rojo-watch"],
    ["trace configuration influence", "trace-influence"],
    ["choose CPU or GPU for the local model", "assistant-backend"],
    ["download a smaller local model", "assistant-models"],
  ])("answers the task %s", (question, id) => {
    const answer = searchHelp(question, 1)[0];
    expect(answer?.id).toBe(id);
    expect(answer?.steps.length).toBeGreaterThan(0);
    expect(answer?.limitations.length).toBeGreaterThan(0);
  });

  it("normalizes punctuation and case without returning unrelated results", () => {
    expect(searchHelp("  DEPENDENCIES?!  ", 1)[0]?.id).toBe("dependencies");
    expect(searchHelp("zzzxxyyqq")).toEqual([]);
    expect(searchHelp(" ")).toEqual([]);
    expect(searchHelp("graph", 0)).toEqual([]);
    expect(searchHelp("graph", -2)).toEqual([]);
    expect(searchHelp("graph").length).toBeLessThanOrEqual(3);
  });

  it("ties usable help to the app version and actual maintained content", () => {
    expect(helpIdentity.appVersion).toBe(packageInfo.version);
    expect(helpIdentity.sha256).toBe(
      createHash("sha256").update(JSON.stringify(maintainedHelp)).digest("hex"),
    );
    expect(features.length).toBeGreaterThan(20);
    expect(helpFileSchema.safeParse(maintainedHelp).success).toBe(true);
  });

  it("rejects stale, duplicate and malformed help records", () => {
    expect(
      helpFileSchema.safeParse({ ...maintainedHelp, appVersion: "0.0.1" })
        .success,
    ).toBe(false);
    expect(
      helpFileSchema.safeParse({
        ...maintainedHelp,
        features: [maintainedHelp.features[0], maintainedHelp.features[0]],
      }).success,
    ).toBe(false);
    expect(
      helpFileSchema.safeParse({
        ...maintainedHelp,
        features: [{ ...maintainedHelp.features[0], steps: [] }],
      }).success,
    ).toBe(false);
  });

  it.each([
    { navigationAction: "https://example.com" },
    { navigationAction: "execute" },
    { command: "powershell.exe" },
    { query: "SELECT * FROM nodes" },
    { url: "https://example.com" },
  ])("rejects executable help metadata %j", (unsafe) => {
    expect(
      helpFileSchema.safeParse({
        ...maintainedHelp,
        features: [{ ...maintainedHelp.features[0], ...unsafe }],
      }).success,
    ).toBe(false);
  });

  it("works as an isolated bundled module without reading docs at runtime", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rograph-help-"));
    try {
      const output = await build({
        entryPoints: ["packages/assistant/src/help.ts"],
        bundle: true,
        platform: "node",
        format: "esm",
        write: false,
      });
      const bundlePath = join(directory, "help.mjs");
      await writeFile(bundlePath, output.outputFiles[0].contents);
      const result = execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `const help = await import(${JSON.stringify(pathToFileURL(bundlePath).href)}); console.log(JSON.stringify({id:help.searchHelp('dependencies',1)[0].id,identity:help.helpIdentity}));`,
        ],
        { cwd: directory, encoding: "utf8" },
      );
      expect(JSON.parse(result)).toEqual({
        id: "dependencies",
        identity: helpIdentity,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("assistant input boundaries", () => {
  it("accepts scoped chat and narrow declarative intents", () => {
    expect(
      chatRequestSchema.parse({
        message: "inspect Shop",
        analysisId: "snapshot-1",
        view: "gameplay",
        selectedId: "node:Shop",
        mode: "game",
        fromId: "one",
        toId: "two",
        conversationId: "conversation-1",
      }).selectedId,
    ).toBe("node:Shop");
    expect(
      intentSchema.parse({
        op: "trace",
        from: "BuyButton",
        to: "Price",
        view: "gameplay",
        traceGoal: "influence",
        useSelection: false,
      }).op,
    ).toBe("trace");
    expect(
      chatRequestSchema.safeParse({
        message: "x".repeat(8000),
        analysisId: "a".repeat(2048),
      }).success,
    ).toBe(true);
  });

  it.each([
    { message: "" },
    { message: "  " },
    { message: "x".repeat(8001) },
    { message: "help", analysisId: "a".repeat(2049) },
    { message: "help", selectedId: "" },
    { message: "help", conversationId: "\u0000" },
    { message: "help", mode: "execute" },
    { message: "help", view: "all" },
    { message: "help", query: { op: "overview" } },
    { message: "help", sql: "DROP TABLE nodes" },
    { message: "help", url: "https://example.com" },
    { message: "help", command: "powershell" },
  ])("rejects invalid requests %j", (request) => {
    expect(chatRequestSchema.safeParse(request).success).toBe(false);
  });

  it.each([
    { op: "execute", text: "rm" },
    { op: "source", url: "https://example.com" },
    { op: "search", sql: "SELECT * FROM nodes" },
    { op: "impact", query: { analysisId: "other" } },
    { op: "search", analysisId: "other" },
    { op: "trace", fromId: "untrusted-id" },
    { op: "trace", traceGoal: "execute" },
    { op: "search", text: "x".repeat(8001) },
  ])("rejects intents outside the allowlist %j", (intent) => {
    expect(intentSchema.safeParse(intent).success).toBe(false);
  });
});
