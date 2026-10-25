import { I18N } from "./i18n/index.js";
import { buildLocationIndex } from "./location-search.js";
import { fetchLocations, fetchFranchises, fetchCalculation } from "./api.js";
import { buildInsurerMinMap } from "./calc.js";
import {
  state,
  isChildYob,
  saveActiveStateToStorageAndUrl,
  saveActiveStateDebounced,
  persistProfiles,
  getCheapestPlanFromCurrentData,
  getEnrichedPlans
} from "./state.js";
import { showToast } from "./views/toast.js";
import {
  getAgeTagText,
  syncFormControlsFromState,
  renderMedicalQuickSelect,
  updateMobileCollapseLabel
} from "./views/controls.js";
import { buildProfileLabel, renderProfileChipsAndCards } from "./views/profiles.js";
import { renderKpis, renderRankingTable } from "./views/ranking.js";
import { populateCurvePlanSelect, renderCurvesTab } from "./views/curves.js";
import { renderMatrixTable } from "./views/matrix.js";
import { renderHistoryTable } from "./views/history.js";
import { renderGuideTab } from "./views/guide.js";

// Orchestration: fetch -> state -> views. main.js wires DOM events to these functions.

let calcFetchSeq = 0;
let calcAbortCtrl = null;
let franFetchSeq = 0;
let franAbortCtrl = null;
// Birth year the franchise <select> options were last loaded for (null until the first load succeeds)
let franchisesYob = null;

// Tabs whose DOM is out of date: a view parameter changed while another tab was shown
const staleTabs = new Set();

function viewInputs() {
  return {
    plans: getEnrichedPlans(),
    isKid: isChildYob(state.yob),
    rebate: state.data.meta?.monthlyRebate ?? 4.75,
    franchises: state.data.meta?.franchises || [300, 500, 1000, 1500, 2000, 2500]
  };
}

const TAB_RENDERERS = {
  ranking: ({ plans }) => renderRankingTable(plans),
  curves: ({ plans, franchises, rebate, isKid }) => renderCurvesTab(plans, franchises, rebate, isKid),
  matrix: ({ plans, franchises, rebate, isKid }) => renderMatrixTable(plans, franchises, rebate, isKid),
  history: () => renderHistoryTable(state.data.insurerHistory || [], state.data.meta?.historyYears || [])
};

// New data or language: redraw every data view. The guide depends only on the language (applyLanguage renders it)
function onDataChange() {
  updateMobileCollapseLabel();
  if (!state.data || !state.data.plans) return;
  staleTabs.clear();

  document.getElementById("age-group-badge").textContent = getAgeTagText(state.yob);

  const inputs = viewInputs();
  populateCurvePlanSelect();
  renderProfileChipsAndCards();
  renderKpis(inputs.plans, inputs.rebate);
  for (const render of Object.values(TAB_RENDERERS)) render(inputs);
}

// A view parameter (medical cost, filter, sort, matrix mode, curve plan) changed: redraw the shown tab if it is
// one of `tabs`, leave the others stale until switchTab shows them
export function invalidateTabs(tabs) {
  for (const t of tabs) staleTabs.add(t);
  renderIfStale(state.activeTab);
}

function renderIfStale(tabId) {
  if (!staleTabs.has(tabId) || !state.data || !state.data.plans) return;
  staleTabs.delete(tabId);
  TAB_RENDERERS[tabId](viewInputs());
}

function indexNormalizedLocations() {
  if (!state.locations?.names) return;
  state.normalizedLocations = buildLocationIndex(state.locations.names);
}

export async function loadLocations() {
  try {
    state.locations = await fetchLocations();
    indexNormalizedLocations();
    if (state.locations?.names?.[state.locationId]) {
      state.locationName = state.locations.names[state.locationId];
      document.getElementById("location-search").value = state.locationName;
      renderProfileChipsAndCards();
      updateMobileCollapseLabel();
    }
  } catch (e) {
    console.error("Failed to load locations:", e);
    showToast(I18N[state.lang].toastLoadFailed);
  }
}

