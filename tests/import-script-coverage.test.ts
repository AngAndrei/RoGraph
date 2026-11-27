import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createJobs } from "../apps/local/src/jobs.js";
import { openStore } from "../packages/core/src/store.js";
import { canonical, hash } from "../packages/core/src/util.js";
import { withWorkspace } from "./support/workspace.js";

it("retains an unparseable script without publishing incomplete coverage or reusing a legacy snapshot", async () =>
  withWorkspace(async (dir) => {
    const validSource = "local function run() end\nrun()";
    const brokenSource = `${validSource}\nlocal broken =`;
    const place = (source: string) =>
      `<roblox version="4"><Item class="Script" referent="controller"><Properties><string name="Name">Controller</string><ProtectedString name="Source"><![CDATA[${source}]]></ProtectedString></Properties></Item><Item class="ModuleScript" referent="empty"><Properties><string name="Name">Empty</string><ProtectedString name="Source"></ProtectedString></Properties></Item></roblox>`;
    const validPath = join(dir, "valid.rbxlx");
    const brokenPath = join(dir, "broken.rbxlx");
    await writeFile(validPath, place(validSource));
    await writeFile(brokenPath, place(brokenSource));
    const store = await openStore(join(dir, "analysis.db"));
    const jobs = createJobs(store, dir);
    const importPlace = async (path: string) => {
      const { id } = jobs.start({ kind: "place", path }, path);
      await jobs.wait(id);
      const job = jobs.get(id);
      expect(job.analysisId, job.error?.message).toBeDefined();
      return { job, graph: await store.readGraph(job.analysisId!) };
    };
    try {
      const valid = await importPlace(validPath);
      expect(valid.job.status).toBe("complete");
      expect(valid.graph.coverage).toMatchObject({
        parsedScripts: 2,
        discoveredScripts: 2,
        partialImport: false,
      });
      expect(valid.graph.relations.some((r) => r.type === "CALLS")).toBe(true);

      const broken = await importPlace(brokenPath);
      expect(broken.job.status).toBe("partial");
      expect(broken.graph.coverage).toMatchObject({
        parsedScripts: 1,
        discoveredScripts: 2,
        partialImport: true,
      });
      expect(broken.graph.sites).toEqual([]);
      const diagnostic = broken.graph.diagnostics.find(
        (entry) => entry.code === "LUAU_PARSE_ERROR",
      );
      expect(diagnostic?.span?.startLine).toBe(3);
      expect(
        broken.graph.sources.find((s) => s.id === diagnostic?.sourceId),
      ).toMatchObject({
        text: brokenSource,
        scriptId: diagnostic?.ownerId,
      });
      expect(await store.current()).toBe(valid.graph.analysisId);

      const versions = { ...broken.graph.versions };
      delete versions.coveragePolicy;
      const legacyId = hash(
        canonical({
          snapshotId: broken.graph.snapshotId,
          versions,
          sources: broken.graph.sources.map((source) => source.sha256),
          rojo: undefined,
        }),
      );
      await store.save({
        ...broken.graph,
        analysisId: legacyId,
        versions,
        coverage: { ...broken.graph.coverage, partialImport: false },
      });
      await store.deleteAnalysis(broken.graph.analysisId);

      const repeated = await importPlace(brokenPath);
      expect(repeated.job.status).toBe("partial");
      expect(repeated.graph.analysisId).toBe(broken.graph.analysisId);
      expect(repeated.graph.analysisId).not.toBe(legacyId);
      expect(repeated.graph.coverage.partialImport).toBe(true);
      expect((await store.readGraph(legacyId)).coverage.partialImport).toBe(
        false,
      );
      expect(await store.current()).toBe(valid.graph.analysisId);
    } finally {
      await jobs.close();
      await store.close();
    }
  }));
