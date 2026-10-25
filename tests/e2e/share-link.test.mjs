// The URL (what users share) carries the model filter
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { skip, openApp, close, withCalc } from "./lib.mjs";

after(close);

const ALL = "BASE,FLEX,PRAXIS,TEL_DIG,PHARM";
const LINK = "?loc=80011450512497&yob=1990&fran=2500&acc=0";

const urlModels = (page) => page.evaluate(() => location.search.match(/[?&]models=([^&]*)/)?.[1] ?? null);
const checked = (page) => page.evaluate(() =>
  [...document.querySelectorAll("#model-pills input:checked")].map(i => i.value).join(","));

// open `query`, recording the models parameter of every calculation request
async function openRecording(query, storage = null) {
  const calcs = [];
  const page = await openApp({
    query, storage,
    beforeGoto: (p) => p.on("request", (r) => {
      if (r.url().includes("/api/calculate")) calcs.push(new URL(r.url()).searchParams.get("models"));
    })
  });
  return { page, calcs };
}

test("the URL lists the selected models with plain commas", { skip }, async () => {
  const page = await openApp();
  assert.equal(await urlModels(page), ALL);
  await withCalc(page, () => page.locator('#model-pills input[value="PHARM"]').locator("xpath=..").click());
  assert.equal(await urlModels(page), "BASE,FLEX,PRAXIS,TEL_DIG");
});

test("a link with models selects them, in the fixed order, over the stored filter", { skip }, async () => {
  const stored = { priminfo_pro_active_state_v2: { models: ["PRAXIS"] } };
  const { page, calcs } = await openRecording(`${LINK}&models=TEL_DIG,BASE`, stored);
  assert.equal(await checked(page), "BASE,TEL_DIG");
  assert.deepEqual(calcs, ["BASE,TEL_DIG"]);
  assert.equal(await urlModels(page), "BASE,TEL_DIG");
  // and a reload of that URL keeps them
  await withCalc(page, () => page.reload());
  assert.equal(await checked(page), "BASE,TEL_DIG");
  assert.deepEqual(page.errors, []);
});

test("encoded commas, unknown values and duplicates are tolerated", { skip }, async () => {
  for (const [q, expected] of [["BASE%2CFLEX", "BASE,FLEX"], ["FOO,PHARM,PHARM", "PHARM"]]) {
    const { page, calcs } = await openRecording(`${LINK}&models=${q}`);
    assert.equal(await checked(page), expected, q);
    assert.deepEqual(calcs, [expected], q);
  }
});

test("models with no known value, or an old link without models, keep the stored filter", { skip }, async () => {
  const stored = { priminfo_pro_active_state_v2: { models: ["PRAXIS", "FLEX"] } };
  for (const q of [`${LINK}&models=FOO`, `${LINK}&models=`, LINK]) {
    const { page, calcs } = await openRecording(q, stored);
    assert.equal(await checked(page), "FLEX,PRAXIS", q);
    assert.deepEqual(calcs, ["PRAXIS,FLEX"], q);
  }
  // nothing stored: all models
  const { page } = await openRecording(LINK);
  assert.equal(await checked(page), ALL);
});
