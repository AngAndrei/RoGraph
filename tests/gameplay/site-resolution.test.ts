import { expect, it } from "vitest";
import { gameplayGraph } from "./graph.js";

const storage = 'local storage = game:GetService("ReplicatedStorage")';

it("keeps ordinary project methods resolved when their names match event operations", async () => {
  const graph = await gameplayGraph({
    ActionConfig: "return {Fire=function() end, Connect=function() end}",
    GameServer: `${storage}\nlocal actions = require(storage.ActionConfig)\nactions:Fire()\nactions:Connect(function() end)`,
  });
  const calls = graph.sites.filter(
    (site) => site.kind === "call" && site.span.startLine >= 3,
  );
  expect(calls).toHaveLength(2);
  for (const site of calls) {
    const evidence = graph.evidence.find(
      (item) =>
        item.siteId === site.id && item.rule === "lexical-exported-function",
    );
    const relation = graph.relations.find(
      (item) => item.id === evidence?.relationId,
    );
    expect(relation?.type).toBe("CALLS");
    expect(site).toMatchObject({
      status: "resolved",
      targetIds: [relation?.target],
    });
  }
});

it("keeps the context mismatch on the final site and never confirms the send", async () => {
  const graph = await gameplayGraph({
    GameServer: `${storage}\nstorage.HomeTeleportEvent:FireServer()`,
    GameClient: `${storage}\nstorage.HomeTeleportEvent:FireServer()`,
  });
  const diagnostic = graph.diagnostics.find(
    (item) => item.code === "EXECUTION_CONTEXT_MISMATCH",
  );
  const site = graph.sites.find((item) => item.id === diagnostic?.siteId);
  expect(site).toMatchObject({
    status: "candidate",
    reason: "EXECUTION_CONTEXT_MISMATCH",
    targetIds: ["remote"],
    contexts: ["server"],
  });
  expect(graph.coverage.candidateSites).toBeGreaterThanOrEqual(1);
  expect(graph.relations.filter((item) => item.type === "SENDS_VIA")).toEqual([
    expect.objectContaining({ source: "script:GameClient", target: "remote" }),
  ]);
});

it("retains possible module targets from a conditional require without confirming a dependency", async () => {
  const graph = await gameplayGraph({
    ActionConfig: "return {}",
    OtherConfig: "return {}",
    GameServer: `${storage}\nlocal config = require(if runtime then storage.ActionConfig else storage.OtherConfig)`,
  });
  const site = graph.sites.find(
    (item) => item.kind === "call" && item.span.startLine === 2,
  );
  expect(site).toMatchObject({
    status: "candidate",
    reason: "CONDITIONAL_OR_OPEN_VALUE",
  });
  expect(site?.targetIds.toSorted()).toEqual([
    "script:ActionConfig",
    "script:OtherConfig",
  ]);
  expect(
    graph.relations.some(
      (item) => item.type === "REQUIRES" && item.source === "script:GameServer",
    ),
  ).toBe(false);
});

it("retains the resolver reason for a direct child read with no saved match", async () => {
  const graph = await gameplayGraph({
    GameServer: `${storage}\nlocal missing = storage.NotInThisPlace\nlocal remote = storage.HomeTeleportEvent`,
  });
  const missing = graph.sites.find(
    (item) => item.kind === "read" && item.span.startLine === 2,
  );
  const remote = graph.sites.find(
    (item) => item.kind === "read" && item.span.startLine === 3,
  );
  expect(missing).toMatchObject({
    status: "unresolved",
    reason: "MISSING_SAVED_CHILD",
    targetIds: [],
  });
  expect(remote).toMatchObject({ status: "resolved", targetIds: ["remote"] });
});

it("leaves a known signal connection unresolved when it cannot identify a handler", async () => {
  const graph = await gameplayGraph({
    GameServer: `${storage}\nlocal signal = storage.HomeTeleportEvent.OnServerEvent\nsignal:Connect(runtimeHandler)\nsignal:Connect(function() end)`,
  });
  const calls = graph.sites.filter((site) => site.kind === "call");
  expect(calls.find((site) => site.span.startLine === 3)).toMatchObject({
    status: "unresolved",
    reason: "HANDLER_TARGET_UNRESOLVED",
  });
  expect(calls.find((site) => site.span.startLine === 4)).toMatchObject({
    status: "resolved",
    targetIds: ["remote"],
  });
  expect(graph.relations.filter((rel) => rel.type === "HANDLES")).toHaveLength(
    1,
  );
});

it("leaves an unmodeled method as a candidate with the available receiver evidence", async () => {
  const graph = await gameplayGraph({
    GameServer:
      'local storage = game:GetService("ServerStorage")\nstorage:GetFullName()',
  });
  const site = graph.sites.find(
    (item) => item.kind === "call" && item.span.startLine === 2,
  );
  expect(site).toMatchObject({
    status: "candidate",
    reason: "UNMODELED_PLATFORM_BEHAVIOR",
    targetIds: ["server"],
  });
  expect(graph.diagnostics).toContainEqual(
    expect.objectContaining({
      siteId: site?.id,
      code: "UNMODELED_PLATFORM_BEHAVIOR",
    }),
  );
  expect(graph.relations).toContainEqual(
    expect.objectContaining({
      type: "USES_OBJECT",
      source: "script:GameServer",
      target: "server",
    }),
  );
});

it("retains known function alternatives without confirming a dynamic call edge", async () => {
  const graph = await gameplayGraph({
    GameServer:
      "local a = function() end\nlocal b = function() end\nlocal choose = if runtime then a else b\nchoose()",
  });
  const site = graph.sites.find((item) => item.kind === "call");
  const functionIds = graph.nodes
    .filter((node) => node.kind === "function")
    .map((node) => node.id);
  expect(functionIds).toHaveLength(2);
  expect(site).toMatchObject({
    status: "candidate",
    reason: "CONDITIONAL_OR_OPEN_VALUE",
  });
  expect(site?.targetIds.toSorted()).toEqual(functionIds.toSorted());
  expect(graph.relations.some((rel) => rel.type === "CALLS")).toBe(false);
});
