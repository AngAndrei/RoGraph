import data from "./api-members.json" with { type: "json" };
const classes = data.classes as Record<
  string,
  { parent: string; members: Record<string, string> }
>;
const cache = new Map<string, Map<string, string>>();
export const apiMetadataHash = data.sha256;
export function apiMember(className: string, key: string): string | undefined {
  let members = cache.get(className);
  if (!members) {
    members = new Map();
    const seen = new Set<string>();
    let name = classes[className] ? className : "Instance";
    while (classes[name] && !seen.has(name)) {
      seen.add(name);
      const entry = classes[name];
      for (const [key, type] of Object.entries(entry.members))
        if (!members.has(key)) members.set(key, type);
      name = entry.parent;
    }
    cache.set(className, members);
  }
  return members.get(key);
}
