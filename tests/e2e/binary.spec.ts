import { test, expect } from "./support.js";
import { readFile } from "node:fs/promises";
test("imports binary places and exposes grouping and saved-object controls", async ({
  page,
  app,
}) => {
  await page.goto(app.url + "/#session=" + app.sessionToken);
  await expect(page.getByLabel("Place file")).toHaveAttribute(
    "accept",
    ".rbxlx,.rbxl",
  );
  await page.getByLabel("Place file").setInputFiles({
    name: "synthetic.rbxl",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(
      await readFile("fixtures/binary/shop.rbxl.base64", "utf8"),
      "base64",
    ),
  });
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Coverage", exact: true }),
  ).toBeVisible({ timeout: 90000 });
  await expect(page.getByText("Partial import", { exact: true })).toHaveCount(
    0,
  );
  const groups = page.getByLabel("Visible group");
  await expect(groups).toContainText("ReplicatedStorage");
  await page.getByLabel("Group by", { exact: true }).selectOption("folder");
  await expect(groups).toContainText("Shop ·");
  await expect(groups).not.toContainText("ReplicatedStorage");
  const classes = page.getByLabel("Object classes");
  await classes.fill("NotARobloxClass");
  await expect(
    page.getByText("No saved objects match these classes."),
  ).toBeVisible();
  await classes.fill("localscript, MODULESCRIPT");
  await expect(
    page.getByText("No saved objects match these classes."),
  ).toHaveCount(0);
  await expect(page.locator(".sigma-container")).toHaveAttribute(
    "data-layout-ready",
    "true",
  );
  await classes.clear();
  await page.getByLabel("Include saved objects").check();
  await expect(page.getByLabel("Include saved objects")).toBeChecked();
  await expect(page.locator(".sigma-container canvas")).not.toHaveCount(0);
  await page.screenshot({
    path: "build/previews/binary-grouped.png",
    fullPage: true,
  });
});
