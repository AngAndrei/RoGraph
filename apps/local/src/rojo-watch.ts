import { basename } from "node:path";
import { watchProject } from "../../../packages/core/src/watch.js";
import { RoGraphError } from "../../../packages/core/src/util.js";
import type { createJobs, Job } from "./jobs.js";

type WatchJobs = Pick<
  ReturnType<typeof createJobs>,
  "start" | "busy" | "idle" | "get" | "wait" | "cancel"
>;

export function createRojoWatch(jobs: WatchJobs, workspace: string) {
  let controller: AbortController | undefined,
    watching = Promise.resolve(),
    changing = Promise.resolve(),
    projectPath: string | undefined,
    error: string | undefined,
    jobId: string | undefined,
    analysisId: string | undefined,
    analysisJobId: string | undefined;

  const replace = (project?: string, initialImport = false) => {
    const replacement = changing.then(async () => {
      controller?.abort();
      await watching;
      if (!project) return;

      let settleFirst: (job: Job | undefined) => void = () => {};
      let rejectFirst: (cause: unknown) => void = () => {};
      const active = new AbortController(),
        { signal } = active,
        aborted = new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        }),
        firstJob = new Promise<Job | undefined>((resolve, reject) => {
          settleFirst = resolve;
          rejectFirst = reject;
        });
      controller = active;
      projectPath = project;
      error = undefined;
      jobId = undefined;
      analysisId = undefined;
      analysisJobId = undefined;
      watching = watchProject(
        project,
        async (input) => {
          while (!signal.aborted && jobs.busy())
            await Promise.race([jobs.idle(), aborted]);
          if (signal.aborted) return;
          const job = jobs.start(input, basename(project));
          const initial = initialImport && !jobId;
          jobId = job.id;
          settleFirst(job);
          const cancel = () => jobs.cancel(job.id);
          if (!initial)
            signal.addEventListener("abort", cancel, { once: true });
          try {
            const done = jobs.wait(job.id);
            await (initial ? Promise.race([done, aborted]) : done);
            if (!signal.aborted) {
              const completed = jobs.get(job.id);
              error = completed.error?.message;
              if (completed.analysisId) {
                analysisId = completed.analysisId;
                analysisJobId = completed.id;
              }
            }
          } finally {
            signal.removeEventListener("abort", cancel);
          }
        },
        signal,
        [workspace],
      )
        .catch((cause: unknown) => {
          error = cause instanceof Error ? cause.message : String(cause);
          const shouldImport = initialImport && !jobId && !signal.aborted;
          active.abort();
          if (shouldImport) {
            // The import can still report its own failure if the directory watcher
            // could not start, for example when the project path does not exist.
            try {
              settleFirst(
                jobs.start(
                  { kind: "rojo", projectPath: project },
                  basename(project),
                ),
              );
            } catch (cause) {
              rejectFirst(cause);
            }
          }
        })
        .finally(() => {
          active.abort();
          controller = undefined;
          settleFirst(undefined);
        });

      return { firstJob };
    });
    changing = replacement.then(
      () => undefined,
      () => undefined,
    );
    return replacement;
  };

  return {
    async start(project: string, initialImport = false) {
      const active = await replace(project, initialImport);
      if (!initialImport) return;
      // Use the watcher's first job so an unchanged directory is analyzed once.
      const job = await active?.firstJob;
      if (!job)
        throw new RoGraphError(
          "WATCH_STOPPED",
          "Rojo watch stopped before the import began",
        );
      return job;
    },
    async stop() {
      await replace();
    },
    state: () => ({
      enabled: Boolean(controller && !controller.signal.aborted),
      projectPath,
      error,
      jobId,
      analysisId,
      analysisJobId,
    }),
  };
}
