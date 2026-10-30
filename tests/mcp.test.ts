import { it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { analyzeFixture } from "./support/analyze.js";
import { withWorkspace } from "./support/workspace.js";
it("negotiates the actual read-only stdio tools and pins every query", async () =>
  withWorkspace(async (dir) => {
    const g = await analyzeFixture("shop/place.rbxlx", dir),
      client = new Client({ name: "rograph-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        "--import",
        "tsx",
        "apps/local/src/cli.ts",
        "mcp",
        "--workspace",
        dir,
      ],
      stderr: "pipe",
    });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toEqual(
        expect.arrayContaining([
          "workspace",
          "inspect",
          "source",
          "context",
          "coverage",
        ]),
      );
      expect(
        tools.tools.some((t) => ["exec", "write_file", "sql"].includes(t.name)),
      ).toBe(false);
      expect(tools.tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
      const workspace = await client.callTool({
        name: "workspace",
        arguments: {},
      });
      expect((workspace.structuredContent as any).current).toBe(g.analysisId);
      const price = g.nodes.find((n) => n.label === "ShopConfig.Prices.Sword")!;
      const impact = await client.callTool({
        name: "impact",
        arguments: { analysisId: g.analysisId, nodeId: price.id, depth: 6 },
      });
      expect(
        (impact.structuredContent as any).nodes.some(
          (n: any) => n.label === "PurchaseService.TryPurchase",
        ),
      ).toBe(true);
      const context = await client.callTool({
        name: "context",
        arguments: {
          query: { op: "impact", analysisId: g.analysisId, nodeId: price.id },
          estimatedTokenBudget: 2000,
        },
      });
      expect(
        (context.structuredContent as any).estimatedTokens,
      ).toBeLessThanOrEqual(2000);
      const bad = await client.callTool({
        name: "source",
        arguments: { analysisId: g.analysisId, sourceId: "../../secret" },
      });
      expect(bad.isError).toBe(true);
    } finally {
      await client.close();
      await transport.close();
    }
  }));
