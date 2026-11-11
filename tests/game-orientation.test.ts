import { describe, it, expect } from "vitest";
import type { QueryResult } from "../packages/contracts/src/query.js";
import type { Node, Relation } from "../packages/contracts/src/model.js";
import {
  startingScripts,
  relationshipSummary,
} from "../apps/web/src/game-orientation.js";
const node = (id: string, className = "Part"): Node => ({
  id,
  label: id,
  kind: "instance",
  contexts: ["server"],
  attributes: { className },
});
const rel = (
  id: string,
  source: string,
  target: string,
  type: Relation["type"],
  label: string,
): Relation => ({
  id,
  source,
  target,
  type,
  gameplay: {
    label,
    method: label,
    sourceScriptId: "timer",
    ownerId: "timer",
    guards: [],
    conditional: false,
  } as any,
});
const result = (): QueryResult => ({
  analysisId: "a",
  nodes: [
    node("timer", "Script"),
    node("Players", "Players"),
    node("Lifetime", "IntValue"),
    node("audio", "Script"),
    node("Sound", "Sound"),
    node("geometry"),
  ],
  relations: [
    rel("event", "Players", "timer", "TRIGGERS", "PlayerAdded → handler"),
    rel("create", "timer", "Lifetime", "SPAWNS", "creates Lifetime"),
    rel("write", "timer", "Lifetime", "MODIFIES", "sets Value"),
    rel("unknown", "audio", "Sound", "USES_OBJECT", "API behavior not modeled"),
  ],
  evidence: [],
  sites: [],
  sources: [],
  diagnostics: [],
  paths: [],
  groups: [],
  coverage: {} as any,
  meta: { truncated: false, omittedCounts: {}, limits: {} },
});
describe("first-time game orientation", () => {
  it("suggests connected saved scripts with events and effects rather than geometry or unmodeled API calls", () => {
    const entries = startingScripts(result());
    expect(entries.map((e) => e.node.id)).toEqual(["timer"]);
    expect(entries[0].triggers).toBe(1);
    expect(entries[0].connectedObjects).toBe(2);
    expect(entries[0].example).toMatchObject({
      fromId: "timer",
      toId: "Lifetime",
      label: "creates Lifetime",
    });
  });
  it("keeps incoming triggers and outgoing effects distinct and does not invent a game summary", () => {
    const summary = relationshipSummary(result(), "timer");
    expect(summary.incoming.map((r) => r.id)).toEqual(["event"]);
    expect(summary.outgoing.map((r) => r.id)).toEqual(["create", "write"]);
    expect(relationshipSummary(result(), "geometry")).toEqual({
      incoming: [],
      outgoing: [],
    });
    expect(startingScripts({ ...result(), relations: [] })).toEqual([]);
  });
  it("ignores dangling relationships and deduplicates repeated canonical records", () => {
    const r = result();
    r.relations.push(
      r.relations[0],
      rel("missing", "timer", "not-retained", "SPAWNS", "clones"),
    );
    expect(startingScripts(r)[0].triggers).toBe(1);
    expect(startingScripts(r)[0].connectedObjects).toBe(2);
  });
  it("ranks deterministically and counts unique neighbors rather than repeated actions", () => {
    const r = result();
    r.nodes.push(node("input", "LocalScript"), node("button", "TextButton"));
    r.relations.push(
      rel("click", "button", "input", "TRIGGERS", "Activated → handler"),
    );
    const order = startingScripts(r).map((e) => e.node.id);
    expect(
      startingScripts({
        ...r,
        nodes: [...r.nodes].reverse(),
        relations: [...r.relations].reverse(),
      }).map((e) => e.node.id),
    ).toEqual(order);
  });
});
