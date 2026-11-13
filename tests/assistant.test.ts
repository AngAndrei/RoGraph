import { expect, it } from "vitest";
import { join } from "node:path";
import { answerRequest } from "../packages/assistant/src/assistant.js";
import { openStore } from "../packages/core/src/store.js";
import { createQueryEngine } from "../packages/core/src/query.js";
import type { Query } from "../packages/contracts/src/query.js";
import { resolveFixture } from "./support/resolve.js";
import { withWorkspace } from "./support/workspace.js";

async function shop(
  run: (context: {
    query: ReturnType<typeof createQueryEngine>["run"];
    graph: Awaited<ReturnType<typeof resolveFixture>>;
    calls: Query[];
  }) => Promise<void>,
) {
  await withWorkspace(async (root) => {
    const graph = await resolveFixture("shop/place.rbxlx"),
      store = await openStore(join(root, "graph.db"));
    try {
      await store.save(graph);
      await store.publish(graph.analysisId);
      const engine = createQueryEngine(store),
        calls: Query[] = [];
      await run({
        graph,
        calls,
        query: (q, signal) => {
          calls.push(structuredClone(q));
          return engine.run(q, signal);
        },
      });
    } finally {
      await store.close();
    }
  });
}

it("retrieves maintained how-to help without a game or model", async () => {
  const response = await answerRequest(
    { message: "How do I export a context pack?" },
    {
      query: async () => {
        throw Error("No game queries for help");
      },
    },
  );
  expect(
    response.cards.some(
      (card) => card.kind === "help" && card.feature?.id.includes("context"),
    ),
  ).toBe(true);
  expect(response.conversationId).toBe("help");
  expect(response.modelUsed).toBe(false);
  expect(response.helpIdentity.sha256).toMatch(/^[a-f0-9]{64}$/);
});

it("recognizes a plain help request even with a selected analysis", async () => {
  const response = await answerRequest(
    { message: "help", analysisId: "saved-analysis" },
    {
      query: async () => {
        throw Error("App help must not query a game");
      },
    },
  );
  expect(response.cards.some((card) => card.kind === "help")).toBe(true);
  expect(response.warnings).toEqual([]);
});

it("recognizes path and connection requests before generic find", async () =>
  shop(async ({ query, graph, calls }) => {
    for (const message of [
      "Find a path from ShopClient.BuySword to ShopConfig.Prices.Sword",
      "show a path between ShopClient.BuySword and ShopConfig.Prices.Sword",
    ]) {
      const response = await answerRequest(
        { message, analysisId: graph.analysisId },
        { query },
      );
      expect(
        response.cards.some(
          (card) => card.kind === "path" && card.query?.op === "trace",
        ),
      ).toBe(true);
    }
    calls.length = 0;
    const connections = await answerRequest(
      {
        message: "find connections for ShopClient.BuySword",
        analysisId: graph.analysisId,
      },
      { query },
    );
    expect(connections.cards.some((card) => card.kind === "connection")).toBe(
      true,
    );
    expect(calls[0].text).toBe("ShopClient.BuySword");
    expect(calls.some((q) => q.op === "inspect")).toBe(true);
  }));

it("requires explicit snapshot scope and does not treat conversation IDs as analysis", async () => {
  const response = await answerRequest(
    { message: "find ShopClient", conversationId: "another-analysis" },
    {
      query: async () => {
        throw Error("Scope missing");
      },
    },
  );
  expect(response.text).toMatch(/import|snapshot|analysis/i);
  expect(response.analysisId).toBeUndefined();
});

it("rejects request fields outside the strict contract", async () => {
  await expect(
    answerRequest({ message: "find x", query: { op: "overview" } } as never, {
      query: async () => {
        throw Error();
      },
    }),
  ).rejects.toThrow();
});

it("searches literal names in the pinned snapshot and creates canonical inspect cards", async () =>
  shop(async ({ query, graph, calls }) => {
    const response = await answerRequest(
      {
        message: "find ShopClient",
        analysisId: graph.analysisId,
        conversationId: "other",
      },
      { query },
    );
    expect(
      response.cards.some(
        (card) => card.label === "ShopClient" && card.query?.op === "inspect",
      ),
    ).toBe(true);
    expect(calls.every((q) => q.analysisId === graph.analysisId)).toBe(true);
    expect(response.analysisId).toBe(graph.analysisId);
  }));

it("uses the selected node for dependency and impact traversals", async () =>
  shop(async ({ query, graph, calls }) => {
    const selectedId = graph.nodes.find(
      (n) => n.label === "ShopClient.BuySword",
    )!.id;
    for (const message of [
      "dependencies of selected node",
      "impact of selected node",
    ]) {
      const response = await answerRequest(
        { message, analysisId: graph.analysisId, selectedId },
        { query },
      );
      expect(response.cards.length).toBeGreaterThan(0);
      expect(response.warnings.join(" ")).toMatch(/static|runtime/i);
    }
    expect(
      calls.some((q) => q.op === "dependencies" && q.nodeId === selectedId),
    ).toBe(true);
    expect(
      calls.some((q) => q.op === "impact" && q.nodeId === selectedId),
    ).toBe(true);
  }));

