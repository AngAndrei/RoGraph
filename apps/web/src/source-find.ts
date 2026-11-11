export function sourceMatchRanges(
  text: string,
  term: string,
  selected?: { start: number; end: number },
) {
  if (!term) return [];
  const matches = (from: number, to: number) =>
    [
      ...text
        .slice(from, to)
        .matchAll(
          new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu"),
        ),
    ].map((match) => ({
      start: from + match.index,
      end: from + match.index + match[0].length,
      active: false,
    }));
  if (
    !selected ||
    selected.start < 0 ||
    selected.end > text.length ||
    selected.end <= selected.start
  )
    return matches(0, text.length);
  // The excerpt may begin inside an earlier, overlapping occurrence. Always
  // anchor the current mark to the full-source match supplied by the server.
  return [
    ...matches(0, selected.start),
    { ...selected, active: true },
    ...matches(selected.end, text.length),
  ];
}
