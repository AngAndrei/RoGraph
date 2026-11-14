import { startServer } from "../apps/local/src/server.js";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fixturePath } from "../tests/support/fixtures.js";
const workspace = await mkdtemp(join(tmpdir(), "rograph-chat-http-qa-"));
const app = await startServer({ workspacePath: workspace });
const headers = {
  "X-RoGraph-Session": app.sessionToken,
  Origin: app.url,
  "Content-Type": "application/json",
};
const rows: unknown[] = [];
const check = (id: string, pass: boolean, detail: unknown) => {
  rows.push({ id, pass, detail });
  console.log(JSON.stringify({ id, pass, detail }));
};
async function turn(id: string, message: string, analysisId?: string) {
  const t = performance.now();
  const response = await fetch(app.url + "/api/chat/turns", {
    method: "POST",
    headers,
    body: JSON.stringify({ requestId: id, message, analysisId, view: "code" }),
  });
  const body = (await response.json()) as any;
  return {
    status: response.status,
    ms: Math.round((performance.now() - t) * 100) / 100,
    body,
  };
}
try {
  check(
    "unauthenticated",
    (await fetch(app.url + "/api/assistant/status")).status === 403,
    "assistant status requires session",
  );
  check(
    "wrong-origin",
    (
      await fetch(app.url + "/api/chat/history", {
        headers: { ...headers, Origin: "https://untrusted.invalid" },
      })
    ).status === 403,
    "foreign Origin rejected",
  );
  const help = await turn("help-qa", "How do I find text inside a script?");
  check(
    "maintained-help-http",
    help.status === 200 &&
      help.body.cards.some((c: any) => c.feature?.id === "source-find"),
    { ms: help.ms, modelUsed: help.body.modelUsed },
  );
  let job = (await (
    await fetch(app.url + "/api/imports", {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/octet-stream",
        "X-RoGraph-Filename": "qa-shop.rbxlx",
      },
      body: await readFile(fixturePath("shop/place.rbxlx")),
    })
  ).json()) as any;
  const deadline = Date.now() + 60000;
  while (
    !["complete", "failed", "partial", "canceled"].includes(job.status) &&
    Date.now() < deadline
  ) {
    await new Promise((r) => setTimeout(r, 50));
    job = await (
      await fetch(app.url + "/api/jobs/" + job.id, { headers })
    ).json();
  }
  if (job.status !== "complete")
    throw Error("QA import failed: " + JSON.stringify(job));
  const analysisId = job.analysisId;
  const loadingTurn = turn(
    "cancel-loading",
    "I'm looking for ShopConfig",
    analysisId,
  );
  await new Promise((r) => setTimeout(r, 30));
  const loadingCancelStart = performance.now();
  await fetch(app.url + "/api/chat/turns/cancel-loading", {
    method: "DELETE",
    headers,
  });
  const loadingCancelled = await loadingTurn;
  check("cancel-loading", loadingCancelled.status !== 200, {
    status: loadingCancelled.status,
    msAfterCancel: Math.round(performance.now() - loadingCancelStart),
  });

  for (const [id, message, kind, label] of [
    ["http-find", "find the ShopConfig module", "node", "ShopConfig"],
    [
      "http-source",
      "Could you show me the source code of ShopClient.BuySword?",
      "notice",
      "Source: ShopClient.BuySword",
    ],
    [
      "http-trace",
      "trace from ShopClient.BuySword to ShopConfig.Prices.Sword",
      "path",
      undefined,
    ],
    ["http-model-cold", "I'm looking for ShopConfig", "node", "ShopConfig"],
    [
      "http-model-warm",
      "I'd like to read ShopClient.BuySword",
      "notice",
      "Source: ShopClient.BuySword",
    ],
  ] as const) {
    const r = await turn(id, message, analysisId);
    check(
      id,
      r.status === 200 &&
        r.body.cards.some(
          (c: any) => c.kind === kind && (!label || c.label === label),
        ),
      { ms: r.ms, modelUsed: r.body.modelUsed, text: r.body.text },
    );
  }
  const retry = await turn(
    "http-find",
    "find the ShopConfig module",
    analysisId,
  );
  check("idempotent-retry", retry.status === 200, { ms: retry.ms });
  const mismatch = await turn("http-find", "find ShopClient", analysisId);
  check("request-id-conflict", mismatch.status !== 200, {
    status: mismatch.status,
  });
  const stale = await turn(
    "stale-analysis",
    "find ShopConfig",
    "not-a-real-snapshot",
  );
  check("stale-analysis", stale.status !== 200, { status: stale.status });
  const active = turn(
    "cancel-me",
    "Is there a connection from ShopClient.BuySword to ShopConfig.Prices.Sword?",
    analysisId,
  );
  await new Promise((r) => setTimeout(r, 30));
  const parallel = await turn("concurrent", "find ShopConfig", analysisId);
  check("concurrent-question", parallel.status !== 200, {
    status: parallel.status,
  });
  const t = performance.now();
  await fetch(app.url + "/api/chat/turns/cancel-me", {
    method: "DELETE",
    headers,
  });
  const cancelled = await active;
  check("cancel-inference", cancelled.status !== 200, {
    status: cancelled.status,
    msAfterCancel: Math.round(performance.now() - t),
  });
  const recovered = await turn("after-cancel", "find ShopConfig", analysisId);
  check("recover-after-cancel", recovered.status === 200, { ms: recovered.ms });
  const modelRecovery = await turn(
    "model-after-cancel",
    "I'd like to read ShopClient.BuySword",
    analysisId,
  );
  check(
    "model-recover-after-cancel",
    modelRecovery.status === 200 &&
      modelRecovery.body.modelUsed &&
      modelRecovery.body.cards.some((c: any) => c.query?.op === "source"),
    { ms: modelRecovery.ms },
  );
  const history = (await (
    await fetch(app.url + "/api/chat/history?analysisId=" + analysisId, {
      headers,
    })
  ).json()) as any;
  check(
    "history-isolation",
    history.turns.every((t: any) => t.response.analysisId === analysisId),
    { turns: history.turns.length },
  );
  check(
    "cancel-not-in-history",
    !history.turns.some((t: any) =>
      t.message.startsWith("Is there a connection"),
    ),
    { turns: history.turns.length },
  );
  const status = (await (
    await fetch(app.url + "/api/assistant/status", { headers })
  ).json()) as any;
  const output =
    process.argv.find((a) => a.startsWith("--out="))?.slice(6) ??
    "build/assistant-qa-http.json";
  await writeFile(
    resolve(output),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        runtime: { state: status.runtimeState, backend: status.actualBackend },
        summary: {
          passed: (rows as any[]).filter((r) => r.pass).length,
          total: rows.length,
        },
        rows,
      },
      null,
      2,
    ) + "\n",
  );
  if ((rows as { pass: boolean }[]).some((r) => !r.pass)) process.exitCode = 1;
} finally {
  await app.close();
  await rm(workspace, { recursive: true, force: true });
}
