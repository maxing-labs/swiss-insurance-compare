import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcOutOfPocket,
  enrichPlans,
  buildCurveSeries,
  findCrossover,
  buildInsurerMinMap,
  familyBundleTop5
} from "../../static/js/calc.js";

const REBATE = 5;
// Gross monthly premiums per franchise; yearlyNet matches the selected franchise like the API does
const telmed = { insurer: "A", model: "Telmed", monthlyNet: 295, yearlyNet: 3540, matrixPrices: { 300: 400, 2500: 300 } };
const std300Only = { insurer: "B", model: "Std", monthlyNet: 445, yearlyNet: 5340, matrixPrices: { 300: 450, 2500: null } };

test("calcOutOfPocket: bills below the franchise are paid in full", () => {
  assert.equal(calcOutOfPocket(0, 300, false), 0);
  assert.equal(calcOutOfPocket(500, 2500, false), 500);
});

test("calcOutOfPocket: 10% co-pay above the franchise, capped at 700 for adults and 350 for children", () => {
  assert.equal(calcOutOfPocket(1300, 300, false), 400);
  assert.equal(calcOutOfPocket(20000, 300, false), 1000);
  assert.equal(calcOutOfPocket(20000, 0, true), 350);
});

test("enrichPlans: out-of-pocket and yearly total at the selected franchise", () => {
  const [a] = enrichPlans([telmed], { medicalCost: 1000, franchise: 2500, isKid: false, rebate: REBATE, franchises: [300, 2500] });
  assert.equal(a.outOfPocket, 1000);
  assert.equal(a.totalYearCost, 3540 + 1000);
  assert.equal(a.originalIdx, 0);
  assert.equal(a.insurer, "A");
});

test("enrichPlans: cheapest franchise flips from high to low as medical bills grow", () => {
  const opts = { franchise: 2500, isKid: false, rebate: REBATE, franchises: [300, 2500] };
  const [low] = enrichPlans([telmed], { ...opts, medicalCost: 0 });
  assert.equal(low.bestFranchiseForPlan, 2500);
  assert.equal(low.minTotalForPlan, 3540);

  const [high] = enrichPlans([telmed], { ...opts, medicalCost: 5000 });
  // F300: (400-5)*12 + 300 + 470 = 5510; F2500: (300-5)*12 + 2500 + 250 = 6290
  assert.equal(high.bestFranchiseForPlan, 300);
  assert.equal(high.minTotalForPlan, 5510);
  assert.ok(high.minTotalForPlan < high.totalYearCost);
});

test("enrichPlans: franchises the plan does not offer are skipped", () => {
  const [b] = enrichPlans([std300Only], { medicalCost: 0, franchise: 300, isKid: false, rebate: REBATE, franchises: [300, 2500] });
  assert.equal(b.bestFranchiseForPlan, 300);
  assert.equal(b.minTotalForPlan, 5340);
});

test("enrichPlans: on a tie the selected franchise wins", () => {
  const flat = { yearlyNet: 3600, matrixPrices: { 300: 305, 2500: 305 } };
  const [p] = enrichPlans([flat], { medicalCost: 0, franchise: 300, isKid: false, rebate: REBATE, franchises: [300, 2500] });
  assert.equal(p.bestFranchiseForPlan, 300);
});

test("enrichPlans: keeps the input order in originalIdx", () => {
  const out = enrichPlans([std300Only, telmed], { medicalCost: 0, franchise: 300, isKid: false, rebate: REBATE, franchises: [300] });
  assert.deepEqual(out.map(p => [p.insurer, p.originalIdx]), [["B", 0], ["A", 1]]);
});

test("buildCurveSeries: one series per offered franchise, totals = 12 x net premium + out-of-pocket", () => {
  const xPoints = [0, 1000, 6000];
  const series = buildCurveSeries(telmed, { franchises: [300, 1000, 2500], rebate: REBATE, isKid: false, medicalCost: 1800, xPoints });
  assert.deepEqual(series.map(s => s.franchise), [300, 2500]);
  for (const s of series) {
    assert.equal(s.netYearly, s.netMonthly * 12);
    assert.deepEqual(s.points.map(p => p.x), xPoints);
    assert.equal(s.points[0].y, s.netYearly);
    assert.equal(s.cursorOop, calcOutOfPocket(1800, s.franchise, false));
    assert.equal(s.cursorTotal, s.netYearly + s.cursorOop);
  }
  assert.equal(series[0].netMonthly, 395);
});

test("buildCurveSeries: net premium never goes below zero", () => {
  const [s] = buildCurveSeries({ matrixPrices: { 300: 3 } }, { franchises: [300], rebate: REBATE, isKid: false, medicalCost: 0, xPoints: [0] });
  assert.equal(s.netMonthly, 0);
});

test("findCrossover: first CHF 10 step where the low franchise is no more expensive", () => {
  const plan = { matrixPrices: { 300: 401, 2500: 300 } };
  const [low, high] = buildCurveSeries(plan, { franchises: [300, 2500], rebate: REBATE, isKid: false, medicalCost: 0, xPoints: [0] });
  const x = findCrossover(low, high, false, 6000);
  // 4752 + 300 + 0.1 (x - 300) <= 3540 + x  =>  x >= 1646.7
  assert.equal(x, 1650);
  const total = (s, bills) => s.netYearly + calcOutOfPocket(bills, s.franchise, false);
  assert.ok(total(low, x) <= total(high, x));
  assert.ok(total(low, x - 10) > total(high, x - 10));
});

test("findCrossover: equal totals count as crossed", () => {
  const s = (franchise) => ({ franchise, netYearly: 3540 });
  assert.equal(findCrossover(s(300), s(2500), false, 6000), 0);
});

