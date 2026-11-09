// Literal, case-insensitive matching. Keep only the selected match even for
// large files with millions of hits; source excerpts remain bounded separately.
export function findSourceMatch(text: string, term: string, requested = 0) {
  if (!term) return { term, total: 0, index: 0 };
  if (!/[^\x00-\x7f]/.test(text) && !/[^\x00-\x7f]/.test(term)) {
    // Avoid allocating a RegExp match object per character in large ASCII files.
    // Non-ASCII input keeps Unicode regex folding (e.g. Kelvin sign and long s).
    const folded = text.toLowerCase(),
      needle = term.toLowerCase();
    let total = 0,
      position = -needle.length;
    while ((position = folded.indexOf(needle, position + needle.length)) !== -1)
      total++;
    const index = total ? ((requested % total) + total) % total : 0;
    if (!total) return { term, total, index };
    position = -needle.length;
    for (let i = 0; i <= index; i++)
      position = folded.indexOf(needle, position + needle.length);
    return {
      term,
      total,
      index,
      range: { startByte: position, endByte: position + needle.length },
    };
  }
  const pattern = new RegExp(
    term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "giu",
  );
  let total = 0;
  while (pattern.exec(text)) total++;
  const index = total ? ((requested % total) + total) % total : 0;
  if (!total) return { term, total, index };
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null = null;
  for (let i = 0; i <= index; i++) match = pattern.exec(text);
  const startByte = Buffer.byteLength(text.slice(0, match!.index));
  return {
    term,
    total,
    index,
    range: { startByte, endByte: startByte + Buffer.byteLength(match![0]) },
  };
}
