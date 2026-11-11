import { test, expect } from "./support.js";
import { fixturePath } from "../support/fixtures.js";

test("orients a new developer, traces an evidenced gameplay path, and returns to the map", async ({
  page,
  app,
}) => {
  await page.goto(app.url + "/#session=" + app.sessionToken);
  await page
    .getByLabel("Place file")
    .setInputFiles(fixturePath("gameplay/egg-flow.rbxlx"));
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.locator(".sigma-container")).toHaveAttribute(
    "data-layout-ready",
    "true",
    { timeout: 90000 },
  );
  await expect(page.getByLabel("Visible map size")).toContainText(
    "connections",
  );
  const guide = page.locator(".game-orientation");
  await expect(guide).toContainText("ChickenController");
  await guide
    .getByRole("button", { name: /^Inspect ChickenController/ })
    .click();
  await expect(page.getByLabel("Behavior at a glance")).toContainText(
    "Outgoing connections",
  );
  await page.getByRole("button", { name: "Dependencies", exact: true }).click();
  await expect(page.locator(".map-scope")).toContainText(
    "Dependencies of ChickenController",
  );
  await expect(page.getByText("0 hops", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Back to overview", exact: true })
    .click();
  await expect(guide).toBeVisible();
  await page.getByRole("button", { name: "Trace a path", exact: true }).click();
  await page
    .getByLabel("Trace start", { exact: true })
    .selectOption({ label: "Chicken" });
  await page
    .getByLabel("Trace destination", { exact: true })
    .selectOption({ label: "Egg" });
  await page.getByRole("button", { name: "Find path", exact: true }).click();
  await expect(page.locator(".trace-hop").first()).toBeVisible();
  await expect(page.locator(".map-scope")).toContainText(
    "Potential connection path",
  );
  await page
    .getByRole("button", { name: "Back to overview", exact: true })
    .click();
  await expect(guide).toBeVisible();
});

test("keeps the graph reachable on a narrow screen and lets the developer close detail panels", async ({
  page,
  app,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(app.url + "/#session=" + app.sessionToken);
  await page
    .getByLabel("Place file")
    .setInputFiles(fixturePath("gameplay/egg-flow.rbxlx"));
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.locator(".sigma-container")).toHaveAttribute(
    "data-layout-ready",
    "true",
    { timeout: 90000 },
  );
  await expect(
    page.getByRole("button", { name: "Expand project navigator" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const box = (await page.locator(".sigma-container").boundingBox())!;
  expect(box.width).toBeGreaterThan(300);
  expect(box.height).toBeGreaterThan(220);
  await page.locator(".game-orientation summary").click();
  await page
    .getByRole("button", { name: /^Inspect ChickenController/ })
    .click();
  await expect(page.getByLabel("Behavior at a glance")).toBeVisible();
  await page
    .getByRole("button", { name: "Close inspector", exact: true })
    .click();
  await expect(page.locator(".inspector")).toHaveCount(0);
  await page.screenshot({ path: "build/previews/orientation-mobile.png" });
});
