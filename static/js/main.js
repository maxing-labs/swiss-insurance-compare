import { I18N } from "./i18n/index.js";
import { esc } from "./format.js";
import { searchLocations } from "./location-search.js";
import { state, getPremiumYear, loadSavedProfilesAndActiveState, getEnrichedPlans } from "./state.js";
import { showToast } from "./views/toast.js";
import { getAgeTagText, syncFormControlsFromState, updateMobileCollapseLabel } from "./views/controls.js";
import { renderRankingTable, exportRankingToCsv } from "./views/ranking.js";
import {
  renderAll,
  loadLocations,
  updateFranchisesForYob,
  fetchAndRenderCalculation,
  saveCurrentAsProfile,
  applyProfile,
  deleteProfile,
  setMedicalCost,
  switchTab,
  applyLanguage
} from "./controller.js";

let kbLocationIdx = -1;

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
