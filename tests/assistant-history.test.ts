import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdir, stat, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHistory } from "../packages/assistant/src/history.js";
import type { AssistantResponse } from "../packages/contracts/src/assistant.js";
import { withWorkspace } from "./support/workspace.js";
const response: AssistantResponse = {
  id: "response",
  conversationId: "help",
  text: "Saved",
  cards: [],
  warnings: [],
  modelUsed: false,
  helpIdentity: { appVersion: "0.2.0", sha256: "a".repeat(64) },
};

it("persists only the most recent twenty turns per scope", async () =>
  withWorkspace(async (root) => {
    const history = await createHistory(root);
    for (let index = 0; index < 25; index++)
      await history.append("snapshot", `turn ${index}`, response);
    const turns = await (await createHistory(root)).list("snapshot");
    expect(turns).toHaveLength(20);
    expect(turns[0].message).toBe("turn 5");
    expect(turns.at(-1)?.message).toBe("turn 24");
  }));

it("isolates hostile scope names, clears only its scope, and leaves no temporary files", async () =>
  withWorkspace(async (root) => {
    const history = await createHistory(root);
    await Promise.all([
      history.append("../../outside", "private", response),
      history.append("snapshot", "kept", response),
    ]);
    expect(await readdir(root)).toContain(
      `${createHash("sha256").update("snapshot").digest("hex")}.json`,
    );
    expect(await history.list("../../outside")).toHaveLength(1);
    await history.clear("../../outside");
    expect(await (await createHistory(root)).list("../../outside")).toEqual([]);
    expect(await history.list("snapshot")).toHaveLength(1);
    for (const name of await readdir(root)) {
      expect(name).not.toMatch(/outside|\.tmp$/);
      expect((await stat(`${root}/${name}`)).isFile()).toBe(true);
    }
  }));

it("bounds total history to one hundred scopes", async () =>
  withWorkspace(async (root) => {
    const history = await createHistory(root);
    for (let index = 0; index < 105; index++)
      await history.append(`scope ${index}`, "turn", response);
    expect(await history.list("scope 0")).toEqual([]);
    expect(await history.list("scope 104")).toHaveLength(1);
  }));

it("ignores malformed JSON without preventing startup or changing the corrupt file", async () =>
  withWorkspace(async (root) => {
    const file = join(
      root,
      `${createHash("sha256").update("snapshot").digest("hex")}.json`,
    );
    await writeFile(file, "{broken");
    const history = await createHistory(root);
    expect(await history.list("snapshot")).toEqual([]);
    expect(await readFile(file, "utf8")).toBe("{broken");
  }));

it("skips invalid response shapes and cross-analysis references while retaining valid turns", async () =>
  withWorkspace(async (root) => {
    const file = join(
      root,
      `${createHash("sha256").update("snapshot").digest("hex")}.json`,
    );
    const invalid = [
      { ...response, cards: null },
      { ...response, warnings: [42] },
      { ...response, helpIdentity: { appVersion: "0.2.0" } },
      {
        ...response,
        analysisId: "snapshot",
        cards: [
          {
            kind: "node",
            id: "node",
            label: "Node",
            query: { op: "inspect", analysisId: "other", nodeId: "node" },
          },
        ],
      },
      { ...response, analysisId: "other", cards: [] },
      {
        ...response,
        analysisId: "snapshot",
        cards: [
          {
            kind: "connection",
            id: "edge",
            label: "Edge",
            source: { analysisId: "snapshot", evidence: {} },
          },
        ],
      },
      {
        ...response,
        analysisId: "snapshot",
        cards: [
          {
            kind: "connection",
            id: "edge",
            label: "Edge",
            source: {
              analysisId: "other",
              evidence: {
                id: "evidence",
                relationId: "edge",
                instanceId: "node",
                propertyName: "Value",
                rule: "saved",
                status: "saved",
                assumptions: [],
                contexts: ["server"],
              },
            },
          },
        ],
      },
      {
        ...response,
        cards: [
          {
            kind: "help",
            id: "bad-help",
            label: "Bad help",
            feature: { steps: 42 },
          },
        ],
      },
    ];
    await writeFile(
      file,
      JSON.stringify([
        { message: "valid", response },
        {
          message: "valid graph",
          response: {
            ...response,
            analysisId: "snapshot",
            cards: [
              {
                kind: "node",
                id: "node",
                label: "Node",
                query: {
                  op: "inspect",
                  analysisId: "snapshot",
                  nodeId: "node",
                  view: "code",
                },
              },
            ],
          },
        },
        ...invalid.map((response) => ({ message: "corrupt", response })),
      ]),
    );
    const history = await createHistory(root);
    expect(
      (await history.list("snapshot")).map((turn) => turn.message),
    ).toEqual(["valid", "valid graph"]);
  }));
