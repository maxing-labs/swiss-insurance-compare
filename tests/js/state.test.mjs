import { test } from "node:test";
import assert from "node:assert/strict";
import { state, getCheapestPlanFromCurrentData, filterAndSortPlans } from "../../static/js/state.js";

// Upstream leaves monthlyNet / yearlyNet null for plans that do not offer the selected franchise
const plans = [
  { insurer: "A", model: "Std", monthlyNet: 300, totalYearCost: 4100 },
  { insurer: "B", model: "Std", monthlyNet: null, totalYearCost: null },
  { insurer: "C", model: "HMO", monthlyNet: 250, totalYearCost: 3500 },
  { insurer: "D", model: "Std", totalYearCost: undefined }
];

test("getCheapestPlanFromCurrentData: skips plans without a premium", () => {
  state.data = { plans };
  assert.equal(getCheapestPlanFromCurrentData().insurer, "C");
});

test("getCheapestPlanFromCurrentData: null when no plan has a premium", () => {
  state.data = { plans: [plans[1], plans[3]] };
  assert.equal(getCheapestPlanFromCurrentData(), null);
});

test("filterAndSortPlans: plans without a premium go last, in their original order", () => {
  state.searchQuery = "";
  for (const sortBy of ["monthlyNet", "totalYearCost"]) {
    state.sortBy = sortBy;
    assert.deepEqual(filterAndSortPlans(plans).map(p => p.insurer), ["C", "A", "B", "D"], sortBy);
  }
});