// Sets state.franchise to `franchise` if `yob` offers it, else to the default for the age group.
// Resolves true once the options for `yob` are in place, false if the request failed,
// undefined if a newer call superseded this one
export async function updateFranchisesForYob(yob, franchise = state.franchise) {
  const seq = ++franFetchSeq;
  if (franAbortCtrl) franAbortCtrl.abort();
  franAbortCtrl = new AbortController();

  try {
    const data = await fetchFranchises(yob, franAbortCtrl.signal);
    if (seq !== franFetchSeq) return;

    const sel = document.getElementById("franchise-select");
    const prev = String(franchise);
    sel.innerHTML = "";
    const list = data.franchises || [];
    for (const opt of list) {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      sel.appendChild(o);
    }
    if (list.some(x => x.value === prev)) {
      sel.value = prev;
      state.franchise = Number(prev);
    } else if (list.length > 0) {
      const defVal = isChildYob(yob) ? "0" : "2500";
      sel.value = list.some(x => x.value === defVal) ? defVal : list[0].value;
      state.franchise = Number(sel.value);
    }
    franchisesYob = yob;
    return true;
  } catch (e) {
    if (e.name === "AbortError" || seq !== franFetchSeq) return;
    console.error("Failed to load franchises:", e);
    showToast(I18N[state.lang].toastLoadFailed);
    return false;
  }
}

// Without the options for the new birth year the selected franchise may not exist for it (a child has no
// F2500), so a failed request restores the year the options belong to and skips the calculation
export async function changeYob(yob) {
  const prevYob = franchisesYob ?? state.yob;
  state.yob = yob;
  const ok = await updateFranchisesForYob(yob);
  if (ok === undefined) return;
  if (!ok) {
    state.yob = prevYob;
    syncFormControlsFromState();
    document.getElementById("age-group-badge").textContent = getAgeTagText(state.yob);
    return;
  }
  await fetchAndRenderCalculation();
}

export async function fetchAndRenderCalculation() {
  const seq = ++calcFetchSeq;
  if (calcAbortCtrl) calcAbortCtrl.abort();
  calcAbortCtrl = new AbortController();

  const badge = document.getElementById("status-badge");
  badge.dataset.i18n = "statusLoading";
  badge.textContent = I18N[state.lang].statusLoading;
  badge.classList.add("loading");
  badge.classList.remove("error");
  let failed = false;

  try {
    const json = await fetchCalculation(state, calcAbortCtrl.signal);

    // Discard stale out-of-order responses
    if (seq !== calcFetchSeq) return;

    state.data = json;
    state.selectedCurvePlanIdx = 0;

    // Match or update active profile summary
    const matchedP = state.savedProfiles.find(
      p => p.locationId === state.locationId &&
           Number(p.yob) === Number(state.yob) &&
           Number(p.franchise) === Number(state.franchise) &&
           Number(p.coverage) === Number(state.coverage)
    );
    state.activeProfileId = matchedP ? matchedP.id : null;

    const cheapest = getCheapestPlanFromCurrentData();
    if (matchedP && cheapest) {
      matchedP.summaryMinMonthly = cheapest.monthlyNet;
      matchedP.summaryBestPlan = `${cheapest.insurer} (${cheapest.model})`;
      matchedP.insurerMinMap = buildInsurerMinMap(state.data?.plans || []);
      persistProfiles();
    }

    saveActiveStateToStorageAndUrl();
    onDataChange();
  } catch (e) {
    if (e.name === "AbortError") return;
    console.error("Calculation error:", e);
    failed = true;
    showToast(I18N[state.lang].toastLoadFailed);
  } finally {
    if (seq === calcFetchSeq) {
      // Keep data-i18n in sync so a language switch keeps showing the failure
      const statusKey = failed ? "statusError" : "statusReady";
      badge.dataset.i18n = statusKey;
      badge.textContent = I18N[state.lang][statusKey];
      badge.classList.remove("loading");
      badge.classList.toggle("error", failed);
    }
  }
}

export function saveCurrentAsProfile() {
  const dict = I18N[state.lang] || I18N.zh;
  const existing = state.savedProfiles.find(
    p => p.locationId === state.locationId &&
         Number(p.yob) === Number(state.yob) &&
         Number(p.franchise) === Number(state.franchise) &&
         Number(p.coverage) === Number(state.coverage)
  );

  const cheapest = getCheapestPlanFromCurrentData();
  const insurerMinMap = buildInsurerMinMap(state.data?.plans || []);
  const lbl = buildProfileLabel(state.locationName, state.yob, state.franchise, state.coverage);

  if (existing) {
    existing.locationName = state.locationName;
    existing.models = [...state.models];
    if (cheapest) {
      existing.summaryMinMonthly = cheapest.monthlyNet;
      existing.summaryBestPlan = `${cheapest.insurer} (${cheapest.model})`;
      existing.insurerMinMap = insurerMinMap;
    }
    state.activeProfileId = existing.id;
    showToast(dict.toastSavedUpdate(lbl));
  } else {
    const newProfile = {
      id: "p_" + Date.now(),
      locationId: state.locationId,
      locationName: state.locationName,
      yob: state.yob,
      franchise: state.franchise,
      coverage: state.coverage,
      models: [...state.models],
      summaryMinMonthly: cheapest ? cheapest.monthlyNet : null,
      summaryBestPlan: cheapest ? `${cheapest.insurer} (${cheapest.model})` : null,
      insurerMinMap
    };
    state.savedProfiles.push(newProfile);
    state.activeProfileId = newProfile.id;
    showToast(dict.toastSavedNew(lbl));
  }

  persistProfiles();
  saveActiveStateToStorageAndUrl();
  renderProfileChipsAndCards();
}

