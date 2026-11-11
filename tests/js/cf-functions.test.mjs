import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EmptyResultError,
  getLocationsJson,
  handleApiRequest,
  handleRequest,
  parseChangeHtml,
  parseComparisonHtml,
  parseSavingsHtml,
  parseSelectOptions,
} from "../../functions/api/[[path]].js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const INSURERS = new Set(["KPT", "ÖKK", "Einsiedeln"]);
const PLAN_COUNT = 12;
const MAINTENANCE =
  "<html><head><style>body{font-family:sans-serif}</style></head>" +
  "<body><h1>Wartungsarbeiten</h1><p>Bitte versuchen Sie es später.</p></body></html>";

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), "utf8");
}

function fakeUpstream(broken = null) {
  return async (reqPath) => {
    if (broken && reqPath.includes(broken)) return MAINTENANCE;
    if (reqPath.startsWith("/de/praemien/locations")) return fixture("locations.js");
    if (reqPath.startsWith("/de/praemien/franchises")) return fixture("franchises.html");
    const url = new URL(`https://www.priminfo.admin.ch${reqPath}`);
    if (url.searchParams.getAll("models[]").join(",") === "PHARM") {
      return fixture("no_premiums.html");
    }
    return fixture(`${url.searchParams.get("display")}.html`);
  };
}

describe("Cloudflare Pages Function parity with api/index.py", () => {
  test("parses savings, comparison, change and franchises fixtures identically", async () => {
    const plans = parseSavingsHtml(fixture("savings.html"));
    assert.equal(plans.length, PLAN_COUNT);
    assert.deepEqual(new Set(plans.map((p) => p.insurer)), INSURERS);
    for (const p of plans) {
      assert.ok(p.insurerUrl.startsWith("http"));
      assert.ok(!p.model.includes("\u00ad"));
      assert.ok(p.monthlyRebate > 0);
      assert.ok(Math.abs(p.monthlyNet - (p.monthlyGross - p.monthlyRebate)) < 0.01);
    }

    const cmp = parseComparisonHtml(fixture("comparison.html"));
    assert.deepEqual(cmp.franchises, [300, 500, 1000, 1500, 2000, 2500]);
    assert.equal(cmp.rows.length, PLAN_COUNT);
    const kpt = cmp.rows.find((r) => r.insurer === "KPT");
    assert.equal(kpt.prices["2000"], null);

    const chg = parseChangeHtml(fixture("change.html"));
    assert.deepEqual(chg.years, ["2022", "2023", "2024", "2025", "2026", "2027"]);
    assert.deepEqual(new Set(chg.rows.map((r) => r.insurer)), INSURERS);

    const opts = parseSelectOptions(fixture("franchises.html"));
    assert.deepEqual(opts.map((o) => o.value), ["300", "500", "1000", "1500", "2000", "2500"]);
    assert.equal(opts[2].label, "CHF 1'000");

    const locs = await getLocationsJson(fakeUpstream());
    assert.equal(locs.names["80011450512497"], "8001 Zürich");
    assert.deepEqual(locs.index["zürich"], ["80011450512497"]);
  });

  test("handles /api/calculate, valid PHARM empty result, 502 maintenance and 404 unknown", async () => {
    const reqOk = new Request("https://swiss-insurance-compare.pages.dev/api/calculate");
    const resOk = await handleRequest(reqOk, { fetchUpstream: fakeUpstream() });
    assert.equal(resOk.status, 200);
    assert.match(resOk.headers.get("Cache-Control"), /s-maxage=3600/);
    const body = await resOk.json();
    assert.equal(body.plans.length, PLAN_COUNT);
    for (const p of body.plans) {
      assert.equal(p.matrixPrices["2500"], p.monthlyGross);
      assert.deepEqual(Object.keys(p.history), body.meta.historyYears);
      assert.notEqual(p.avgIncreasePct, null);
    }

    const reqPharm = new Request("https://swiss-insurance-compare.pages.dev/api/calculate?models=PHARM");
    const resPharm = await handleRequest(reqPharm, { fetchUpstream: fakeUpstream() });
    assert.equal(resPharm.status, 200);
    assert.deepEqual((await resPharm.json()).plans, []);

    for (const [p, broken] of [
      ["/api/calculate", "display=savings"],
      ["/api/calculate", "display=comparison"],
      ["/api/calculate", "display=change"],
      ["/api/franchises?yob=1990", "/de/praemien/franchises"],
      ["/api/locations", "/de/praemien/locations"],
    ]) {
      const res502 = await handleRequest(new Request(`https://swiss-insurance-compare.pages.dev${p}`), {
        fetchUpstream: fakeUpstream(broken),
      });
      assert.equal(res502.status, 502);
      assert.equal(res502.headers.get("Cache-Control"), null);
      assert.deepEqual(await res502.json(), { error: "Bad Gateway" });
    }

    const res404 = await handleRequest(new Request("https://swiss-insurance-compare.pages.dev/api/nope"), {
      fetchUpstream: fakeUpstream(),
    });
    assert.equal(res404.status, 404);
    assert.equal(res404.headers.get("Cache-Control"), null);
    assert.deepEqual(await res404.json(), { error: "Not Found" });

    // Recovery after maintenance page (never cached in memory)
    let firstCall = true;
    const toggleFetch = async () => {
      if (firstCall) {
        firstCall = false;
        return MAINTENANCE;
      }
      return fixture("locations.js");
    };
    await assert.rejects(() => handleApiRequest("/api/locations", {}, toggleFetch), EmptyResultError);
    const recovered = await handleApiRequest("/api/locations", {}, toggleFetch);
    assert.ok("80011450512497" in recovered.names);
  });
});
