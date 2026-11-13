import { randomUUID } from "node:crypto";
import {
  chatRequestSchema,
  intentSchema,
  type AssistantCard,
  type AssistantRequest,
  type AssistantResponse,
  type AssistantIntent,
} from "../../contracts/src/assistant.js";
import type { Query, QueryResult } from "../../contracts/src/query.js";
import type { Node, Evidence } from "../../contracts/src/model.js";
import { features, helpIdentity, searchHelp } from "./help.js";
export interface AssistantServices {
  query: (query: Query, signal?: AbortSignal) => Promise<QueryResult>;
  interpret?: (
    message: string,
    context: { view?: "code" | "gameplay"; selectedId?: string },
    signal?: AbortSignal,
  ) => Promise<AssistantIntent>;
  signal?: AbortSignal;
}

function unquote(text: string): string {
  return text
    .trim()
    .replace(/[?.!]$/, "")
    .replace(/^["'`]|["'`]$/g, "")
    .trim();
}

function deterministic(message: string): AssistantIntent | undefined {
  const trace =
    /^(?:(?:find|show|trace)\s+(?:(?:a|the)\s+)?(?:path|flow)|trace)\s+(?:from\s+)?(.+?)\s+to\s+(.+)$/i.exec(
      message,
    );
  if (trace)
    return { op: "trace", from: unquote(trace[1]), to: unquote(trace[2]) };
  const between =
    /^(?:(?:find|show|trace)\s+(?:(?:a|the)\s+)?(?:path|flow)|trace)\s+between\s+(.+?)\s+and\s+(.+)$/i.exec(
      message,
    );
  if (between)
    return { op: "trace", from: unquote(between[1]), to: unquote(between[2]) };
  const action =
    /^(?:(?:find|show|list|open|explain)\s+)?(?:(?:the|its)\s+)?(dependencies|dependency|deps|impact|dependents|source(?: code)?|connections|inspect)(?:\s+(?:of|for|on))?\s*(.*)$/i.exec(
      message,
    );
  if (action) {
    const name = action[1].toLowerCase();
    const op = /^(dependencies|dependency|deps)$/.test(name)
      ? "dependencies"
      : /^(impact|dependents)$/.test(name)
        ? "impact"
        : name.startsWith("source")
          ? "source"
          : (name as "connections" | "inspect");
    return {
      op,
      text: action[2] ? unquote(action[2]) : undefined,
      useSelection:
        !action[2] ||
        /^(the )?(selected( node)?|selection|this( node)?|it)$/i.test(
          action[2],
        ),
    };
  }
  if (
    /^(?:inspect|explain|show)\s+(?:the )?selected(?: node)?[?.!]?$/i.test(
      message,
    )
  )
    return { op: "inspect", useSelection: true };
  const search = /^(?:find|search(?: for)?|look up)\s+(.+)$/i.exec(message);
  if (search) return { op: "search", text: unquote(search[1]) };
  return undefined;
}

function isHelp(message: string): boolean {
  return (
    /^(?:help|what can (?:you|rograph) do)[?.!]?$/i.test(message) ||
    (/^(?:help\b|how (?:do|can|to)\b|where (?:do|can) i\b)/i.test(message) &&
      /\b(?:import|export|rograph|context|mcp|search|trace|dependencies|impact|source|settings|model|snapshot|coverage|graph|rojo|assistant|gpu|cpu|navigate|filter|code view|gameplay view)\b/i.test(
        message,
      ))
  );
}

function qualified(node: Node): string {
  const path =
    node.attributes.path ??
    node.attributes.instancePath ??
    node.attributes.scriptPath ??
    node.attributes.originalPath;
  const className =
    node.attributes.className ?? node.attributes.scriptClassName ?? node.kind;
  const parent = node.attributes.parentId ?? node.ownerId;
  return `${typeof path === "string" ? path : node.label} · ${String(className)}${typeof parent === "string" ? ` · parent: ${parent}` : ""} · ${node.id}`;
}

function concrete(node: Node): boolean {
  return (
    !["unresolved", "external", "group"].includes(node.kind) &&
    !["candidate", "unresolved"].includes(String(node.attributes.status))
  );
}

/** All executable queries are constructed here; the model supplies names only. */
export async function answerRequest(
  input: AssistantRequest,
  services: AssistantServices,
): Promise<AssistantResponse> {
  const request = chatRequestSchema.parse(input);
  services.signal?.throwIfAborted();
  const response: AssistantResponse = {
    id: randomUUID(),
    conversationId: request.conversationId ?? request.analysisId ?? "help",
    analysisId: request.analysisId,
    text: "",
    cards: [],
    warnings: [],
    modelUsed: false,
    helpIdentity: { ...helpIdentity },
  };
  const help = (text: string, intro?: string): AssistantResponse => {
    const matches = searchHelp(text);
    const selected = matches.length
      ? matches
      : features
          .filter((feature) =>
            ["import-place", "context-pack", "mcp"].includes(feature.id),
          )
          .slice(0, 3);
    response.cards = selected.map((feature) => ({
      kind: "help",
      id: feature.id,
      label: feature.label,
      detail: [
        feature.purpose,
        ...feature.steps,
        ...feature.availability,
        ...feature.limitations,
      ].join("\n"),
      feature,
    }));
    response.text =
      intro ??
      "Use these RoGraph steps. Availability and limits are included with each feature.";
    return response;
  };
  if (
    request.mode === "help" ||
    (request.mode !== "game" && isHelp(request.message))
  )
    return help(request.message);
  if (!request.analysisId)
    return help(
      "import saved place",
      "Import or select an analysis snapshot before asking about game objects. App help works without a snapshot.",
    );
  if (
    /\b(runtime|lag(?:ging)?|fps|memory leak|live (?:game|players)|playing now)\b/i.test(
      request.message,
    ) ||
    /^(?:why|debug|fix|rewrite|implement|design)\b/i.test(request.message)
  ) {
    return help(
      "export context pack MCP",
      "I can navigate static snapshot evidence, not observe runtime behavior or diagnose the whole game. Export a context pack or use MCP for deeper investigation.",
    );
  }
  let intent = deterministic(request.message);
  if (!intent && services.interpret) {
    try {
      intent = intentSchema.parse(
        await services.interpret(
          request.message,
          { view: request.view, selectedId: request.selectedId },
          services.signal,
        ),
      );
      response.modelUsed = true;
    } catch {
      services.signal?.throwIfAborted();
      response.warnings.push(
        "The model intent was unavailable or invalid; using literal search and maintained help.",
      );
    }
  } else if (!intent)
    response.warnings.push(
      "No local model is available; using literal search and maintained help.",
    );
  intent = intentSchema.parse(
    intent ?? { op: "search", text: request.message },
  );
  if (intent.op === "help") return help(intent.text ?? request.message);
  response.warnings.push(
    "Static snapshot evidence describes potential behavior, not a recorded runtime session.",
  );
  const analysisId = request.analysisId,
    view = request.view ?? intent.view ?? "code";
  let count = 0;
  const run = async (
    query: Omit<Query, "analysisId">,
  ): Promise<QueryResult> => {
    services.signal?.throwIfAborted();
    if (++count > 6) throw Error("Assistant query budget exhausted");
    const result = await services.query(
      { ...query, analysisId, view, limit: 60 },
      services.signal,
    );
    if (result.analysisId !== analysisId)
      throw Error("Query returned a different analysis snapshot");
    if (
      result.meta.truncated ||
      Object.values(result.meta.omittedCounts).some((value) => value > 0)
    )
      response.warnings.push(
        "Results are bounded; some nodes, paths, or source bytes were omitted.",
      );
    response.warnings.push(...result.coverage.limitations);
    return result;
  };
  const nodeCard = (node: Node): AssistantCard => ({
    kind: "node",
    id: node.id,
    label: node.label,
    detail: qualified(node),
    query: { op: "inspect", analysisId, nodeId: node.id, view },
  });
  const locator = (evidence: Evidence): Query | undefined =>
    evidence.sourceId && evidence.span
      ? {
          op: "source",
          analysisId,
          sourceId: evidence.sourceId,
          startByte: evidence.span.startByte,
          endByte: evidence.span.endByte,
          view: "code",
        }
      : evidence.instanceId
        ? { op: "inspect", analysisId, nodeId: evidence.instanceId, view }
        : undefined;
  const evidenceCards = (result: QueryResult, selectedId?: string) => {
    const nodes = new Map(result.nodes.map((node) => [node.id, node]));
    for (const relation of result.relations.slice(0, 20)) {
      const evidence = result.evidence.filter(
        (item) => item.relationId === relation.id,
      );
      if (!evidence.length) continue;
      const conditional =
        evidence.some(
          (item) => item.status === "candidate" || item.assumptions.length > 0,
        ) || relation.gameplay?.conditional === true;
      const direction = selectedId
        ? relation.source === selectedId
          ? "Outgoing"
          : relation.target === selectedId
            ? "Incoming"
            : "Related"
        : "Forward";
      for (const item of evidence.slice(0, 2))
        response.cards.push({
          kind: "connection",
          id: `${relation.id}:${item.id}`,
          label: `${nodes.get(relation.source)?.label ?? relation.source} → ${nodes.get(relation.target)?.label ?? relation.target}`,
          detail: `${direction} · ${relation.type}${conditional ? " · conditional/potential" : ""} · ${item.status}`,
          query: locator(item),
          source: { analysisId, evidence: structuredClone(item) },
        });
    }
  };
  const resolveName = async (
    name: string | undefined,
    selected?: string,
  ): Promise<Node | undefined> => {
    if (selected) {
      const result = await run({ op: "inspect", nodeId: selected });
      return result.nodes.find(
        (node) => node.id === selected && concrete(node),
      );
    }
    if (!name) {
      response.text = "Choose a node or provide its exact name.";
      return;
    }
    const result = await run({ op: "search", text: name.slice(0, 256) });
    const candidates = result.nodes.filter(concrete);
    const exact = candidates.filter(
      (node) =>
        node.label.toLowerCase() === name.toLowerCase() ||
        node.id === name ||
        node.attributes.path === name,
    );
    const matches = exact.length ? exact : candidates;
    if (matches.length === 1 && (!result.meta.truncated || exact.length === 1))
      return matches[0];
    response.cards.push(...matches.slice(0, 20).map(nodeCard));
    response.text = matches.length
      ? `Choose a path/class-qualified match for “${name}” before continuing.`
      : `No verified node matches “${name}” in this snapshot.`;
    return undefined;
  };
  try {
    if (intent.op === "search") {
      const text = (intent.text ?? request.message).slice(0, 256);
      const result = await run({ op: "search", text });
      response.cards.push(...result.nodes.slice(0, 20).map(nodeCard));
      response.text = response.cards.length
        ? `Found ${result.nodes.length} matching nodes. Select a node to inspect its evidence.`
        : `No literal matches for “${text}”. Try a saved object name or ask for app help.`;
      if (!response.cards.length) {
        const saved = [...response.warnings];
        help(request.message, response.text);
        response.warnings = saved;
      }
    } else if (intent.op === "trace") {
      const from = await resolveName(intent.from, request.fromId);
      if (!from) return response;
      const to = await resolveName(intent.to, request.toId);
      if (!to) return response;
      const query: Query = {
        op: "trace",
        analysisId,
        fromId: from.id,
        toId: to.id,
        view,
        depth: 6,
        limit: 60,
        traceGoal: intent.traceGoal ?? "flow",
      };
      const result = await run(query);
      response.text = result.paths.length
        ? `Found ${result.paths.length} potential static path(s). Direction and conditional evidence are shown below.`
        : "No supported path was found within depth 6 and the result limits. This does not prove no runtime connection exists.";
      if (result.paths.length)
        response.cards.push({
          kind: "path",
          id: `trace:${from.id}:${to.id}`,
          label: `${from.label} → ${to.label}`,
          detail: `${result.paths[0].length} evidence-backed hops · depth limit 6`,
          query,
        });
      evidenceCards(result);
    } else {
      const node = await resolveName(
        intent.text,
        intent.useSelection ? request.selectedId : undefined,
      );
      if (!node) return response;
      const result = await run({
        op:
          intent.op === "connections" || intent.op === "source"
            ? "inspect"
            : intent.op,
        nodeId: node.id,
        depth: 4,
      });
      response.cards.push(nodeCard(node));
      if (intent.op === "source") {
        const relevant = result.evidence.find(
          (item) =>
            item.sourceId &&
            item.span &&
            result.relations.some(
              (relation) =>
                relation.id === item.relationId && relation.source === node.id,
            ),
        );
        const sourceId =
          typeof node.attributes.sourceId === "string"
            ? node.attributes.sourceId
            : relevant?.sourceId;
        if (sourceId) {
          const query: Query =
            relevant && relevant.sourceId === sourceId
              ? locator(relevant)!
              : {
                  op: "source",
                  analysisId,
                  sourceId,
                  view: "code",
                  startByte: 0,
                  endByte: 8192,
                };
          const source = await run(query);
          response.cards.push({
            kind: "notice",
            id: `source:${sourceId}`,
            label: `Source: ${node.label}`,
            detail: source.sources
              .map((item) =>
                item.excerpts.map((excerpt) => excerpt.text).join("\n"),
              )
              .join("\n")
              .slice(0, 8000),
            query,
            ...(relevant && relevant.sourceId === sourceId
              ? { source: { analysisId, evidence: structuredClone(relevant) } }
              : {}),
          });
          response.text =
            "Open the saved source locator to inspect this snapshot’s code.";
        } else
          response.text =
            "No saved source locator is available for this node. Inspect its evidence or owner script.";
      } else {
        if (intent.op === "dependencies" || intent.op === "impact")
          response.cards.push(
            ...result.nodes
              .filter((item) => item.id !== node.id)
              .slice(0, 15)
              .map(nodeCard),
          );
        evidenceCards(result, node.id);
        response.text = `${node.label}: ${intent.op === "inspect" ? "saved node and connections" : intent.op} from static snapshot evidence${["dependencies", "impact"].includes(intent.op) ? " (depth limit 4)" : ""}.`;
      }
    }
  } catch {
    services.signal?.throwIfAborted();
    response.text =
      "The requested evidence is unavailable in this pinned snapshot. Check the selected node and snapshot, or export a context pack for deeper investigation.";
    response.cards = [];
    response.warnings.push(
      "The bounded query could not complete; no replacement analysis was used.",
    );
  }
  response.warnings = [...new Set(response.warnings)];
  return response;
}
