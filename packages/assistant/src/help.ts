import { createHash } from "node:crypto";
import maintainedHelp from "../../../docs/app-functionalities.json" with { type: "json" };
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
  "could",
  "do",
  "does",
  "for",
  "from",
  "how",
  "help",
  "i",
  "if",
  "in",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "please",
  "s",
  "see",
  "should",
  "some",
  "that",
  "the",
  "their",
  "then",
  "this",
  "to",
  "use",
  "what",
  "when",
  "where",
  "which",
  "why",
  "with",
  "would",
  "you",
  "your",
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
    phrases: [
      ...new Set(
        [feature.label, ...feature.synonyms, ...feature.exampleGoals].map(
          normalize,
        ),
      ),
    ],
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
  // Generic verbs alone (for example "install Python") must not turn an
  // unrelated question into app instructions. An explicit task alias can
  // survive conversational wording; otherwise require most meaningful terms
  // to occur in task metadata, rather than incidental limitations.
  return index
    .map((item) => {
      const supportedTerms = [...terms].filter(
        (term) => (item.weights.get(term) ?? 0) >= 2,
      );
      let score = 0;
      for (const term of terms) {
        const weight = item.weights.get(term) ?? 0;
        score +=
          weight *
          Math.log(1 + features.length / (documentFrequency.get(term) ?? 1));
      }
      let phraseMatched = false;
      for (const phrase of item.phrases) {
        const length = tokens(phrase).length;
        if (length > 0 && query.includes(` ${phrase} `)) {
          phraseMatched = true;
          score += 12 * length;
        }
      }
      if (!phraseMatched && supportedTerms.length <= terms.size / 2) score = 0;
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
