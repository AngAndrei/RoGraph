import { it, expect } from "vitest";
import { parseIntentOutput, chooseBackend } from "../apps/local/src/assistant/runtime.js";

it("accepts only a bounded intent rather than executable model output or a replacement snapshot", () => {
  expect(parseIntentOutput('{"op":"trace","from":"BuySword","to":"Prices.Sword","view":"code"}'))
    .toEqual({ op: "trace", from: "BuySword", to: "Prices.Sword", view: "code" });
  expect(() => parseIntentOutput('{"op":"search","analysisId":"another-game"}')).toThrow();
  expect(() => parseIntentOutput('{"op":"shell","command":"anything"}')).toThrow();
  expect(() => parseIntentOutput('{"op":"search","text":"' + "x".repeat(9000) + '"}')).toThrow();
  expect(() => parseIntentOutput("No JSON here")).toThrow();
  expect(() => parseIntentOutput('{"op":"search","view":"code"}')).toThrow(/search/i);
});

it("chooses compatible offload only when available and reports explicit GPU unavailability", () => {
  expect(chooseBackend("auto", false)).toBe("cpu");
  expect(chooseBackend("cpu", true)).toBe("cpu");
  expect(chooseBackend("auto", true)).toBe("gpu");
  expect(() => chooseBackend("gpu", false)).toThrow(/GPU/);
});
