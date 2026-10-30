import type { Span } from "./model.js";
export function indexSource(text: string) {
  const bytes = new TextEncoder().encode(text),
    starts = [0];
  for (let i = 0; i < bytes.length; i++)
    if (bytes[i] === 10) starts.push(i + 1);
  const at = (offset: number) => {
    if (offset < 0 || offset > bytes.length)
      throw new Error("Source range out of bounds");
    let lo = 0,
      hi = starts.length;
    while (lo + 1 < hi) {
      const m = (lo + hi) >> 1;
      if (starts[m] <= offset) lo = m;
      else hi = m;
    }
    return {
      line: lo + 1,
      column:
        [...new TextDecoder().decode(bytes.subarray(starts[lo], offset))]
          .length + 1,
    };
  };
  const span = (startByte: number, endByte: number): Span => {
    const a = at(startByte),
      b = at(endByte);
    return {
      startByte,
      endByte,
      startLine: a.line,
      startColumn: a.column,
      endLine: b.line,
      endColumn: b.column,
    };
  };
  return {
    span,
    slice: (s: Span) =>
      new TextDecoder().decode(bytes.subarray(s.startByte, s.endByte)),
    fromLocation: (location: string) => {
      const m = /^(\d+),(\d+) - (\d+),(\d+)$/.exec(location);
      if (!m) throw new Error("Invalid parser location");
      return span(starts[+m[1]] + +m[2], starts[+m[3]] + +m[4]);
    },
  };
}
