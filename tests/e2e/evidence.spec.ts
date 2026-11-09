import { test, expect } from "./support.js";
import { fixturePath } from "../support/fixtures.js";
test("opens source evidence from a selected script", async ({ page, app }) => {
  await page.goto(app.url + "/#session=" + app.sessionToken);
  await page
    .getByLabel("Place file")
    .setInputFiles(fixturePath("shop/place.rbxlx"));
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Coverage", exact: true }),
  ).toBeVisible({ timeout: 90000 });
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page.getByLabel("Search project").fill("PurchaseService");
  await page
    .locator(".search-results")
    .getByRole("button", { name: "PurchaseService", exact: true })
    .click();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Source evidence" }),
  ).toBeVisible();
  await expect(page.locator(".source-code")).toContainText(
    "Config.Prices.Sword",
  );
  await page
    .getByRole("searchbox", { name: "Find in source" })
    .fill("Config.Prices.Sword");
  await expect(page.locator(".source-match").first()).toHaveText(
    "Config.Prices.Sword",
  );
  await page.getByRole("button", { name: "Close source" }).click();
  await page.screenshot({
    path: "build/previews/evidence.png",
    fullPage: true,
  });
});

test("source Find uses a browser-style bar with whole-file counts, wrap and keyboard navigation", async ({
  page,
  app,
}) => {
  const source =
    '-- 🐕\nlocal first = "Needle"\n' +
    "-- padding\n".repeat(1200) +
    'local second = "needle"\nlocal third = "NEEDLE"\nprint(first,second,third)';
  const place = `<roblox version="4"><Item class="Script" referent="s"><Properties><string name="Name">FindSource</string><ProtectedString name="Source"><![CDATA[${source}]]></ProtectedString></Properties></Item></roblox>`;
  await page.goto(app.url + "/#session=" + app.sessionToken);
  await page
    .getByLabel("Place file")
    .setInputFiles({
      name: "find.rbxlx",
      mimeType: "application/xml",
      buffer: Buffer.from(place),
    });
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Coverage", exact: true }),
  ).toBeVisible({ timeout: 90000 });
  await page.getByLabel("Search project").fill("FindSource");
  await page
    .locator(".search-results")
    .getByRole("button", { name: "FindSource", exact: true })
    .click();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const find = page.getByRole("searchbox", { name: "Find in source" });
  await find.fill("needle");
  await expect(page.getByLabel("Match count")).toHaveText("1/3");
  await expect(page.locator(".source-match-active")).toHaveText("Needle");
  await page.getByRole("button", { name: "Next match", exact: true }).click();
  await expect(page.getByLabel("Match count")).toHaveText("2/3");
  await expect(page.locator(".source-match-active")).toHaveText("needle");
  await find.press("Enter");
  await expect(page.getByLabel("Match count")).toHaveText("3/3");
  await find.press("Enter");
  await expect(page.getByLabel("Match count")).toHaveText("1/3");
  await find.press("Shift+Enter");
  await expect(page.getByLabel("Match count")).toHaveText("3/3");
  await page.screenshot({ path: "build/previews/source-find-bar.png" });
  await find.fill("does not exist");
  await expect(page.getByLabel("Match count")).toHaveText("0/0");
  await expect(
    page.getByRole("button", { name: "Next match", exact: true }),
  ).toBeDisabled();
  await find.press("Escape");
  await expect(find).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Source evidence" }),
  ).toBeVisible();
  await page.locator(".source-code").focus();
  await page.keyboard.press("Control+f");
  await expect(find).toBeFocused();
  await page.getByRole("button", { name: "Close find", exact: true }).click();
  await expect(find).toHaveCount(0);
});