test("findCrossover: null for a single series, the same franchise, or no crossing within maxX", () => {
  const s = (franchise, netYearly) => ({ franchise, netYearly });
  assert.equal(findCrossover(undefined, undefined, false, 6000), null);
  assert.equal(findCrossover(s(300, 4000), s(300, 4000), false, 6000), null);
  assert.equal(findCrossover(s(300, 9000), s(2500, 3000), false, 6000), null);
});

test("buildInsurerMinMap: cheapest plan per insurer, skipping missing prices", () => {
  const map = buildInsurerMinMap([
    { insurer: "A", model: "Std", monthlyNet: 400 },
    { insurer: "A", model: "Telmed", monthlyNet: 300 },
    { insurer: "B", model: "Std", monthlyNet: null },
    { insurer: "C", model: "HMO", monthlyNet: 350 }
  ]);
  assert.deepEqual(map, { A: { monthlyNet: 300, model: "Telmed" }, C: { monthlyNet: 350, model: "HMO" } });
  assert.deepEqual(buildInsurerMinMap(undefined), {});
});

test("familyBundleTop5: needs at least two profiles with cached prices", () => {
  const one = { insurerMinMap: { A: { monthlyNet: 100 } } };
  assert.deepEqual(familyBundleTop5([]), []);
  assert.deepEqual(familyBundleTop5([one, { insurerMinMap: null }, { insurerMinMap: {} }]), []);
});

test("familyBundleTop5: insurers common to all profiles, cheapest combined premium first, at most 5", () => {
  const names = ["A", "B", "C", "D", "E", "F", "G"];
  const p1 = { insurerMinMap: Object.fromEntries(names.map((n, i) => [n, { monthlyNet: 100 + i }])) };
  const p2 = { insurerMinMap: Object.fromEntries(names.filter(n => n !== "A").map((n, i) => [n, { monthlyNet: 50 - i }])) };
  const top = familyBundleTop5([p1, p2]);
  assert.equal(top.length, 5);
  assert.ok(!top.some(t => t.insurer === "A"));
  for (let i = 1; i < top.length; i++) assert.ok(top[i - 1].totalMonthly <= top[i].totalMonthly);
  for (const t of top) assert.equal(t.totalYearly, t.totalMonthly * 12);
  assert.deepEqual(top[0], { insurer: "B", totalMonthly: 151, totalYearly: 1812 });
});

test("enrichPlans: the selected franchise is priced from matrixPrices like every other franchise", () => {
  const [a] = enrichPlans([{ ...telmed, yearlyNet: 9999 }], { medicalCost: 1000, franchise: 2500, isKid: false, rebate: REBATE, franchises: [300, 2500] });
  assert.equal(a.totalYearCost, (300 - REBATE) * 12 + 1000);
  assert.equal(a.bestFranchiseForPlan, 2500);
});

test("enrichPlans: without a price at the selected franchise there is no total, and the best franchise is the cheapest offered", () => {
  // children at F600 (2027): Helsana offers only F0 and F500, upstream sends no premium
  const kid = { monthlyNet: null, yearlyNet: null, matrixPrices: { 0: 127.8, 100: null, 500: 100.8, 600: null } };
  const [p] = enrichPlans([kid], { medicalCost: 500, franchise: 600, isKid: true, rebate: 4.75, franchises: [0, 100, 500, 600] });
  assert.equal(p.totalYearCost, null);
  // F0: 123.05 * 12 + 50 = 1526.6; F500: 96.05 * 12 + 500 = 1652.6
  assert.equal(p.bestFranchiseForPlan, 0);
  assert.equal(Math.round(p.minTotalForPlan * 100), 152660);

  const [none] = enrichPlans([{ matrixPrices: {} }], { medicalCost: 500, franchise: 600, isKid: true, rebate: 4.75, franchises: [0, 600] });
  assert.deepEqual([none.totalYearCost, none.bestFranchiseForPlan, none.minTotalForPlan], [null, null, null]);
});

test("enrichPlans: totals equal to the Rappen tie, whatever the float noise, and the selected franchise wins", () => {
  // real 2027 premiums (Appenzell, born 2005); each pair costs the same to the Rappen at that bill
  const opts = { isKid: false, rebate: 4.75, franchises: [300, 2500] };
  // F2500: 174.65 * 12 + 1900 = 3995.80; F300: 294.65 * 12 + 300 + 160 = 3995.80 (3995.7999999999997 in floats)
  const visana = { yearlyNet: 2095.8, matrixPrices: { 300: 299.4, 2500: 179.4 } };
  assert.equal(enrichPlans([visana], { ...opts, medicalCost: 1900, franchise: 2500 })[0].bestFranchiseForPlan, 2500);
  // F300: 279.35 * 12 + 300 + 142 = 3794.20 (3794.2000000000003); F2500: 172.85 * 12 + 1720 = 3794.20
  const helsana = { yearlyNet: 3352.2, matrixPrices: { 300: 284.1, 2500: 177.6 } };
  assert.equal(enrichPlans([helsana], { ...opts, medicalCost: 1720, franchise: 300 })[0].bestFranchiseForPlan, 300);
});

test("findCrossover: totals equal to the Rappen count as crossed, whatever the float noise", () => {
  const plan = { matrixPrices: { 300: 284.1, 2500: 177.6 } };
  const [low, high] = buildCurveSeries(plan, { franchises: [300, 2500], rebate: 4.75, isKid: false, medicalCost: 0, xPoints: [0] });
  // both cost CHF 3'794.20 at CHF 1'720 of bills
  assert.equal(findCrossover(low, high, false, 6000), 1720);
});