export async function applyProfile(profileId) {
  const p = state.savedProfiles.find(x => x.id === profileId);
  if (!p) return;
  // Switch only once the profile's franchise options are in place (see changeYob); this also sets
  // state.franchise, falling back to the default if the profile's birth year does not offer its franchise
  if (!(await updateFranchisesForYob(Number(p.yob), Number(p.franchise)))) return;
  state.activeProfileId = p.id;
  state.locationId = p.locationId;
  state.locationName = p.locationName;
  state.yob = Number(p.yob);
  state.coverage = Number(p.coverage);
  state.models = p.models?.length ? [...p.models] : ["BASE", "FLEX", "PRAXIS", "TEL_DIG", "PHARM"];

  syncFormControlsFromState();
  saveActiveStateToStorageAndUrl();
  renderProfileChipsAndCards();
  await fetchAndRenderCalculation();
}

export function deleteProfile(profileId, ev) {
  ev.stopPropagation();
  const dict = I18N[state.lang] || I18N.zh;
  if (state.savedProfiles.length <= 1) {
    showToast(dict.toastKeepOneProfile);
    return;
  }
  state.savedProfiles = state.savedProfiles.filter(p => p.id !== profileId);
  if (state.activeProfileId === profileId) {
    state.activeProfileId = state.savedProfiles[0]?.id || null;
  }
  persistProfiles();
  saveActiveStateToStorageAndUrl();
  renderProfileChipsAndCards();
  showToast(dict.toastDeleted);
}

export function setMedicalCost(cost) {
  const clamped = Math.max(0, Math.min(6000, Number(cost) || 0));
  state.medicalCost = clamped;
  const slider = document.getElementById("medical-cost-slider");
  if (slider) slider.value = String(clamped);
  renderMedicalQuickSelect();
  saveActiveStateDebounced();
  invalidateTabs(["ranking", "curves", "matrix"]);
}

export function switchTab(tabId) {
  state.activeTab = tabId;
  renderIfStale(tabId);
  document.querySelectorAll(".nav-tabs li").forEach(li => {
    const btn = li.querySelector("button");
    const isMatch = btn.dataset.tab === tabId;
    li.classList.toggle("active", isMatch);
    btn.setAttribute("aria-selected", isMatch);
  });

  ["ranking", "curves", "matrix", "history", "guide"].forEach(id => {
    const sec = document.getElementById(`view-${id}`);
    if (sec) sec.classList.toggle("hidden", id !== tabId);
  });

  saveActiveStateToStorageAndUrl();
}

export function applyLanguage(lang) {
  state.lang = I18N[lang] ? lang : "zh";
  const dict = I18N[state.lang];

  document.documentElement.lang = dict.htmlLang;
  document.title = dict.docTitle;

  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if (dict[key] && typeof dict[key] === "string") {
      el.textContent = dict[key];
    }
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (dict[key]) el.setAttribute("placeholder", dict[key]);
  });

  document.querySelectorAll("[data-model-tip]").forEach(el => {
    const key = el.getAttribute("data-model-tip");
    if (dict[key]) el.setAttribute("title", dict[key]);
  });

  const tip5yr = document.getElementById("th-5yr-tip");
  if (tip5yr) tip5yr.setAttribute("title", dict.th5YrTooltip);

  document.querySelectorAll(".lang-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.lang === state.lang);
  });

  renderMedicalQuickSelect();
  renderGuideTab();
  saveActiveStateToStorageAndUrl();
  if (state.data) {
    onDataChange();
  } else {
    renderProfileChipsAndCards();
    document.getElementById("age-group-badge").textContent = getAgeTagText(state.yob);
  }
}
