import { test, expect } from "./support.js";
import { fixturePath } from "../support/fixtures.js";
test("shows real objects in Gameplay and follows the Chicken controller into Code", async ({
  page,
  app,
}) => {
  await page.goto(app.url + "/#session=" + app.sessionToken);
  await page
    .getByLabel("Place file")
    .setInputFiles(fixturePath("gameplay/egg-flow.rbxlx"));
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Gameplay", exact: true }),
  ).toBeVisible({ timeout: 90000 });
  await expect(page.locator(".sigma-container")).toHaveAttribute(
    "data-layout-ready",
    "true",
  );
  await expect(
    page.getByText("Browse visible nodes", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".inspector")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Collapse project navigator" })
    .click();
  await expect(page.getByLabel("Search project")).toBeHidden();
  await page.getByRole("button", { name: "Expand project navigator" }).click();
  const search = page.getByLabel("Search project");
  await search.fill("Egg");
  await expect(page.getByText(/symbolic spawned egg/i)).toHaveCount(0);
  await page
    .locator(".search-results")
    .getByRole("button", { name: "Egg", exact: true })
    .click();
  await expect(
    page
      .locator(".inspector")
      .getByRole("button", { name: /Config · .*EggTemplateName/ })
      .first(),
  ).toBeVisible();
  await search.fill("Chicken");
  await page
    .locator(".search-results")
    .getByRole("button", { name: "Chicken", exact: true })
    .click();
  await expect(
    page
      .locator(".inspector")
      .getByRole("heading", { name: "Chicken", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".inspector")
      .getByRole("button", { name: /behavior implemented by/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(
    page
      .locator(".inspector")
      .getByRole("heading", { name: "Chicken", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Gameplay", exact: true }).click();
  await expect(
    page
      .locator(".inspector")
      .getByRole("heading", { name: "Chicken", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close inspector" }).click();
  await expect(page.locator(".inspector")).toHaveCount(0);
  await page.screenshot({
    path: "build/previews/gameplay.png",
    fullPage: true,
  });
});
