import { z } from "zod";
import packageInfo from "../../../package.json" with { type: "json" };
import type { Evidence } from "./model.js";
import type { Query } from "./query.js";

export type AssistantMode = "auto" | "game" | "help";
export type BackendPreference = "auto" | "cpu" | "gpu";

const helpText = z.string().trim().min(1).max(8000);
const helpFeatureSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    label: helpText,
    purpose: helpText,
    implementedIn: z.string().regex(/^\d+\.\d+\.\d+$/),
    exampleGoals: z.array(helpText).min(1),
    synonyms: z.array(helpText).min(1),
    steps: z.array(helpText).min(1),
    availability: z.array(helpText).min(1),
    limitations: z.array(helpText).min(1),
    navigationAction: z
      .enum([
        "overview",
        "search",
        "trace",
        "dependencies",
        "impact",
        "source",
        "coverage",
        "context",
        "help",
        "settings",
        "import",
      ])
      .optional(),
  })
  .strict();

export type HelpFeature = z.infer<typeof helpFeatureSchema>;

/** The imported package version is inlined by the app bundle, including portable builds. */
export const helpFileSchema = z
  .object({
    appVersion: z.literal(packageInfo.version),
    features: z.array(helpFeatureSchema).min(1),
  })
  .strict()
  .superRefine((file, context) => {
    const seen = new Set<string>();
    for (const [index, feature] of file.features.entries()) {
      if (seen.has(feature.id)) {
        context.addIssue({
          code: "custom",
          path: ["features", index, "id"],
          message: "Duplicate help feature ID",
        });
      }
      seen.add(feature.id);
      const introduced = feature.implementedIn.split(".").map(Number);
      const current = packageInfo.version.split(".").map(Number);
      const difference = introduced
        .map((value, part) => value - current[part])
        .find((value) => value !== 0);
      if (difference !== undefined && difference > 0) {
        context.addIssue({
          code: "custom",
          path: ["features", index, "implementedIn"],
          message: "Feature requires a newer app version",
        });
      }
    }
  });

const boundedText = z.string().max(8000).trim().min(1);
const scopeId = z
  .string()
  .max(2048)
  .trim()
  .min(1)
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/u.test(value),
    "Control characters are not valid in an ID",
  );
const view = z.enum(["code", "gameplay"]);

/** An intent can name a task, never supply executable queries or replace request scope. */
export const intentSchema = z
  .object({
    op: z.enum([
      "search",
      "inspect",
      "connections",
      "trace",
      "dependencies",
      "impact",
      "source",
      "help",
    ]),
    text: boundedText.optional(),
    from: boundedText.optional(),
    to: boundedText.optional(),
    view: view.optional(),
    traceGoal: z.enum(["flow", "influence"]).optional(),
    useSelection: z.boolean().optional(),
  })
  .strict();
export type AssistantIntent = z.infer<typeof intentSchema>;

export const chatRequestSchema = z
  .object({
    message: boundedText,
    analysisId: scopeId.optional(),
    view: view.optional(),
    selectedId: scopeId.optional(),
    mode: z.enum(["auto", "game", "help"]).optional(),
    conversationId: scopeId.optional(),
    fromId: scopeId.optional(),
    toId: scopeId.optional(),
  })
  .strict();
export type AssistantRequest = z.infer<typeof chatRequestSchema>;

export interface AssistantCard {
  kind: "node" | "connection" | "path" | "help" | "notice";
  id: string;
  label: string;
  detail?: string;
  query?: Query;
  source?: { analysisId: string; evidence: Evidence };
  feature?: HelpFeature;
}

export interface AssistantResponse {
  id: string;
  conversationId: string;
  analysisId?: string;
  text: string;
  cards: AssistantCard[];
  warnings: string[];
  modelUsed: boolean;
  helpIdentity: { appVersion: string; sha256: string };
}

export interface ModelCatalogEntry {
  id: string;
  label: string;
  parameters: string;
  description: string;
  fileName: string;
  url: string;
  bytes: number;
  sha256: string;
  recommendedRamGiB: number;
  license: string;
  upstream: string;
}

export interface HardwareInfo {
  platform: string;
  arch: string;
  cpu: string;
  logicalCpus: number;
  totalRamGiB: number;
  freeRamGiB: number;
  gpus: { id: string; name: string; memoryMiB?: number }[];
  gpuProbe: "available" | "unavailable" | "not-installed";
  notes: string[];
}

export interface ModelStatus {
  catalog: ModelCatalogEntry[];
  installed: string[];
  selectedId?: string;
  backend: BackendPreference;
  actualBackend?: "cpu" | "gpu";
  runtimeState: "not-installed" | "idle" | "loading" | "ready" | "error";
  runtimeError?: string;
  hardware: HardwareInfo;
  download?: {
    id: string;
    modelId: string;
    status: "downloading" | "verifying" | "complete" | "failed" | "cancelled";
    receivedBytes: number;
    totalBytes: number;
    error?: string;
  };
  helpIdentity: { appVersion: string; sha256: string };
}
