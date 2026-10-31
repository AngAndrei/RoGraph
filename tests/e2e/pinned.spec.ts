import { test, expect } from "./support.js";
import { fixturePath } from "../support/fixtures.js";
import { readFile } from "node:fs/promises";
test("keeps graph data pinned while a newly selected snapshot loads", async ({
  page,
  app,
}) => {
  await page.goto(app.url + "/#session=" + app.sessionToken);
  await page
    .getByLabel("Place file")
    .setInputFiles(fixturePath("shop/place.rbxlx"));
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Coverage", exact: true }),
  ).toBeVisible({ timeout: 90000 });
  const xml = (await readFile(fixturePath("shop/place.rbxlx"), "utf8")).replace(
      /Sword\s*=\s*100/,
      "Sword=101",
    ),
    headers = {
      "X-RoGraph-Session": app.sessionToken,
      Origin: app.url,
      "Content-Type": "application/octet-stream",
      "X-RoGraph-Filename": "changed.rbxlx",
    };
  let job = (await (
    await fetch(app.url + "/api/imports", {
      method: "POST",
      headers,
      body: xml,
    })
  ).json()) as any;
  for (
    let i = 0;
    i < 900 &&
    !job.analysisId &&
    job.status !== "failed" &&
    job.status !== "canceled";
    i++
  ) {
    await new Promise((r) => setTimeout(r, 100));
    job = await (
      await fetch(app.url + "/api/jobs/" + job.id, { headers })
    ).json();
  }
  expect(job.status).toBe("complete");
  await expect(
    page.getByRole("button", { name: "Open new snapshot" }),
  ).toBeVisible({ timeout: 15000 });
  let release: () => void = () => {};
  const blocked = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/query", async (route) => {
    const q = route.request().postDataJSON();
    if (q.op === "overview" && q.analysisId === job.analysisId) await blocked;
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "Open new snapshot" }).click();
    await expect(page.getByLabel("Snapshot", { exact: true })).toHaveValue(
      job.analysisId,
    );
    expect(await page.locator(".sigma-container").count()).toBe(0);
  } finally {
    release();
  }
  await expect(page.locator(".sigma-container")).toHaveAttribute(
    "data-analysis-id",
    job.analysisId,
  );
});
