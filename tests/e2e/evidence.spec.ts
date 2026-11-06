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
  await page.getByRole("button", { name: "Find matches" }).click();
  await expect(page.locator(".source-match").first()).toHaveText(
    "Config.Prices.Sword",
  );
  await page.getByRole("button", { name: "Close source" }).click();
  await page.screenshot({
    path: "build/previews/evidence.png",
    fullPage: true,
  });
});
