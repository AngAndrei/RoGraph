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
  await page.getByText("Browse visible nodes", { exact: true }).click();
  const list = page.locator(".graph-node-list");
  await expect(
    list.getByRole("button", { name: "Chicken", exact: true }),
  ).toBeVisible();
  await expect(
    list.getByRole("button", { name: "Egg", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/symbolic spawned egg/i)).toHaveCount(0);
  await list.getByRole("button", { name: "Egg", exact: true }).click();
  await expect(
    page
      .locator(".inspector")
      .getByRole("button", { name: /Config · .*EggTemplateName/ })
      .first(),
  ).toBeVisible();
  await list.getByRole("button", { name: "Chicken", exact: true }).click();
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
  await page.screenshot({
    path: "build/previews/gameplay.png",
    fullPage: true,
  });
});
