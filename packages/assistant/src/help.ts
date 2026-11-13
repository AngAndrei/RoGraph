import { createHash } from "node:crypto";
import maintainedHelp from "../../../docs/app-functionalities.json";
import {
  helpFileSchema,
  type HelpFeature,
} from "../../contracts/src/assistant.js";

// Static JSON imports are bundled by esbuild. A portable build never reads source-tree files.
const file = helpFileSchema.parse(maintainedHelp);
export const features: HelpFeature[] = file.features;
for (const feature of features) {
  for (const value of Object.values(feature)) {
    if (Array.isArray(value)) Object.freeze(value);
  }
  Object.freeze(feature);
}
Object.freeze(features);

/** SHA-256 identifies the JSON content, independent of indentation and line endings. */
export const helpIdentity = Object.freeze({
  appVersion: file.appVersion,
  sha256: createHash("sha256")
    .update(JSON.stringify(maintainedHelp))
    .digest("hex"),
});

const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "do",
  "does",
  "for",
  "from",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "the",
  "their",
  "then",
  "this",
  "to",
  "what",
  "when",
  "where",
  "which",
  "with",
]);

function normalize(text: string): string {
  return (
    text
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).join(" ");
}

function tokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((word) => word && !stopWords.has(word));
}

const index = features.map((feature) => {
  const weights = new Map<string, number>();
  const fields: [string, number][] = [
    [feature.id, 3],
    [feature.label, 5],
    [feature.purpose, 3],
    [feature.synonyms.join(" "), 6],
    [feature.exampleGoals.join(" "), 2],
    [feature.steps.join(" "), 0.5],
    [feature.availability.join(" "), 0.2],
    [feature.limitations.join(" "), 0.2],
  ];
  for (const [text, weight] of fields) {
    for (const token of new Set(tokens(text))) {
      weights.set(token, (weights.get(token) ?? 0) + weight);
    }
  }
  return {
    feature,
    weights,
    phrases: [feature.label, ...feature.synonyms].map(normalize),
  };
});

// Downweight vocabulary shared by many features, such as "source" and "graph".
const documentFrequency = new Map<string, number>();
for (const item of index) {
  for (const token of item.weights.keys()) {
    documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  }
}

/** Retrieve task-oriented help; phrases distinguish direction and search scope. */
export function searchHelp(text: string, limit = 3): HelpFeature[] {
  if (!Number.isFinite(limit) || limit < 1) return [];
  const query = ` ${normalize(text)} `;
  const terms = new Set(tokens(text));
  if (terms.size === 0) return [];
  return index
    .map((item) => {
      let score = 0;
      for (const term of terms) {
        const weight = item.weights.get(term) ?? 0;
        score +=
          weight *
          Math.log(1 + features.length / (documentFrequency.get(term) ?? 1));
      }
      for (const phrase of item.phrases) {
        const length = tokens(phrase).length;
        if (length > 0 && query.includes(` ${phrase} `)) score += 12 * length;
      }
      return { feature: item.feature, score };
    })
    .filter((item) => item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.feature.id.localeCompare(right.feature.id),
    )
    .slice(0, Math.floor(limit))
    .map((item) => item.feature);
}