it("verifies named trace endpoints and copies real source evidence", async () =>
  shop(async ({ query, graph, calls }) => {
    const response = await answerRequest(
      {
        message: "trace from ShopClient.BuySword to ShopConfig.Prices.Sword",
        analysisId: graph.analysisId,
      },
      { query },
    );
    expect(
      response.cards.some(
        (card) => card.kind === "path" && card.query?.op === "trace",
      ),
    ).toBe(true);
    expect(response.cards.some((card) => card.source)).toBe(true);
    for (const card of response.cards.filter((card) => card.source)) {
      expect(graph.evidence).toContainEqual(card.source!.evidence);
      expect(card.source!.analysisId).toBe(graph.analysisId);
    }
    expect(calls.length).toBeLessThanOrEqual(6);
    expect(calls.filter((q) => q.op === "trace")).toHaveLength(1);
  }));

it("opens source through real locators and marks connection direction", async () =>
  shop(async ({ query, graph }) => {
    const selectedId = graph.nodes.find(
      (n) => n.label === "ShopClient.BuySword",
    )!.id;
    const source = await answerRequest(
      {
        message: "source of selected node",
        analysisId: graph.analysisId,
        selectedId,
      },
      { query },
    );
    expect(
      source.cards.some(
        (card) =>
          card.query?.op === "source" &&
          graph.sources.some((s) => s.id === card.query!.sourceId),
      ),
    ).toBe(true);
    const connections = await answerRequest(
      {
        message: "connections of selected node",
        analysisId: graph.analysisId,
        selectedId,
      },
      { query },
    );
    expect(
      connections.cards.some(
        (card) =>
          card.kind === "connection" &&
          /incoming|outgoing/i.test(card.detail ?? ""),
      ),
    ).toBe(true);
  }));

it("rejects model scope injection and falls back to bounded search", async () =>
  shop(async ({ query, graph, calls }) => {
    const response = await answerRequest(
      { message: "please look into ShopClient", analysisId: graph.analysisId },
      {
        query,
        interpret: async () =>
          ({ op: "search", text: "ShopClient", analysisId: "stolen" }) as never,
      },
    );
    expect(response.warnings.join(" ")).toMatch(/model|intent/i);
    expect(calls.every((q) => q.analysisId === graph.analysisId)).toBe(true);
    expect(calls.length).toBeLessThanOrEqual(6);
  }));

it("explains runtime limits and points to context export or MCP", async () => {
  const response = await answerRequest(
    { message: "Why is my game lagging at runtime?", analysisId: "snapshot" },
    {
      query: async () => {
        throw Error("No runtime query");
      },
    },
  );
  expect(response.text).toMatch(/static|runtime/i);
  expect(JSON.stringify(response.cards)).toMatch(/context|mcp/i);
});

it("returns qualified choices for ambiguous names and prefers an exact label over prefixes", async () =>
  shop(async ({ query, graph, calls }) => {
    const ambiguous = await answerRequest(
      { message: "dependencies of ShopC", analysisId: graph.analysisId },
      { query },
    );
    expect(ambiguous.text).toMatch(/choose|qualified/i);
    expect(ambiguous.cards.length).toBeGreaterThan(1);
    expect(ambiguous.cards.every((card) => card.detail?.includes("·"))).toBe(
      true,
    );
    for (const card of ambiguous.cards) {
      const node = graph.nodes.find((item) => item.id === card.id)!;
      const parent = node.attributes.parentId ?? node.ownerId;
      if (typeof parent === "string") expect(card.detail).toContain(parent);
    }
    expect(calls.every((q) => q.op === "search")).toBe(true);
    calls.length = 0;
    await answerRequest(
      { message: "dependencies of ShopClient", analysisId: graph.analysisId },
      { query },
    );
    expect(
      calls.some(
        (q) =>
          q.op === "dependencies" &&
          q.nodeId === graph.nodes.find((n) => n.label === "ShopClient")!.id,
      ),
    ).toBe(true);
  }));

it("never traces unverified endpoint names or candidate IDs", async () =>
  shop(async ({ query, graph, calls }) => {
    const response = await answerRequest(
      {
        message: "trace from invented-node to ShopClient",
        analysisId: graph.analysisId,
      },
      { query },
    );
    expect(response.text).toMatch(/no verified/i);
    expect(calls.some((q) => q.op === "trace")).toBe(false);
  }));

it("rejects a result from a different snapshot and propagates cancellation", async () =>
  shop(async ({ query, graph }) => {
    const response = await answerRequest(
      { message: "find ShopClient", analysisId: graph.analysisId },
      {
        query: async (q) => ({
          ...(await query(q)),
          analysisId: "replacement",
        }),
      },
    );
    expect(response.cards).toEqual([]);
    expect(response.warnings.join(" ")).toMatch(/no replacement/i);
    const controller = new AbortController();
    controller.abort();
    await expect(
      answerRequest(
        { message: "find ShopClient", analysisId: graph.analysisId },
        { query, signal: controller.signal },
      ),
    ).rejects.toThrow();
  }));

it("uses a valid model only to name an intent and preserves the request view", async () =>
  shop(async ({ query, graph, calls }) => {
    const response = await answerRequest(
      {
        message: "please locate my shop client",
        analysisId: graph.analysisId,
        view: "code",
      },
      {
        query,
        interpret: async () => ({
          op: "search",
          text: "ShopClient",
          view: "gameplay",
        }),
      },
    );
    expect(response.modelUsed).toBe(true);
    expect(response.cards.some((card) => card.label === "ShopClient")).toBe(
      true,
    );
    expect(
      calls.every(
        (q) => q.view === "code" && q.analysisId === graph.analysisId,
      ),
    ).toBe(true);
  }));
