export type NodeAnnotation = { label?: string; highlighted?: boolean };
export type NodeAnnotations = Record<string, NodeAnnotation>;
type StorageAccess = Pick<Storage, "getItem" | "setItem">;
const key = (analysis: string) => "rograph:node-annotations:v1:" + analysis;
export const annotationLabel = (value: string) =>
  Array.from(value.replace(/\s+/gu, " ").trim()).slice(0, 160).join("");

export function readAnnotations(
  analysis: string,
  storage?: StorageAccess,
): NodeAnnotations {
  try {
    const value = JSON.parse(
      (storage ?? localStorage).getItem(key(analysis)) ?? "{}",
    );
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([id, a]: [string, any]) =>
            id.length <= 2048 &&
            a &&
            typeof a === "object" &&
            (a.label === undefined ||
              (typeof a.label === "string" &&
                a.label === annotationLabel(a.label))) &&
            (a.highlighted === undefined || typeof a.highlighted === "boolean"),
        )
        .map(([id, a]: [string, any]) => [
          id,
          {
            ...(a.label ? { label: a.label } : {}),
            ...(a.highlighted ? { highlighted: true } : {}),
          },
        ]),
    );
  } catch {
    return {};
  }
}

export function writeAnnotations(
  analysis: string,
  annotations: NodeAnnotations,
  storage?: StorageAccess,
) {
  try {
    (storage ?? localStorage).setItem(
      key(analysis),
      JSON.stringify(annotations),
    );
    return true;
  } catch {
    return false;
  }
}
