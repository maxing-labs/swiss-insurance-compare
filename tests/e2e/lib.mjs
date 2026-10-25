// Shared helpers for the browser tests. playwright-core is not a project dependency: point PLAYWRIGHT_CORE at an
// installed copy (and CHROMIUM at a browser binary if its bundled revision is not installed); without it, tests skip.
import { createRequire } from "node:module";

export const BASE = process.env.BASE || "http://127.0.0.1:8765";

let chromium = null;
export let skip = false;
try {
  ({ chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || "playwright-core"));
} catch {
  skip = "playwright-core not found (set PLAYWRIGHT_CORE)";
}

let browser;
async function launch() {
  if (!browser) {
    await fetch(BASE).catch(() => { throw new Error(`no server at ${BASE}: run python3 server.py first`); });
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || undefined });
  }
  return browser;
}

export async function close() {
  await browser?.close();
  browser = null;
}

// New context (empty localStorage unless `storage` seeds it). `beforeGoto(page)` can install routes before the app
// starts. Resolves once the first calculation has settled. Page errors and console errors/warnings go to page.errors.
export async function openApp({ query = "", storage = null, beforeGoto = null } = {}) {
  const context = await (await launch()).newContext({ locale: "zh-CN", acceptDownloads: true });
  // toasts remove themselves after 2.6 s, so record them as they appear
  await context.addInitScript(() => {
    window.__toasts = [];
    document.addEventListener("DOMContentLoaded", () => {
      new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
        if (n.classList?.contains("toast-item")) window.__toasts.push(n.textContent);
      }))).observe(document.getElementById("toast-container"), { childList: true });
    });
  });
  if (storage) {
    // seed once per tab, so a reload keeps what the app wrote
    await context.addInitScript((s) => {
      if (sessionStorage.getItem("__seeded")) return;
      sessionStorage.setItem("__seeded", "1");
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
    }, storage);
  }
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(`[pageerror] ${e.message}`));
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) page.errors.push(`[${m.type()}] ${m.text()}`); });
  if (beforeGoto) await beforeGoto(page);
  await withCalc(page, () => page.goto(`${BASE}/${query}`, { waitUntil: "domcontentloaded" }));
  return page;
}

export async function idle(page) {
  await page.waitForFunction(() => !document.getElementById("status-badge").classList.contains("loading"), null, { timeout: 60000 });
  await page.waitForTimeout(150);
}

// Run `action` and wait until the calculation it triggers has settled
export async function withCalc(page, action) {
  const resp = page.waitForResponse((r) => r.url().includes("/api/calculate"), { timeout: 60000 });
  await action();
  await resp;
  await idle(page);
}

export const badge = (page) => page.evaluate(() => {
  const b = document.getElementById("status-badge");
  return { text: b.textContent, loading: b.classList.contains("loading"), error: b.classList.contains("error") };
});

export const takeToasts = (page) => page.evaluate(() => window.__toasts.splice(0));

export const setYob = (page, v) => page.evaluate((v) => {
  const el = document.getElementById("yob-input");
  el.value = String(v);
  el.dispatchEvent(new Event("change", { bubbles: true }));
}, v);

export const clickCoverage = (page, v) => page.locator(`input[name="coverage"][value="${v}"]`).locator("xpath=..").click();

export const delay = (ms) => new Promise((res) => setTimeout(res, ms));
