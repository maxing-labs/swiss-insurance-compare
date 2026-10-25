import { test, after } from "node:test";
import assert from "node:assert/strict";
import { skip, openApp, close, badge, idle, clickCoverage, delay } from "./lib.mjs";

after(close);

test("switching language while loading keeps the loading text, then shows the ready text", { skip }, async () => {
  const page = await openApp();
  await page.route("**/api/calculate**", async (r) => { await delay(1500); r.continue(); });
  await clickCoverage(page, 1);
  await page.waitForTimeout(200);
  assert.deepEqual(await badge(page), { text: "Loading...", loading: true, error: false });

  await page.click('.lang-btn[data-lang="zh"]');
  assert.deepEqual(await badge(page), { text: "加载中...", loading: true, error: false });
  await page.click('.lang-btn[data-lang="de"]');
  assert.deepEqual(await badge(page), { text: "Lädt...", loading: true, error: false });

  await idle(page);
  assert.deepEqual(await badge(page), { text: "Daten geladen", loading: false, error: false });
  await page.click('.lang-btn[data-lang="zh"]');
  assert.deepEqual(await badge(page), { text: "数据已加载", loading: false, error: false });
  assert.deepEqual(page.errors, []);
});

test("a request that fails after a language switch shows the error text in the new language", { skip }, async () => {
  const page = await openApp();
  await page.route("**/api/calculate**", async (r) => {
    await delay(800);
    r.fulfill({ status: 502, body: '{"error":"Bad Gateway"}' });
  });
  await clickCoverage(page, 1);
  await page.waitForTimeout(200);
  await page.click('.lang-btn[data-lang="de"]');
  assert.deepEqual(await badge(page), { text: "Lädt...", loading: true, error: false });
  await idle(page);
  assert.deepEqual(await badge(page), { text: "Ladefehler", loading: false, error: true });
  await page.click('.lang-btn[data-lang="en"]');
  assert.deepEqual(await badge(page), { text: "Load failed", loading: false, error: true });
});
