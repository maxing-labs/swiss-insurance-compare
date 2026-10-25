import { test } from "node:test";
import assert from "node:assert/strict";
import {
  state,
  getCheapestPlanFromCurrentData,
  filterAndSortPlans,
  findActiveProfile,
  findProfileByConfig
} from "../../static/js/state.js";

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

const ALL = ["BASE", "FLEX", "PRAXIS", "TEL_DIG", "PHARM"];
const config = { locationId: "1", yob: 1990, franchise: 2500, coverage: 0 };
function withConfig(models, profiles) {
  Object.assign(state, config, { models, savedProfiles: profiles });
}

test("findActiveProfile: same configuration and the same models, in any order", () => {
  const p = { id: "a", ...config, models: ["TEL_DIG", "BASE"] };
  withConfig(["BASE", "TEL_DIG"], [p]);
  assert.equal(findActiveProfile(), p);
  withConfig(["BASE"], [p]);
  assert.equal(findActiveProfile(), undefined);
  withConfig(["BASE", "TEL_DIG", "FLEX"], [p]);
  assert.equal(findActiveProfile(), undefined);
});

test("findActiveProfile: a profile saved without models covers every model", () => {
  const p = { id: "a", ...config };
  withConfig([...ALL], [p]);
  assert.equal(findActiveProfile(), p);
  withConfig(["BASE"], [{ ...p, models: [] }]);
  assert.equal(findActiveProfile(), undefined);
});

test("findActiveProfile: location, birth year, franchise and accident cover must match", () => {
  for (const diff of [{ locationId: "2" }, { yob: 1991 }, { franchise: 300 }, { coverage: 1 }]) {
    withConfig([...ALL], [{ id: "a", ...config, models: [...ALL], ...diff }]);
    assert.equal(findActiveProfile(), undefined, JSON.stringify(diff));
  }
  // stored values may be strings
  withConfig([...ALL], [{ id: "a", ...config, yob: "1990", franchise: "2500", coverage: "0" }]);
  assert.equal(findActiveProfile()?.id, "a");
});

test("findProfileByConfig: ignores the model filter, so saving updates the profile in place", () => {
  const p = { id: "a", ...config, models: [...ALL] };
  withConfig(["BASE"], [{ id: "b", ...config, locationId: "2" }, p]);
  assert.equal(findProfileByConfig(), p);
  assert.equal(findActiveProfile(), undefined);
});
