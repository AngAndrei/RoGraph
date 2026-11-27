// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../../apps/web/src/api.js", () => ({ api }));
import { SourceView } from "../../apps/web/src/SourceView.js";

afterEach(cleanup);

it("preserves the selected BOM in the source excerpt DOM", async () => {
  const text = "\ufeffreturn 1";
  const span = {
    startByte: 0,
    endByte: 3,
    startLine: 1,
    endLine: 1,
    startColumn: 1,
    endColumn: 2,
  };
  api.run.mockResolvedValue({
    sources: [{
      origin: { kind: "place" },
      excerpts: [{ text, span: { ...span, endByte: 11, endColumn: 10 } }],
      omittedBytes: 0,
    }],
  });
  const { container } = render(
    <SourceView analysisId="a" evidence={{ sourceId: "s", span }} onClose={() => {}} />,
  );
  await waitFor(() => {
    const code = container.querySelector("pre code");
    expect(code?.textContent).toBe(text);
    expect(code?.querySelector("mark")?.textContent).toBe("\ufeff");
  });
});
