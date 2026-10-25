import { I18N } from "./i18n/index.js";
import { esc } from "./format.js";
import { buildLocationIndex, searchLocations } from "./location-search.js";
import { fetchLocations, fetchFranchises, fetchCalculation } from "./api.js";
import { buildInsurerMinMap } from "./calc.js";
import {
  state,
  getPremiumYear,
  isChildYob,
  saveActiveStateToStorageAndUrl,
  saveActiveStateDebounced,
  loadSavedProfilesAndActiveState,
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
import { renderKpis, renderRankingTable, exportRankingToCsv } from "./views/ranking.js";
import { populateCurvePlanSelect, renderCurvesTab } from "./views/curves.js";
import { renderMatrixTable } from "./views/matrix.js";
import { renderHistoryTable } from "./views/history.js";
import { renderGuideTab } from "./views/guide.js";

let calcFetchSeq = 0;
let calcAbortCtrl = null;
let franFetchSeq = 0;
let franAbortCtrl = null;
let kbLocationIdx = -1;

function saveCurrentAsProfile() {
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

async function applyProfile(profileId) {
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

function deleteProfile(profileId, ev) {
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

function indexNormalizedLocations() {
  if (!state.locations?.names) return;
  state.normalizedLocations = buildLocationIndex(state.locations.names);
}

async function loadLocations() {
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

async function updateFranchisesForYob(yob) {
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

async function fetchAndRenderCalculation() {
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

function setMedicalCost(cost) {
  const clamped = Math.max(0, Math.min(6000, Number(cost) || 0));
  state.medicalCost = clamped;
  const slider = document.getElementById("medical-cost-slider");
  if (slider) slider.value = String(clamped);
  renderMedicalQuickSelect();
  saveActiveStateDebounced();
  renderAll();
}

function renderAll() {
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

function switchTab(tabId) {
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

function applyLanguage(lang) {
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

function bindEvents() {
  document.querySelectorAll(".lang-btn").forEach(btn => {
    btn.addEventListener("click", () => applyLanguage(btn.dataset.lang));
  });

  document.querySelectorAll(".nav-tabs button").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  document.getElementById("btn-save-profile").addEventListener("click", saveCurrentAsProfile);

  const toggleFiltersBtn = document.getElementById("btn-toggle-filters");
  if (toggleFiltersBtn) {
    toggleFiltersBtn.addEventListener("click", () => {
      state.mobileFiltersCollapsed = !state.mobileFiltersCollapsed;
      document.querySelector(".profile-bar").classList.toggle("is-collapsed", state.mobileFiltersCollapsed);
      updateMobileCollapseLabel();
    });
  }

  document.getElementById("profile-chips").addEventListener("click", (e) => {
    const delBtn = e.target.closest("[data-del]");
    if (delBtn) {
      deleteProfile(delBtn.dataset.del, e);
      return;
    }
    const chip = e.target.closest("[data-pid]");
    if (chip) applyProfile(chip.dataset.pid);
  });

  document.getElementById("saved-cards-grid").addEventListener("click", (e) => {
    const card = e.target.closest("[data-pid]");
    if (card) applyProfile(card.dataset.pid);
  });

  const locInput = document.getElementById("location-search");
  const locDropdown = document.getElementById("location-dropdown");

  const selectLocationItem = async (id, name) => {
    state.locationId = id;
    state.locationName = name;
    locInput.value = name;
    locDropdown.classList.add("hidden");
    locInput.setAttribute("aria-expanded", "false");
    kbLocationIdx = -1;
    await fetchAndRenderCalculation();
  };

  const renderLocationDropdown = (query) => {
    const dict = I18N[state.lang] || I18N.zh;
    const { matches, totalCount } = searchLocations(state.normalizedLocations, query);
    kbLocationIdx = -1;
    if (!query.trim()) {
      locDropdown.classList.add("hidden");
      locInput.setAttribute("aria-expanded", "false");
      return;
    }
    if (matches.length === 0) {
      locDropdown.innerHTML = `<li class="no-match">${dict.noLocationMatch}</li>`;
      locDropdown.classList.remove("hidden");
      locInput.setAttribute("aria-expanded", "true");
      return;
    }
    const itemsHtml = matches
      .map((m, idx) => `<li role="option" data-idx="${idx}" data-id="${esc(m.id)}" data-name="${esc(m.name)}">${esc(m.name)}</li>`)
      .join("");
    const metaHtml = totalCount > matches.length
      ? `<li class="match-meta">${dict.locationMoreHint(totalCount)}</li>`
      : "";
    locDropdown.innerHTML = itemsHtml + metaHtml;
    locDropdown.classList.remove("hidden");
    locInput.setAttribute("aria-expanded", "true");
  };

  locInput.addEventListener("input", () => {
    renderLocationDropdown(locInput.value);
  });

  locInput.addEventListener("focus", () => {
    locInput.select();
  });

  locInput.addEventListener("keydown", async (e) => {
    const items = Array.from(locDropdown.querySelectorAll("li[data-id]"));
    if (e.key === "ArrowDown") {
      if (locDropdown.classList.contains("hidden")) {
        renderLocationDropdown(locInput.value);
        return;
      }
      if (!items.length) return;
      e.preventDefault();
      kbLocationIdx = (kbLocationIdx + 1) % items.length;
      items.forEach((el, i) => el.classList.toggle("kb-active", i === kbLocationIdx));
      items[kbLocationIdx].scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      if (!items.length || locDropdown.classList.contains("hidden")) return;
      e.preventDefault();
      kbLocationIdx = (kbLocationIdx - 1 + items.length) % items.length;
      items.forEach((el, i) => el.classList.toggle("kb-active", i === kbLocationIdx));
      items[kbLocationIdx].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!locDropdown.classList.contains("hidden") && items.length > 0) {
        const target = items[kbLocationIdx >= 0 ? kbLocationIdx : 0];
        await selectLocationItem(target.dataset.id, target.dataset.name);
      }
    } else if (e.key === "Escape") {
      locDropdown.classList.add("hidden");
      locInput.setAttribute("aria-expanded", "false");
      locInput.value = state.locationName;
    }
  });

  locInput.addEventListener("blur", () => {
    setTimeout(() => {
      locDropdown.classList.add("hidden");
      locInput.setAttribute("aria-expanded", "false");
      // Always restore clean canonical location name on blur if unconfirmed text was left
      locInput.value = state.locationName;
    }, 180);
  });

  locDropdown.addEventListener("mousedown", async (e) => {
    const li = e.target.closest("li[data-id]");
    if (!li) return;
    e.preventDefault();
    await selectLocationItem(li.dataset.id, li.dataset.name);
  });

  const yobInput = document.getElementById("yob-input");
  const yobError = document.getElementById("yob-error");

  const validateYobValue = (rawVal) => {
    const trimmed = String(rawVal).trim();
    if (!trimmed) return false;
    const num = Number(trimmed);
    const maxYear = getPremiumYear();
    return Number.isInteger(num) && num >= 1900 && num <= maxYear;
  };

  yobInput.addEventListener("input", () => {
    const ok = validateYobValue(yobInput.value);
    yobInput.classList.toggle("is-invalid", !ok);
    yobError.classList.toggle("visible", !ok);
    if (ok) {
      document.getElementById("age-group-badge").textContent = getAgeTagText(Number(yobInput.value));
    }
  });

  yobInput.addEventListener("change", async () => {
    const dict = I18N[state.lang] || I18N.zh;
    const ok = validateYobValue(yobInput.value);
    if (!ok) {
      yobInput.classList.add("is-invalid");
      yobError.classList.add("visible");
      showToast(dict.toastInvalidYob);
      return;
    }
    yobInput.classList.remove("is-invalid");
    yobError.classList.remove("visible");
    const val = Number(yobInput.value);
    state.yob = val;
    await updateFranchisesForYob(val);
    await fetchAndRenderCalculation();
  });

  const franSelect = document.getElementById("franchise-select");
  franSelect.addEventListener("change", () => {
    state.franchise = Number(franSelect.value);
    fetchAndRenderCalculation();
  });

  document.querySelectorAll('input[name="coverage"]').forEach(radio => {
    radio.addEventListener("change", (e) => {
      state.coverage = Number(e.target.value);
      fetchAndRenderCalculation();
    });
  });

  document.querySelectorAll("#model-pills .m-chip input").forEach(cb => {
    cb.addEventListener("change", () => {
      const dict = I18N[state.lang] || I18N.zh;
      const chip = cb.closest(".m-chip");
      const checked = Array.from(document.querySelectorAll("#model-pills input:checked")).map(i => i.value);
      if (checked.length === 0) {
        cb.checked = true;
        chip.classList.add("active");
        showToast(dict.toastKeepOneModel);
        return;
      }
      chip.classList.toggle("active", cb.checked);
      state.models = checked;
      fetchAndRenderCalculation();
    });
  });

  const quickMedSel = document.getElementById("medical-quick-select");
  const costSlider = document.getElementById("medical-cost-slider");

  quickMedSel.addEventListener("change", () => {
    setMedicalCost(Number(quickMedSel.value));
  });

  costSlider.addEventListener("input", () => {
    setMedicalCost(Number(costSlider.value));
  });

  document.querySelectorAll(".preset-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      setMedicalCost(Number(btn.dataset.cost));
    });
  });

  const svg = document.getElementById("breakeven-svg");
  const updateCursorFromSvgEvent = (e) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const relX = (e.clientX - rect.left) / rect.width;
    const svgX = relX * 820;
    const padL = 72, padR = 28;
    const ratio = (svgX - padL) / (820 - padL - padR);
    const clamped = Math.max(0, Math.min(1, ratio));
    const cost = Math.round((clamped * 6000) / 50) * 50;
    setMedicalCost(cost);
  };

  let isDraggingSvg = false;
  svg.addEventListener("pointerdown", (e) => {
    isDraggingSvg = true;
    try {
      svg.setPointerCapture(e.pointerId);
    } catch (_) {}
    updateCursorFromSvgEvent(e);
  });
  svg.addEventListener("pointermove", (e) => {
    if (isDraggingSvg) updateCursorFromSvgEvent(e);
  });
  svg.addEventListener("pointerup", (e) => {
    isDraggingSvg = false;
    try {
      svg.releasePointerCapture(e.pointerId);
    } catch (_) {}
  });
  svg.addEventListener("pointercancel", () => {
    isDraggingSvg = false;
  });

  document.getElementById("curve-plan-select").addEventListener("change", (e) => {
    state.selectedCurvePlanIdx = Number(e.target.value);
    renderAll();
  });

  document.getElementById("ranking-tbody").addEventListener("click", (e) => {
    const guideBadge = e.target.closest("[data-goto-guide]");
    if (guideBadge) {
      switchTab("guide");
      return;
    }
    const btn = e.target.closest(".btn-curve-jump");
    if (!btn) return;
    state.selectedCurvePlanIdx = Number(btn.dataset.planIdx);
    document.getElementById("curve-plan-select").value = String(state.selectedCurvePlanIdx);
    renderAll();
    switchTab("curves");
  });

  const loadMoreBtn = document.getElementById("btn-load-more");
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", () => {
      state.showAllRankingRows = !state.showAllRankingRows;
      renderRankingTable(getEnrichedPlans());
    });
  }

  const exportCsvBtn = document.getElementById("btn-export-csv");
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", exportRankingToCsv);
  }

  document.getElementById("matrix-tbody").addEventListener("click", (e) => {
    const tr = e.target.closest(".matrix-row");
    if (!tr) return;
    state.selectedCurvePlanIdx = Number(tr.dataset.planIdx);
    document.getElementById("curve-plan-select").value = String(state.selectedCurvePlanIdx);
    renderAll();
    switchTab("curves");
  });

  document.getElementById("search-filter").addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    renderAll();
  });

  document.getElementById("sort-select").addEventListener("change", (e) => {
    state.sortBy = e.target.value;
    renderAll();
  });

  document.querySelectorAll('input[name="matrixMode"]').forEach(radio => {
    radio.addEventListener("change", (e) => {
      state.matrixMode = e.target.value;
      renderAll();
    });
  });

  document.getElementById("query-form").addEventListener("submit", (e) => {
    e.preventDefault();
  });
}

async function initApp() {
  loadSavedProfilesAndActiveState();
  bindEvents();
  await updateFranchisesForYob(state.yob);
  syncFormControlsFromState();
  applyLanguage(state.lang);
  switchTab(state.activeTab);
  loadLocations();
  await fetchAndRenderCalculation();
}

document.addEventListener("DOMContentLoaded", initApp);
