// A failed /api/franchises request must not leave the form on a birth year whose franchise options never loaded
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { skip, openApp, close, badge, takeToasts, setYob, withCalc, delay } from "./lib.mjs";

after(close);

const LOAD_FAILED = "数据加载失败，请稍后重试";
const fail502 = (r) => r.fulfill({ status: 502, body: '{"error":"Bad Gateway"}' });

const form = (page) => page.evaluate(() => ({
  yob: document.getElementById("yob-input").value,
  age: document.getElementById("age-group-badge").textContent,
  fran: document.getElementById("franchise-select").value,
  options: [...document.querySelectorAll("#franchise-select option")].map(o => o.value).join(","),
  url: new URLSearchParams(location.search).get("yob"),
  firstRow: document.querySelector("#ranking-tbody tr")?.textContent.replace(/\s+/g, " ").trim(),
  activeChip: document.querySelector("#profile-chips .p-chip.active")?.dataset.pid ?? null
}));

function countCalcRequests(page) {
  const urls = [];
  page.on("request", (r) => { if (r.url().includes("/api/calculate")) urls.push(r.url()); });
  return urls;
}

test("birth year change: on failure the old birth year comes back and nothing is calculated", { skip }, async () => {
  const page = await openApp();
  const before = await form(page);
  const calcs = countCalcRequests(page);
  await page.route("**/api/franchises**", fail502);

  // the input event shows the typed year's age right away
  await page.fill("#yob-input", "2015");
  await setYob(page, 2015);
  await page.waitForTimeout(800);
  assert.deepEqual(calcs, []);
  assert.deepEqual(await form(page), before);
  assert.deepEqual(await takeToasts(page), [LOAD_FAILED]);
  assert.deepEqual(await badge(page), { text: "数据已加载", loading: false, error: false });

  // a later change retries and goes through
  await page.unroute("**/api/franchises**");
  await withCalc(page, () => setYob(page, 2015));
  const after = await form(page);
  assert.equal(after.yob, "2015");
  assert.equal(after.options, "0,100,200,300,400,500,600");
  assert.equal(after.fran, "0");
  assert.match(calcs[0], /yob=2015&franchise=0&/);
  assert.deepEqual(page.errors.filter(e => !e.includes("502")), []);
});

test("birth year change: a failure after a superseded change goes back to the last loaded year", { skip }, async () => {
  const page = await openApp();
  const before = await form(page);
  const calcs = countCalcRequests(page);
  let n = 0;
  await page.route("**/api/franchises**", async (r) => {
    if (n++ === 0) { await delay(1000); return r.continue().catch(() => {}); }
    return fail502(r);
  });
  await setYob(page, 2015);
  await page.waitForTimeout(100);
  await setYob(page, 2010);
  await page.waitForTimeout(1500);
  assert.deepEqual(calcs, []);
  assert.deepEqual(await form(page), before);
  assert.deepEqual(await takeToasts(page), [LOAD_FAILED]);
});

const KID = {
  id: "p_kid", locationId: "80011450512497", locationName: "8001 Zürich", yob: 2015, franchise: 0, coverage: 1,
  models: ["BASE", "FLEX", "PRAXIS", "TEL_DIG", "PHARM"], summaryMinMonthly: null, summaryBestPlan: null, insurerMinMap: null
};
const ADULT = { ...KID, id: "p_adult", yob: 1990, franchise: 2500, coverage: 0 };

test("profile switch: on failure the current profile stays and nothing is calculated", { skip }, async () => {
  const page = await openApp({ storage: { priminfo_pro_profiles_v2: [ADULT, KID] } });
  const before = await form(page);
  assert.equal(before.activeChip, "p_adult");
  const calcs = countCalcRequests(page);
  await page.route("**/api/franchises**", fail502);

  await page.click('#profile-chips [data-pid="p_kid"] span');
  await page.waitForTimeout(800);
  assert.deepEqual(calcs, []);
  assert.deepEqual(await form(page), before);
  assert.deepEqual(await takeToasts(page), [LOAD_FAILED]);

  await page.unroute("**/api/franchises**");
  await withCalc(page, () => page.click('#profile-chips [data-pid="p_kid"] span'));
  const after = await form(page);
  assert.deepEqual([after.yob, after.fran, after.options, after.activeChip], ["2015", "0", "0,100,200,300,400,500,600", "p_kid"]);
  assert.match(calcs[0], /yob=2015&franchise=0&coverage=1&/);
});

test("startup: a failed franchises request still calculates the stored configuration", { skip }, async () => {
  const calcs = [];
  const page = await openApp({
    storage: { priminfo_pro_active_state_v2: { yob: 2015, franchise: 0, coverage: 0 } },
    beforeGoto: async (p) => {
      p.on("request", (r) => { if (r.url().includes("/api/calculate")) calcs.push(r.url()); });
      await p.route("**/api/franchises**", fail502);
    }
  });
  assert.equal(calcs.length, 1);
  assert.match(calcs[0], /yob=2015&franchise=0&/);
  assert.deepEqual(await takeToasts(page), [LOAD_FAILED]);
  assert.deepEqual(await badge(page), { text: "数据已加载", loading: false, error: false });
});

test("profile switch: a franchise the profile's birth year does not offer falls back to the default", { skip }, async () => {
  // e.g. saved while the franchise options had failed to load
  const page = await openApp({ storage: { priminfo_pro_profiles_v2: [ADULT, { ...KID, franchise: 2500 }] } });
  const calcs = countCalcRequests(page);
  await withCalc(page, () => page.click('#profile-chips [data-pid="p_kid"] span'));
  const after = await form(page);
  assert.deepEqual([after.yob, after.fran], ["2015", "0"]);
  assert.match(calcs[0], /yob=2015&franchise=0&/);
});
