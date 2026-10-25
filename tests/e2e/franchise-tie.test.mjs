// Two franchises that cost the same to the Rappen: the selected one wins in the matrix and on the curve alike
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { skip, openApp, close } from "./lib.mjs";

after(close);

test("a tie keeps the selected franchise as the best one in the matrix and the curve verdict", { skip }, async () => {
  // real 2027 premiums of Visana Tel Care (Appenzell, born 2005) on the first plan: at CHF 1'900 of bills
  // F300 and F2500 both cost CHF 3'995.80, which floats make 3995.7999999999997 vs 3995.8
  const page = await openApp({
    query: "?loc=80011450512497&yob=1990&fran=2500&acc=0&med=1900&tab=curves",
    beforeGoto: (p) => p.route("**/api/calculate**", async (route) => {
      const resp = await route.fetch();
      const json = await resp.json();
      Object.assign(json.plans[0], {
        monthlyGross: 179.4, monthlyRebate: 4.75, monthlyNet: 174.65, yearlyGross: 2152.8, yearlyRebate: 57, yearlyNet: 2095.8,
        matrixPrices: { 300: 299.4, 500: null, 1000: null, 1500: null, 2000: null, 2500: 179.4 }
      });
      json.meta.monthlyRebate = 4.75;
      await route.fulfill({ response: resp, json });
    })
  });
  const curve = await page.evaluate(() => ({
    title: document.getElementById("verdict-title").textContent,
    best: document.querySelector("#cursor-breakdown .cb-item.best .cb-head").textContent.replace(/\s+/g, " ").trim(),
    crossover: [...document.querySelectorAll("#breakeven-svg text")].map(t => t.textContent).find(t => t.startsWith("Break-even"))
  }));
  assert.deepEqual(curve, {
    title: "At CHF 1'900 medical bills: Franchise 2500 is cheapest",
    best: "Franchise 2500 ★Best",
    crossover: "Break-even ≈ CHF 1'900"
  });

  await page.click('.nav-tabs button[data-tab="matrix"]');
  const best = await page.evaluate(() =>
    [...document.querySelectorAll('#matrix-tbody tr[data-plan-idx="0"] .cell-best-franchise')].map(td => td.dataset.label));
  assert.deepEqual(best, ["F 2500"]);
  assert.deepEqual(page.errors, []);
});
