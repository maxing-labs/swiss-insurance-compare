// Plans without a premium (upstream leaves them null when the plan does not offer the selected franchise)
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { skip, openApp, close } from "./lib.mjs";

after(close);

const fmt = (n, d = 2) => {
  const [i, f] = Number(n).toFixed(d).split(".");
  return [i.replace(/\B(?=(\d{3})+(?!\d))/g, "'"), f].filter(Boolean).join(".");
};

// Serve the real response with the cheapest and the priciest plan (or all plans) blanked out the way upstream does it
async function openWithBlankedPlans({ all = false } = {}) {
  const box = {};
  const page = await openApp({
    beforeGoto: (p) => p.route("**/api/calculate**", async (route) => {
      const resp = await route.fetch();
      const json = await resp.json();
      const sel = String(json.meta.selectedFranchise);
      const byNet = [...json.plans].sort((a, b) => a.monthlyNet - b.monthlyNet);
      const blank = all ? json.plans : [byNet[0], byNet[byNet.length - 1]];
      for (const p of blank) {
        Object.assign(p, { monthlyGross: null, monthlyRebate: 0, monthlyNet: null, yearlyGross: null, yearlyRebate: 0, yearlyNet: null });
        p.matrixPrices[sel] = null;
      }
      const priced = byNet.slice(1, -1);
      Object.assign(box, { blank, cheapest: priced[0], priciest: priced[priced.length - 1], count: json.plans.length });
      await route.fulfill({ response: resp, json });
    })
  });
  return { page, ...box };
}

test("KPIs and the profile summary skip plans without a premium", { skip }, async () => {
  const { page, cheapest, priciest } = await openWithBlankedPlans();
  const kpi = await page.evaluate(() => Object.fromEntries(
    ["kpi-min-monthly", "kpi-min-plan", "kpi-max-savings", "kpi-savings-sub"].map(id => [id, document.getElementById(id).textContent])
  ));
  assert.deepEqual(kpi, {
    "kpi-min-monthly": `CHF ${fmt(cheapest.monthlyNet)}`,
    "kpi-min-plan": `${cheapest.insurer} · ${cheapest.model}`,
    "kpi-max-savings": `CHF ${fmt(priciest.yearlyNet - cheapest.yearlyNet, 0)}`,
    "kpi-savings-sub": `vs. priciest ${priciest.insurer} (${fmt(priciest.monthlyNet)}/mo)`
  });

  // the default profile matches the default configuration, so its summary is refreshed from this response
  const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem("priminfo_pro_profiles_v2")));
  assert.equal(profiles[0].summaryMinMonthly, cheapest.monthlyNet);
  assert.equal(profiles[0].summaryBestPlan, `${cheapest.insurer} (${cheapest.model})`);
  assert.deepEqual(page.errors, []);
});

test("KPI prices show a dash when no plan has a premium", { skip }, async () => {
  const { page, count } = await openWithBlankedPlans({ all: true });
  const kpi = await page.evaluate(() => Object.fromEntries(
    ["kpi-min-monthly", "kpi-min-plan", "kpi-max-savings", "kpi-savings-sub", "kpi-plan-count"].map(id => [id, document.getElementById(id).textContent])
  ));
  assert.deepEqual(kpi, {
    "kpi-min-monthly": "—", "kpi-min-plan": "—", "kpi-max-savings": "—", "kpi-savings-sub": "—", "kpi-plan-count": String(count)
  });
  assert.deepEqual(page.errors, []);
});

test("ranking and matrix list plans without a premium last", { skip }, async () => {
  const { page, blank, cheapest, count } = await openWithBlankedPlans();
  await page.click("#btn-load-more");
  const names = (sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].map(tr =>
    `${tr.querySelector("th").textContent.trim()}|${tr.querySelector("th + td").textContent.trim()}`), sel);
  const ranking = await names("#ranking-tbody tr");
  assert.equal(ranking.length, count);
  assert.equal(ranking[0], `${cheapest.insurer}|${cheapest.model}`);
  assert.deepEqual(ranking.slice(-2).sort(), blank.map(b => `${b.insurer}|${b.model}`).sort());

  await page.click('.nav-tabs button[data-tab="matrix"]');
  const matrix = await names("#matrix-tbody tr");
  assert.equal(matrix[0], `${cheapest.insurer}|${cheapest.model}`);
  assert.deepEqual(matrix.slice(-2).sort(), blank.map(b => `${b.insurer}|${b.model}`).sort());
});

test("sorted by total cost, plans without a premium go last and show no total", { skip }, async () => {
  const { page, blank, count } = await openWithBlankedPlans();
  await page.selectOption("#sort-select", "totalYearCost");
  await page.click("#btn-load-more");
  const rows = await page.evaluate(() => [...document.querySelectorAll("#ranking-tbody tr")].map(tr => ({
    name: `${tr.querySelector("th").textContent.trim()}|${tr.querySelector("th + td").textContent.trim()}`,
    total: tr.querySelector(".highlight-col").textContent.trim()
  })));
  assert.equal(rows.length, count);
  assert.deepEqual(rows.slice(-2).map(r => r.name).sort(), blank.map(b => `${b.insurer}|${b.model}`).sort());
  assert.deepEqual(rows.slice(-2).map(r => r.total), ["—", "—"]);
  assert.ok(rows.slice(0, -2).every(r => /^CHF \d/.test(r.total)));
});

test("CSV export leaves the premium cells of plans without a premium empty", { skip }, async () => {
  const { page, blank, cheapest } = await openWithBlankedPlans();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#btn-export-csv")]);
  const lines = fs.readFileSync(await dl.path(), "utf8").replace(/^﻿/, "").split("\n");
  // insurer and plan names are quoted and may contain commas
  const parse = (line) => line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).slice(0, -1)
    .map(c => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
  const head = parse(lines[0]);
  const rows = lines.slice(1).map(parse).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
  for (const b of blank) {
    const row = rows.find(r => r.Insurer === b.insurer && r.Plan === b.model);
    assert.equal(row.MonthlyNet_CHF, "", `${b.insurer} ${b.model}`);
    assert.equal(row.YearlyNet_CHF, "", `${b.insurer} ${b.model}`);
    assert.equal(row.TotalAnnualCost_CHF, "", `${b.insurer} ${b.model}`);
  }
  assert.equal(rows[0].Insurer, cheapest.insurer);
  assert.equal(rows[0].MonthlyNet_CHF, cheapest.monthlyNet.toFixed(2));
  assert.equal(rows[0].YearlyNet_CHF, cheapest.yearlyNet.toFixed(2));
});
