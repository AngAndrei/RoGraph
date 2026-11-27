import { expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Job } from "../apps/local/src/jobs.js";
import { createRojoWatch } from "../apps/local/src/rojo-watch.js";
import type { Input } from "../packages/contracts/src/model.js";
import { withWorkspace } from "./support/workspace.js";

function controlledJobs() {
  const entries: { job: Job; done: Promise<void>; settle: () => void }[] = [];
  const get = (id: string) => entries.find(({ job }) => job.id === id)!;
  return {
    entries,
    start(_input: Input, name: string): Job {
      const job: Job = {
        id: String(entries.length + 1),
        name,
        status: "running",
        progress: { stage: "import", completed: 0, total: 1 },
      };
      let settle: () => void = () => {};
      const done = new Promise<void>((resolve) => {
        settle = resolve;
      });
      entries.push({ job, done, settle });
      return job;
    },
    busy: () => entries.at(-1)?.job.status === "running",
    idle: async () => entries.at(-1)?.done,
    wait: (id: string) => get(id).done,
    get: (id: string) => get(id).job,
    finish(id: string, status: "complete" | "partial" = "complete") {
      const entry = get(id);
      entry.job.status = status;
      entry.job.analysisId = `analysis-${id}`;
      entry.settle();
    },
    fail(id: string) {
      const entry = get(id);
      entry.job.status = "failed";
      entry.job.error = {
        code: "TEST_FAILURE",
        message: "Could not build saved change",
      };
      entry.settle();
    },
    cancel(id: string) {
      const entry = get(id);
      entry.job.status = "canceled";
      entry.settle();
      return entry.job;
    },
  };
}

it("reports a dead watcher as disabled and still returns the initial import job", async () =>
  withWorkspace(async (dir) => {
    const jobs = controlledJobs();
    const watcher = createRojoWatch(jobs, join(dir, "workspace"));
    try {
      const project = join(dir, "missing", "default.project.json");
      const initial = await watcher.start(project, true);
      expect(initial?.id).toBe("1");
      jobs.finish(initial!.id);
      await expect.poll(() => watcher.state().error).toBeTruthy();
      expect(watcher.state()).toMatchObject({
        enabled: false,
        projectPath: project,
      });
      expect(jobs.entries).toHaveLength(1);
    } finally {
      await watcher.stop();
    }
  }));

it("uses one initial import job and catches a saved edit during that job", async () =>
  withWorkspace(async (dir) => {
    const root = join(dir, "project"),
      project = join(root, "default.project.json"),
      source = join(root, "init.luau");
    await mkdir(root);
    await writeFile(project, "{}");
    await writeFile(source, "return 1");
    const jobs = controlledJobs();
    const watcher = createRojoWatch(jobs, join(dir, "workspace"));
    try {
      const initial = (await watcher.start(project, true))!;
      expect(watcher.state()).toMatchObject({
        enabled: true,
        jobId: initial.id,
      });
      expect(jobs.entries).toHaveLength(1);
      await writeFile(source, "return 2");
      jobs.finish(initial.id);
      await expect.poll(() => watcher.state().jobId).toBe("2");
      expect(watcher.state()).toMatchObject({
        analysisId: "analysis-1",
        analysisJobId: "1",
      });
      expect(jobs.entries).toHaveLength(2);
      jobs.finish("2", "partial");
      await expect
        .poll(() => watcher.state())
        .toMatchObject({ analysisId: "analysis-2", analysisJobId: "2" });
      await new Promise((resolve) => setTimeout(resolve, 650));
      expect(jobs.entries).toHaveLength(2);
      await writeFile(source, "return 3");
      await expect.poll(() => watcher.state().jobId).toBe("3");
      jobs.fail("3");
      await expect
        .poll(() => watcher.state())
        .toMatchObject({
          enabled: true,
          analysisId: "analysis-2",
          analysisJobId: "2",
          error: "Could not build saved change",
        });
    } finally {
      // Complete any unconsumed test jobs even if an assertion failed.
      for (const { job } of jobs.entries) jobs.finish(job.id);
      await watcher.stop();
    }
    expect(watcher.state().enabled).toBe(false);
  }));
