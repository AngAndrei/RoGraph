import { it, expect } from "vitest";
import { gameplayCase } from "./support.js";
it("stores nested branch guards by reference without recursively embedding outer guards", async () => {
  const code =
    Array.from({ length: 12 }, (_, i) => `if condition${i} then`).join("\n") +
    '\nlocal egg=game:GetService("ServerStorage").Egg:Clone()\n' +
    "end\n".repeat(12);
  const c = await gameplayCase({ ChickenController: code });
  expect(Buffer.byteLength(JSON.stringify(c.facts))).toBeLessThan(150000);
});
