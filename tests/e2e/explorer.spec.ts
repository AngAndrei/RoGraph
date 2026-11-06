import { test, expect } from "./support.js";
import { fixturePath } from "../support/fixtures.js";
test.use({
  launchOptions: {
    ignoreDefaultArgs: ["--hide-scrollbars"],
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  },
});
test("imports a saved place and exposes coverage and script members", async ({
  page,
  app,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.text().startsWith("Graph rendering failed:"))
      console.error(message.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(app.url + "/#session=" + app.sessionToken);
  await page
    .getByLabel("Place file")
    .setInputFiles(fixturePath("shop/place.rbxlx"));
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Coverage", exact: true }),
  ).toBeVisible({ timeout: 90000 });
  await expect(
    page.getByText("Unresolved sites", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search project").fill("PurchaseService");
  await page
    .getByRole("button", { name: "PurchaseService", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Functions", exact: true }),
  ).not.toBeVisible();
  const actions = page.locator(".inspect-actions");
  const row = (await actions.boundingBox())!;
  const gutter = await actions.evaluate(
    (element) => (element as HTMLElement).offsetHeight - element.clientHeight,
  );
  expect(gutter).toBe(7);
  await page.mouse.move(row.x + 12, row.y + row.height - gutter / 2);
  await page.mouse.down();
  await page.mouse.move(
    row.x + row.width - 2,
    row.y + row.height - gutter / 2,
    { steps: 10 },
  );
  await page.mouse.up();
  const impact = page.getByRole("button", { name: "Impact", exact: true });
  await expect
    .poll(async () => {
      const row = (await actions.boundingBox())!;
      const button = (await impact.boundingBox())!;
      return button.x + button.width - row.x - row.width;
    })
    .toBeLessThanOrEqual(1);

  await page
    .getByRole("button", { name: "Show implementation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Functions", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: "PurchaseService.TryPurchase", exact: true })
      .first(),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/session=/);
  expect(errors).toEqual([]);
  await expect(
    page.getByText("The graph renderer is unavailable.", { exact: false }),
  ).toHaveCount(0);
  expect(await page.locator(".sigma-container canvas").count()).toBeGreaterThan(
    0,
  );
  await page.screenshot({
    path: "build/previews/explorer.png",
    fullPage: true,
  });
});
