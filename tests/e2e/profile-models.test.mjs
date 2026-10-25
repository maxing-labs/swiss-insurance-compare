// The model filter is part of what a profile shows: its summary must come from the profile's own models
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { skip, openApp, close, withCalc, takeToasts } from "./lib.mjs";

after(close);

const profiles = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("priminfo_pro_profiles_v2")));
const activeChip = (page) => page.evaluate(() => document.querySelector("#profile-chips .p-chip.active")?.dataset.pid ?? null);
const kpiPlan = (page) => page.evaluate(() => document.getElementById("kpi-min-plan").textContent);
const toggleModel = (page, m) => withCalc(page, () => page.locator(`#model-pills input[value="${m}"]`).locator("xpath=..").click());

test("changing the model filter leaves the profile and its summary alone until it is saved", { skip }, async () => {
  const page = await openApp();
  const [initial] = await profiles(page);
  assert.equal(await activeChip(page), initial.id);
  assert.ok(initial.summaryMinMonthly > 0);
  // the cheapest plan here is a telmed plan, so dropping TEL_DIG changes the cheapest plan
  assert.match(await kpiPlan(page), /TelMed/i);

  await toggleModel(page, "TEL_DIG");
  assert.doesNotMatch(await kpiPlan(page), /TelMed/i);
  assert.equal(await activeChip(page), null);
  assert.deepEqual(await profiles(page), [initial]);

  // back to the profile's models: active again
  await toggleModel(page, "TEL_DIG");
  assert.equal(await activeChip(page), initial.id);
  assert.deepEqual(await profiles(page), [initial]);

  // saving updates the same profile with the current models and their summary
  await toggleModel(page, "TEL_DIG");
  await takeToasts(page);
  await page.click("#btn-save-profile");
  const [saved, ...rest] = await profiles(page);
  assert.deepEqual(rest, []);
  assert.equal(saved.id, initial.id);
  assert.deepEqual(saved.models, ["BASE", "FLEX", "PRAXIS", "PHARM"]);
  assert.ok(saved.summaryMinMonthly > initial.summaryMinMonthly);
  assert.equal(await activeChip(page), initial.id);
  assert.match((await takeToasts(page))[0], /^Updated profile/);

  // reload restores the filter, and the profile still matches
  await withCalc(page, () => page.reload());
  assert.equal(await activeChip(page), initial.id);
  assert.deepEqual(await profiles(page), [saved]);
  assert.deepEqual(page.errors, []);
});
