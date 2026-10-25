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

export function renderAll() {
  renderGuideTab();
  updateMobileCollapseLabel();
  if (!state.data || !state.data.plans) return;

  document.getElementById("age-group-badge").textContent = getAgeTagText(state.yob);

  const isKid = isChildYob(state.yob);
  const rebate = state.data.meta?.monthlyRebate ?? 4.75;
  const franchises = state.data.meta?.franchises || [300, 500, 1000, 1500, 2000, 2500];
  const enrichedPlans = getEnrichedPlans();

  populateCurvePlanSelect();
  renderProfileChipsAndCards();
  renderKpis(enrichedPlans, rebate);
  renderRankingTable(enrichedPlans);
  renderCurvesTab(enrichedPlans, franchises, rebate, isKid);
  renderMatrixTable(enrichedPlans, franchises, rebate, isKid);
  renderHistoryTable(state.data.insurerHistory || [], state.data.meta?.historyYears || []);
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

export async function updateFranchisesForYob(yob) {
  const seq = ++franFetchSeq;
  if (franAbortCtrl) franAbortCtrl.abort();
  franAbortCtrl = new AbortController();

  try {
    const data = await fetchFranchises(yob, franAbortCtrl.signal);
    if (seq !== franFetchSeq) return;

    const sel = document.getElementById("franchise-select");
    const prev = String(state.franchise);
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
    } else if (list.length > 0) {
      const defVal = isChildYob(yob) ? "0" : "2500";
      sel.value = list.some(x => x.value === defVal) ? defVal : list[0].value;
      state.franchise = Number(sel.value);
    }
  } catch (e) {
    if (e.name !== "AbortError") {
      console.error("Failed to load franchises:", e);
      showToast(I18N[state.lang].toastLoadFailed);
    }
  }
}

export async function fetchAndRenderCalculation() {
  const seq = ++calcFetchSeq;
  if (calcAbortCtrl) calcAbortCtrl.abort();
  calcAbortCtrl = new AbortController();

  const badge = document.getElementById("status-badge");
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
    populateCurvePlanSelect();
    renderAll();
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
  state.activeProfileId = p.id;
  state.locationId = p.locationId;
  state.locationName = p.locationName;
  state.yob = Number(p.yob);
  state.franchise = Number(p.franchise);
  state.coverage = Number(p.coverage);
  state.models = p.models?.length ? [...p.models] : ["BASE", "FLEX", "PRAXIS", "TEL_DIG", "PHARM"];

  await updateFranchisesForYob(state.yob);
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
  renderAll();
}

export function switchTab(tabId) {
  state.activeTab = tabId;
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
    renderAll();
  } else {
    renderProfileChipsAndCards();
    document.getElementById("age-group-badge").textContent = getAgeTagText(state.yob);
  }
}
