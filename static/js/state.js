import { I18N } from "./i18n/index.js";
import { enrichPlans, ascNullsLast } from "./calc.js";

const STORAGE_KEY_PROFILES = "priminfo_pro_profiles_v2";
const STORAGE_KEY_ACTIVE_STATE = "priminfo_pro_active_state_v2";

export const state = {
  lang: "zh",
  activeTab: "ranking",
  locations: null,
  normalizedLocations: [],
  locationId: "80011450512497",
  locationName: "8001 Zürich",
  yob: 1990,
  franchise: 2500,
  coverage: 0,
  models: ["BASE", "FLEX", "PRAXIS", "TEL_DIG", "PHARM"],
  medicalCost: 500,
  searchQuery: "",
  sortBy: "monthlyNet",
  matrixMode: "monthly",
  selectedCurvePlanIdx: 0,
  showAllRankingRows: false,
  mobileFiltersCollapsed: false,
  data: null,
  savedProfiles: [],
  activeProfileId: null
};

let saveStateTimer = null;

export function getPremiumYear() {
  return state.data?.meta?.premiumYear || 2027;
}

export function isChildYob(yob) {
  const py = getPremiumYear();
  return Number(yob) >= py - 18;
}

export function saveActiveStateToStorageAndUrl() {
  const activeSnapshot = {
    lang: state.lang,
    activeTab: state.activeTab,
    locationId: state.locationId,
    locationName: state.locationName,
    yob: state.yob,
    franchise: state.franchise,
    coverage: state.coverage,
    models: state.models,
    medicalCost: state.medicalCost,
    activeProfileId: state.activeProfileId
  };
  try {
    localStorage.setItem(STORAGE_KEY_ACTIVE_STATE, JSON.stringify(activeSnapshot));
  } catch (e) {
    // ignore storage errors
  }

  try {
    const params = new URLSearchParams(window.location.search);
    params.set("loc", state.locationId);
    params.set("yob", String(state.yob));
    params.set("fran", String(state.franchise));
    params.set("acc", String(state.coverage));
    params.set("med", String(state.medicalCost));
    params.set("tab", state.activeTab);
    params.set("lang", state.lang);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", newUrl);
  } catch (e) {
    // ignore history errors
  }
}

// Medical-cost controls fire per frame while dragging; Safari throttles replaceState (100 calls / 30 s)
export function saveActiveStateDebounced() {
  clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(saveActiveStateToStorageAndUrl, 500);
}

export function loadSavedProfilesAndActiveState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROFILES);
    if (raw) {
      state.savedProfiles = JSON.parse(raw);
    }
  } catch (e) {
    state.savedProfiles = [];
  }

  if (!Array.isArray(state.savedProfiles) || state.savedProfiles.length === 0) {
    state.savedProfiles = [
      {
        id: "p_default_zh",
        locationId: "80011450512497",
        locationName: "8001 Zürich",
        yob: 1990,
        franchise: 2500,
        coverage: 0,
        models: ["BASE", "FLEX", "PRAXIS", "TEL_DIG", "PHARM"],
        summaryMinMonthly: null,
        summaryBestPlan: null,
        insurerMinMap: null
      }
    ];
    state.activeProfileId = "p_default_zh";
    persistProfiles();
  }

  // Restore last active state from localStorage
  try {
    const savedStateRaw = localStorage.getItem(STORAGE_KEY_ACTIVE_STATE);
    if (savedStateRaw) {
      const s = JSON.parse(savedStateRaw);
      if (s.lang && I18N[s.lang]) state.lang = s.lang;
      if (s.activeTab) state.activeTab = s.activeTab;
      if (s.locationId) state.locationId = s.locationId;
      if (s.locationName) state.locationName = s.locationName;
      if (s.yob >= 1900 && s.yob <= 2027) state.yob = Number(s.yob);
      if (s.franchise !== undefined) state.franchise = Number(s.franchise);
      if (s.coverage !== undefined) state.coverage = Number(s.coverage);
      if (Array.isArray(s.models) && s.models.length > 0) state.models = s.models;
      if (s.medicalCost !== undefined) state.medicalCost = Number(s.medicalCost);
      if (s.activeProfileId) state.activeProfileId = s.activeProfileId;
    }
  } catch (e) {
    // ignore
  }

  // Override with URL query params if present
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("lang") && I18N[params.get("lang")]) state.lang = params.get("lang");
    if (params.get("tab") && ["ranking", "curves", "matrix", "history", "guide"].includes(params.get("tab"))) {
      state.activeTab = params.get("tab");
    }
    if (params.get("loc")) state.locationId = params.get("loc");
    const qYob = Number(params.get("yob"));
    if (params.get("yob") && qYob >= 1900 && qYob <= 2027) state.yob = qYob;
    if (params.get("fran")) state.franchise = Number(params.get("fran"));
    if (params.get("acc") !== null && params.get("acc") !== "") state.coverage = Number(params.get("acc"));
    if (params.get("med") !== null && params.get("med") !== "") state.medicalCost = Number(params.get("med"));
  } catch (e) {
    // ignore
  }

  // Match activeProfileId against current configuration
  const matchedProfile = findActiveProfile();
  state.activeProfileId = matchedProfile ? matchedProfile.id : null;
}

function matchesConfig(p) {
  return p.locationId === state.locationId &&
         Number(p.yob) === Number(state.yob) &&
         Number(p.franchise) === Number(state.franchise) &&
         Number(p.coverage) === Number(state.coverage);
}

// Profiles saved without models cover every model (as in applyProfile)
function matchesModels(p) {
  const models = p.models?.length ? p.models : ["BASE", "FLEX", "PRAXIS", "TEL_DIG", "PHARM"];
  return models.length === state.models.length && models.every(m => state.models.includes(m));
}

// Saved profile for the current location, birth year, franchise and accident cover; saving updates it in place
export function findProfileByConfig() {
  return state.savedProfiles.find(matchesConfig);
}

// Profile the current view shows: its summary is computed from its own model filter, so that must match too
export function findActiveProfile() {
  return state.savedProfiles.find(p => matchesConfig(p) && matchesModels(p));
}

export function persistProfiles() {
  try {
    localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(state.savedProfiles));
  } catch (e) {
    console.error("Failed to save profiles:", e);
  }
}

export function getCheapestPlanFromCurrentData() {
  if (!state.data?.plans?.length) return null;
  const sorted = [...state.data.plans].sort((a, b) => ascNullsLast(a.monthlyNet, b.monthlyNet));
  return sorted[0].monthlyNet === null || sorted[0].monthlyNet === undefined ? null : sorted[0];
}

export function getEnrichedPlans() {
  if (!state.data?.plans) return [];
  return enrichPlans(state.data.plans, {
    medicalCost: state.medicalCost,
    franchise: state.franchise,
    isKid: isChildYob(state.yob),
    rebate: state.data.meta?.monthlyRebate ?? 4.75,
    franchises: state.data.meta?.franchises || [300, 500, 1000, 1500, 2000, 2500]
  });
}

export function filterAndSortPlans(plans) {
  const q = state.searchQuery.trim().toLowerCase();
  let list = plans.filter(p => {
    if (!q) return true;
    return p.insurer.toLowerCase().includes(q) || p.model.toLowerCase().includes(q);
  });

  list.sort((a, b) => {
    if (state.sortBy === "avgIncreasePct") {
      return (a.avgIncreasePct ?? 99) - (b.avgIncreasePct ?? 99);
    }
    if (state.sortBy === "totalYearCost") {
      return ascNullsLast(a.totalYearCost, b.totalYearCost);
    }
    return ascNullsLast(a.monthlyNet, b.monthlyNet);
  });
  return list;
}
