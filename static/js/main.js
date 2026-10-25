import { I18N } from "./i18n/index.js";
import { fmtChf, fmtSignedPct, esc } from "./format.js";

const STORAGE_KEY_PROFILES = "priminfo_pro_profiles_v2";
const STORAGE_KEY_ACTIVE_STATE = "priminfo_pro_active_state_v2";

const FRANCHISE_COLORS = {
  0: "#2563eb",
  100: "#0891b2",
  200: "#0d9488",
  300: "#dc2626",
  400: "#d97706",
  500: "#ea580c",
  600: "#059669",
  1000: "#d97706",
  1500: "#7c3aed",
  2000: "#2563eb",
  2500: "#059669"
};

const HISTORY_LINE_COLORS = [
  "#dc2626", "#2563eb", "#059669", "#d97706",
  "#7c3aed", "#0891b2", "#be185d", "#4b5563"
];

const DEFAULT_RANKING_LIMIT = 25;

const state = {
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

let calcFetchSeq = 0;
let calcAbortCtrl = null;
let franFetchSeq = 0;
let franAbortCtrl = null;
let kbLocationIdx = -1;
let saveStateTimer = null;

function getPremiumYear() {
  return state.data?.meta?.premiumYear || 2027;
}

function isChildYob(yob) {
  const py = getPremiumYear();
  return Number(yob) >= py - 18;
}

function calcOutOfPocket(medicalBills, franchise, isKid) {
  const maxSelbstbehalt = isKid ? 350 : 700;
  const partFranchise = Math.min(medicalBills, franchise);
  const remaining = Math.max(0, medicalBills - partFranchise);
  const partSelbstbehalt = Math.min(remaining * 0.1, maxSelbstbehalt);
  return partFranchise + partSelbstbehalt;
}

function getAgeTagText(yob) {
  const dict = I18N[state.lang] || I18N.zh;
  const age = Math.max(0, getPremiumYear() - Number(yob));
  if (age <= 18) return dict.ageChild(age);
  if (age <= 25) return dict.ageYouth(age);
  return dict.ageAdult(age);
}

function showToast(message) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const item = document.createElement("div");
  item.className = "toast-item";
  item.textContent = message;
  container.appendChild(item);
  setTimeout(() => {
    item.remove();
  }, 2600);
}

function normalizeSearchStr(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ae/g, "a")
    .replace(/oe/g, "o")
    .replace(/ue/g, "u")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function buildProfileLabel(locationName, yob, franchise, coverage) {
  const dict = I18N[state.lang] || I18N.zh;
  const cityShort = (locationName || "").split(",")[0].trim();
  const accTag = coverage ? dict.accSuffix : "";
  return `${cityShort} · ${yob} · F${franchise}${accTag}`;
}

function saveActiveStateToStorageAndUrl() {
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
function saveActiveStateDebounced() {
  clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(saveActiveStateToStorageAndUrl, 500);
}

function loadSavedProfilesAndActiveState() {
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
  const matchedProfile = state.savedProfiles.find(
    p => p.locationId === state.locationId &&
         Number(p.yob) === Number(state.yob) &&
         Number(p.franchise) === Number(state.franchise) &&
         Number(p.coverage) === Number(state.coverage)
  );
  state.activeProfileId = matchedProfile ? matchedProfile.id : null;
}

function persistProfiles() {
  try {
    localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(state.savedProfiles));
  } catch (e) {
    console.error("Failed to save profiles:", e);
  }
}

function buildInsurerMinMap(plans) {
  const map = {};
  for (const p of plans || []) {
    if (p.monthlyNet === null || p.monthlyNet === undefined) continue;
    if (map[p.insurer] === undefined || p.monthlyNet < map[p.insurer].monthlyNet) {
      map[p.insurer] = { monthlyNet: p.monthlyNet, model: p.model };
    }
  }
  return map;
}

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

function getCheapestPlanFromCurrentData() {
  if (!state.data?.plans?.length) return null;
  const sorted = [...state.data.plans].sort((a, b) => a.monthlyNet - b.monthlyNet);
  return sorted[0];
}

function syncFormControlsFromState() {
  document.getElementById("location-search").value = state.locationName;
  const yobInput = document.getElementById("yob-input");
  yobInput.value = state.yob;
  yobInput.classList.remove("is-invalid");
  document.getElementById("yob-error").classList.remove("visible");

  document.getElementById("franchise-select").value = String(state.franchise);

  document.querySelectorAll('input[name="coverage"]').forEach(r => {
    r.checked = Number(r.value) === state.coverage;
  });

  document.querySelectorAll("#model-pills .m-chip").forEach(chip => {
    const cb = chip.querySelector("input");
    cb.checked = state.models.includes(cb.value);
    chip.classList.toggle("active", cb.checked);
  });

  document.getElementById("medical-cost-slider").value = String(state.medicalCost);
  renderMedicalQuickSelect();
  updateMobileCollapseLabel();
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

function renderProfileChipsAndCards() {
  const dict = I18N[state.lang] || I18N.zh;
  const chipsEl = document.getElementById("profile-chips");
  const boxEl = document.getElementById("saved-comparison-box");
  const gridEl = document.getElementById("saved-cards-grid");
  const famBox = document.getElementById("family-bundle-box");

  chipsEl.innerHTML = state.savedProfiles.map(p => {
    const isActive = p.id === state.activeProfileId;
    const activeCls = isActive ? "p-chip active" : "p-chip";
    const lbl = buildProfileLabel(p.locationName, p.yob, p.franchise, p.coverage);
    const priceTxt = p.summaryMinMonthly ? ` · CHF ${fmtChf(p.summaryMinMonthly, 0)}` : "";
    return `
      <div class="${activeCls}" data-pid="${p.id}">
        <span>${esc(lbl)}${priceTxt}</span>
        <button type="button" class="p-chip-del" data-del="${p.id}" title="${dict.delProfileTitle}">✕</button>
      </div>
    `;
  }).join("");

  if (state.savedProfiles.length === 0) {
    boxEl.classList.add("hidden");
    return;
  }
  boxEl.classList.remove("hidden");

  gridEl.innerHTML = state.savedProfiles.map(p => {
    const isActive = p.id === state.activeProfileId;
    const activeCls = isActive ? "saved-card active" : "saved-card";
    const lbl = buildProfileLabel(p.locationName, p.yob, p.franchise, p.coverage);
    const minTxt = p.summaryMinMonthly
      ? `CHF ${fmtChf(p.summaryMinMonthly)} ${dict.perMonth}`
      : dict.clickToLoadPrice;
    const yearlyTxt = p.summaryMinMonthly
      ? `${dict.netAnnualPrefix} ${fmtChf(p.summaryMinMonthly * 12, 0)} · ${esc(p.summaryBestPlan || "")}`
      : dict.notCachedYet;
    return `
      <div class="${activeCls}" data-pid="${p.id}">
        <div class="saved-card-head">
          <span>${esc(lbl)}</span>
          <span>${isActive ? dict.activeProfileBadge : dict.switchProfileBadge}</span>
        </div>
        <div class="saved-card-price">${minTxt}</div>
        <div class="saved-card-sub">${yearlyTxt}</div>
      </div>
    `;
  }).join("");

  // Render Family Bundle Same-Insurer Totals when >= 2 profiles have insurerMinMap
  const readyProfiles = state.savedProfiles.filter(p => p.insurerMinMap && Object.keys(p.insurerMinMap).length > 0);
  if (readyProfiles.length >= 2) {
    const allInsurers = Object.keys(readyProfiles[0].insurerMinMap);
    const commonTotals = [];
    for (const ins of allInsurers) {
      let sumMonthly = 0;
      let ok = true;
      for (const rp of readyProfiles) {
        const entry = rp.insurerMinMap[ins];
        if (!entry) {
          ok = false;
          break;
        }
        sumMonthly += entry.monthlyNet;
      }
      if (ok) {
        commonTotals.push({ insurer: ins, totalMonthly: sumMonthly, totalYearly: sumMonthly * 12 });
      }
    }
    commonTotals.sort((a, b) => a.totalMonthly - b.totalMonthly);
    const top5 = commonTotals.slice(0, 5);
    if (top5.length > 0) {
      famBox.classList.remove("hidden");
      famBox.innerHTML = `
        <div class="family-bundle-title">${dict.familyBundleTitle}</div>
        <div class="family-bundle-chips">
          ${top5.map((item, idx) => `
            <span class="fb-pill ${idx === 0 ? "best" : ""}">
              ${idx === 0 ? "★ " : `${idx + 1}. `}${esc(item.insurer)}: CHF ${fmtChf(item.totalMonthly)}${dict.perMonthShort} (CHF ${fmtChf(item.totalYearly, 0)}/yr)
            </span>
          `).join("")}
        </div>
      `;
    } else {
      famBox.classList.add("hidden");
    }
  } else {
    famBox.classList.add("hidden");
  }
}

function indexNormalizedLocations() {
  if (!state.locations?.names) return;
  state.normalizedLocations = Object.entries(state.locations.names).map(([id, name]) => {
    const normFull = normalizeSearchStr(name);
    const plzMatch = name.match(/^(\d{4})\s+(.*)$/);
    const plz = plzMatch ? plzMatch[1] : "";
    const cityOnly = plzMatch ? normalizeSearchStr(plzMatch[2]) : normFull;
    const words = normFull.split(/[\s,()/-]+/).filter(Boolean);
    return { id, name, plz, cityOnly, normFull, words };
  });
}

function searchLocations(query) {
  if (!state.normalizedLocations.length || !query.trim()) {
    return { matches: [], totalCount: 0 };
  }
  const qNorm = normalizeSearchStr(query);
  const qWords = qNorm.split(/[\s,]+/).filter(Boolean);
  if (qWords.length === 0) return { matches: [], totalCount: 0 };

  const scored = [];

  for (const loc of state.normalizedLocations) {
    let allMatched = true;
    let score = 0;

    for (const qw of qWords) {
      if (loc.plz === qw) {
        score += 1000;
      } else if (loc.cityOnly === qw) {
        score += 900;
      } else if (loc.plz.startsWith(qw)) {
        score += 750;
      } else if (loc.cityOnly.startsWith(qw)) {
        score += 650;
      } else if (loc.words.some(w => w === qw)) {
        score += 550;
      } else if (loc.words.some(w => w.startsWith(qw))) {
        score += 350;
      } else if (loc.normFull.includes(qw)) {
        score += 150;
      } else {
        allMatched = false;
        break;
      }
    }

    if (allMatched) {
      // Prefer shorter, primary city names on tie
      score -= loc.name.length * 0.5;
      scored.push({ id: loc.id, name: loc.name, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return {
    matches: scored.slice(0, 15),
    totalCount: scored.length
  };
}

async function loadLocations() {
  try {
    const res = await fetch("/api/locations");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.locations = await res.json();
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
    const res = await fetch(`/api/franchises?yob=${encodeURIComponent(yob)}`, {
      signal: franAbortCtrl.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
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
    const params = new URLSearchParams({
      location_id: state.locationId,
      yob: String(state.yob),
      franchise: String(state.franchise),
      coverage: String(state.coverage),
      models: state.models.join(",")
    });
    const res = await fetch(`/api/calculate?${params.toString()}`, {
      signal: calcAbortCtrl.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

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

function renderMedicalQuickSelect() {
  const dict = I18N[state.lang] || I18N.zh;
  const sel = document.getElementById("medical-quick-select");
  if (!sel) return;

  const standardCosts = [
    { val: 0, text: dict.medOpt0 },
    { val: 500, text: dict.medOpt500 },
    { val: 1500, text: dict.medOpt1500 },
    { val: 1800, text: dict.medOpt1800 },
    { val: 3000, text: dict.medOpt3000 },
    { val: 5000, text: dict.medOpt5000 }
  ];

  const hasExact = standardCosts.some(x => x.val === Number(state.medicalCost));
  if (!hasExact) {
    standardCosts.push({
      val: Number(state.medicalCost),
      text: dict.medOptCustom(state.medicalCost)
    });
    standardCosts.sort((a, b) => a.val - b.val);
  }

  sel.innerHTML = standardCosts
    .map(opt => `<option value="${opt.val}">${opt.text}</option>`)
    .join("");
  sel.value = String(state.medicalCost);
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

function getEnrichedPlans() {
  if (!state.data?.plans) return [];
  const isKid = isChildYob(state.yob);
  const rebate = state.data.meta?.monthlyRebate ?? 4.75;
  const franchises = state.data.meta?.franchises || [300, 500, 1000, 1500, 2000, 2500];
  const outOfPocketSelected = calcOutOfPocket(state.medicalCost, state.franchise, isKid);

  return state.data.plans.map((p, originalIdx) => {
    const totalYearCost = (p.yearlyNet || 0) + outOfPocketSelected;

    let bestFranchiseForPlan = state.franchise;
    let minTotalForPlan = totalYearCost;

    for (const f of franchises) {
      const grossMonthly = p.matrixPrices?.[String(f)];
      if (grossMonthly !== null && grossMonthly !== undefined) {
        const netYearly = Math.max(0, (grossMonthly - rebate) * 12);
        const oop = calcOutOfPocket(state.medicalCost, f, isKid);
        const tot = netYearly + oop;
        if (tot < minTotalForPlan) {
          minTotalForPlan = tot;
          bestFranchiseForPlan = f;
        }
      }
    }

    return {
      ...p,
      originalIdx,
      outOfPocket: outOfPocketSelected,
      totalYearCost,
      bestFranchiseForPlan,
      minTotalForPlan
    };
  });
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

function renderKpis(plans, rebate) {
  const dict = I18N[state.lang] || I18N.zh;
  if (plans.length === 0) return;
  const sortedByMonthly = [...plans].sort((a, b) => a.monthlyNet - b.monthlyNet);
  const cheapest = sortedByMonthly[0];
  const priciest = sortedByMonthly[sortedByMonthly.length - 1];
  const maxSavings = (priciest.yearlyNet || 0) - (cheapest.yearlyNet || 0);

  document.getElementById("kpi-min-monthly").textContent = `CHF ${fmtChf(cheapest.monthlyNet)}`;
  document.getElementById("kpi-min-plan").textContent = `${cheapest.insurer} · ${cheapest.model}`;

  document.getElementById("kpi-max-savings").textContent = `CHF ${fmtChf(maxSavings, 0)}`;
  document.getElementById("kpi-savings-sub").textContent = dict.vsPriciest(priciest.insurer, priciest.monthlyNet);

  const hist = (state.data.insurerHistory || []).filter(h => h.avgIncreasePct !== null && h.avgIncreasePct !== undefined);
  hist.sort((a, b) => a.avgIncreasePct - b.avgIncreasePct);
  if (hist.length > 0) {
    const lowest = hist[0];
    const worst = hist[hist.length - 1];
    document.getElementById("kpi-most-stable").textContent = `${lowest.insurer} (${fmtSignedPct(lowest.avgIncreasePct)})`;
    document.getElementById("kpi-stable-sub").textContent = dict.highestIncrease(worst.insurer, worst.avgIncreasePct);
  }

  document.getElementById("kpi-plan-count").textContent = `${plans.length}`;
  document.getElementById("kpi-rebate-info").textContent = dict.rebateDeducted(rebate);
}

function filterAndSortPlans(plans) {
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
      return (a.totalYearCost ?? 0) - (b.totalYearCost ?? 0);
    }
    return (a.monthlyNet ?? 0) - (b.monthlyNet ?? 0);
  });
  return list;
}

function getTrendBadgeHtml(pct) {
  if (pct === null || pct === undefined || isNaN(pct)) return `<span class="trend-badge">—</span>`;
  let cls = "trend-mid";
  if (pct <= 5.2) cls = "trend-low";
  else if (pct >= 6.5) cls = "trend-high";
  return `<span class="trend-badge ${cls}">${fmtSignedPct(pct, 1)}</span>`;
}

function getCategoryTip(cat) {
  const dict = I18N[state.lang] || I18N.zh;
  const map = {
    BASE: dict.tipBase,
    FLEX: dict.tipFlex,
    PRAXIS: dict.tipPraxis,
    TEL_DIG: dict.tipTel,
    PHARM: dict.tipPharm
  };
  return map[cat] || "";
}

function renderRankingTable(plans) {
  const dict = I18N[state.lang] || I18N.zh;
  const tbody = document.getElementById("ranking-tbody");
  const loadMoreWrap = document.getElementById("ranking-load-more-wrap");
  const loadMoreBtn = document.getElementById("btn-load-more");

  const filtered = filterAndSortPlans(plans);
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:2rem;">${dict.emptyPlans}</td></tr>`;
    loadMoreWrap.classList.add("hidden");
    return;
  }

  const visibleRows = state.showAllRankingRows
    ? filtered
    : filtered.slice(0, DEFAULT_RANKING_LIMIT);

  if (filtered.length > DEFAULT_RANKING_LIMIT) {
    loadMoreWrap.classList.remove("hidden");
    loadMoreBtn.textContent = state.showAllRankingRows
      ? dict.btnShowLessPlans(DEFAULT_RANKING_LIMIT)
      : dict.btnShowAllPlans(filtered.length, visibleRows.length);
  } else {
    loadMoreWrap.classList.add("hidden");
  }

  const catLabels = dict.catLabels;

  tbody.innerHTML = visibleRows.map((p, idx) => {
    // Only http(s) links: esc() alone does not stop javascript: URLs
    const insLink = /^https?:\/\//i.test(p.insurerUrl || "")
      ? `<a href="${esc(p.insurerUrl)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline dotted;">${esc(p.insurer)}</a>`
      : esc(p.insurer);
    const catTip = getCategoryTip(p.modelCategory);

    return `
      <tr>
        <td data-label="#">${idx + 1}</td>
        <th scope="row">${insLink}</th>
        <td data-label="${dict.thModel}">${esc(p.model)}</td>
        <td data-label="${dict.thCategory}">
          <span class="cat-tag cat-${p.modelCategory}" data-goto-guide="1" title="${catTip}">
            ${catLabels[p.modelCategory] || p.modelCategory}
          </span>
        </td>
        <td class="num-col" data-label="${dict.thMonthlyNet}"><strong>${fmtChf(p.monthlyNet)}</strong></td>
        <td class="num-col" data-label="${dict.thYearlyNet}">${fmtChf(p.yearlyNet)}</td>
        <td class="num-col" data-label="${dict.thOutOfPocket}">${fmtChf(p.outOfPocket)}</td>
        <td class="num-col highlight-col" data-label="${dict.thTotalRealCost}">CHF ${fmtChf(p.totalYearCost)}</td>
        <td class="num-col" data-label="${dict.th5YrAvg}" title="${dict.th5YrTooltip}">${getTrendBadgeHtml(p.avgIncreasePct)}</td>
        <td class="num-col" data-label="${dict.thCurveAction}">
          <button type="button" class="btn-curve-jump" data-plan-idx="${p.originalIdx}">${dict.btnSeeCurve}</button>
        </td>
      </tr>
    `;
  }).join("");
}

function populateCurvePlanSelect() {
  const dict = I18N[state.lang] || I18N.zh;
  const sel = document.getElementById("curve-plan-select");
  if (!state.data?.plans || !sel) return;
  sel.innerHTML = state.data.plans.map((p, idx) =>
    `<option value="${idx}">${dict.curveOptionLabel(esc(p.insurer), esc(p.model), p.monthlyNet)}</option>`
  ).join("");
  sel.value = String(state.selectedCurvePlanIdx);
}

function renderCurvesTab(plans, franchises, rebate, isKid) {
  const dict = I18N[state.lang] || I18N.zh;
  const plan = plans.find(p => p.originalIdx === state.selectedCurvePlanIdx) || plans[0];
  if (!plan) return;

  const sel = document.getElementById("curve-plan-select");
  if (sel && sel.value !== String(plan.originalIdx)) {
    sel.value = String(plan.originalIdx);
  }

  document.getElementById("curve-cost-readout").textContent = `CHF ${fmtChf(state.medicalCost, 0)}`;
  document.getElementById("chart-plan-title").textContent = dict.chartDynamicTitle(plan.insurer, plan.model);

  const maxX = 6000;
  const stepX = 100;
  const xPoints = [];
  for (let x = 0; x <= maxX; x += stepX) xPoints.push(x);

  const seriesList = [];
  for (const f of franchises) {
    const grossMonthly = plan.matrixPrices?.[String(f)];
    if (grossMonthly === null || grossMonthly === undefined) continue;
    const netMonthly = Math.max(0, grossMonthly - rebate);
    const netYearly = netMonthly * 12;
    const points = xPoints.map(x => ({
      x,
      y: netYearly + calcOutOfPocket(x, f, isKid)
    }));
    const cursorOop = calcOutOfPocket(state.medicalCost, f, isKid);
    const cursorTotal = netYearly + cursorOop;
    seriesList.push({
      franchise: f,
      color: FRANCHISE_COLORS[f] || "#64748b",
      netMonthly,
      netYearly,
      points,
      cursorOop,
      cursorTotal
    });
  }

  if (seriesList.length === 0) return;

  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of seriesList) {
    for (const pt of s.points) {
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
  }
  minY = Math.floor(minY / 200) * 200;
  maxY = Math.ceil(maxY / 200) * 200 + 100;
  if (maxY <= minY) maxY = minY + 1000;

  const legendEl = document.getElementById("chart-legend");
  legendEl.innerHTML = seriesList.map(s => `
    <span class="legend-item">
      <span class="legend-dot" style="background:${s.color}"></span>
      <span>F${s.franchise} (${fmtChf(s.netMonthly, 0)}${dict.perMonthShort})</span>
    </span>
  `).join("");

  const lowS = seriesList[0];
  const highS = seriesList[seriesList.length - 1];
  let crossoverX = null;
  if (lowS && highS && lowS.franchise !== highS.franchise) {
    for (let x = 0; x <= maxX; x += 10) {
      const yLow = lowS.netYearly + calcOutOfPocket(x, lowS.franchise, isKid);
      const yHigh = highS.netYearly + calcOutOfPocket(x, highS.franchise, isKid);
      if (yLow <= yHigh) {
        crossoverX = x;
        break;
      }
    }
  }

  const sortedAtCursor = [...seriesList].sort((a, b) => a.cursorTotal - b.cursorTotal);
  const bestAtCursor = sortedAtCursor[0];
  const worstAtCursor = sortedAtCursor[sortedAtCursor.length - 1];

  const vTitle = document.getElementById("verdict-title");
  const vDesc = document.getElementById("verdict-desc");
  vTitle.textContent = dict.verdictTitle(state.medicalCost, bestAtCursor.franchise);
  const crossNote = crossoverX !== null
    ? dict.verdictCrossoverNote(crossoverX, highS.franchise, lowS.franchise)
    : "";
  vDesc.textContent = dict.verdictDesc(
    bestAtCursor.cursorTotal,
    worstAtCursor.franchise,
    worstAtCursor.cursorTotal - bestAtCursor.cursorTotal,
    crossNote
  );

  const svg = document.getElementById("breakeven-svg");
  const W = 820, H = 420;
  const padL = 72, padR = 28, padT = 26, padB = 44;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const scaleX = (x) => padL + (Math.min(maxX, Math.max(0, x)) / maxX) * plotW;
  const scaleY = (y) => padT + plotH - ((y - minY) / (maxY - minY)) * plotH;

  const svgParts = [];

  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const valY = minY + ((maxY - minY) * i) / yTicks;
    const py = scaleY(valY);
    svgParts.push(`<line x1="${padL}" y1="${py}" x2="${W - padR}" y2="${py}" stroke="#e5e7eb" stroke-width="1" />`);
    svgParts.push(`<text x="${padL - 8}" y="${py + 4}" text-anchor="end" font-size="13" font-weight="600" fill="#4b5563">${fmtChf(valY, 0)}</text>`);
  }

  for (let x = 0; x <= maxX; x += 1000) {
    const px = scaleX(x);
    svgParts.push(`<line x1="${px}" y1="${padT}" x2="${px}" y2="${H - padB}" stroke="#e5e7eb" stroke-width="1" />`);
    svgParts.push(`<text x="${px}" y="${H - padB + 22}" text-anchor="middle" font-size="13" font-weight="600" fill="#4b5563">CHF ${fmtChf(x, 0)}</text>`);
  }

  if (crossoverX !== null) {
    const cx = scaleX(crossoverX);
    svgParts.push(`<line x1="${cx}" y1="${padT}" x2="${cx}" y2="${H - padB}" stroke="#d97706" stroke-width="1.8" stroke-dasharray="4 4" />`);
    svgParts.push(`<text x="${cx + 6}" y="${padT + 16}" font-size="13" font-weight="700" fill="#b45309">${dict.crossoverLabel(crossoverX)}</text>`);
  }

  for (const s of seriesList) {
    const isExtremes = s.franchise === lowS.franchise || s.franchise === highS.franchise;
    const strokeW = s.franchise === bestAtCursor.franchise ? 3.4 : (isExtremes ? 2.5 : 1.5);
    const opacity = s.franchise === bestAtCursor.franchise || isExtremes ? 1 : 0.55;
    const ptsAttr = s.points.map(pt => `${scaleX(pt.x).toFixed(1)},${scaleY(pt.y).toFixed(1)}`).join(" ");
    svgParts.push(
      `<polyline fill="none" stroke="${s.color}" stroke-width="${strokeW}" stroke-opacity="${opacity}" points="${ptsAttr}" />`
    );
  }

  const curX = scaleX(state.medicalCost);
  svgParts.push(`<line x1="${curX}" y1="${padT}" x2="${curX}" y2="${H - padB}" stroke="#111827" stroke-width="1.8" />`);

  for (const s of seriesList) {
    const cy = scaleY(s.cursorTotal);
    const r = s.franchise === bestAtCursor.franchise ? 6 : 4;
    svgParts.push(`<circle cx="${curX}" cy="${cy}" r="${r}" fill="${s.color}" stroke="#fff" stroke-width="1.5" />`);
  }

  svg.innerHTML = svgParts.join("");

  const bdEl = document.getElementById("cursor-breakdown");
  bdEl.innerHTML = seriesList.map(s => {
    const isBest = s.franchise === bestAtCursor.franchise;
    return `
      <div class="cb-item ${isBest ? "best" : ""}">
        <div class="cb-head">
          <span class="legend-dot" style="background:${s.color}"></span>
          <span>Franchise ${s.franchise} ${isBest ? dict.cbBestTag : ""}</span>
        </div>
        <div class="cb-total">CHF ${fmtChf(s.cursorTotal, 0)}</div>
        <div class="cb-sub">${dict.cbSubText(s.netYearly, s.cursorOop)}</div>
      </div>
    `;
  }).join("");
}

function renderMatrixTable(plans, franchises, rebate, isKid) {
  const dict = I18N[state.lang] || I18N.zh;
  const thead = document.getElementById("matrix-thead");
  const tbody = document.getElementById("matrix-tbody");
  const filtered = filterAndSortPlans(plans);

  thead.innerHTML = `
    <tr>
      <th scope="col">${dict.thInsurer}</th>
      <th scope="col">${dict.thModel}</th>
      ${franchises.map(f => `<th scope="col" class="num-col">F ${fmtChf(f, 0)}</th>`).join("")}
    </tr>
  `;

  tbody.innerHTML = filtered.map(p => {
    const cells = franchises.map(f => {
      const grossMonthly = p.matrixPrices?.[String(f)];
      if (grossMonthly === null || grossMonthly === undefined) {
        return `<td class="num-col" data-label="F ${f}">—</td>`;
      }
      const isBest = f === p.bestFranchiseForPlan;
      const cls = isBest ? "num-col cell-best-franchise" : "num-col";

      if (state.matrixMode === "monthly") {
        const netMonthly = Math.max(0, grossMonthly - rebate);
        return `<td class="${cls}" data-label="F ${f}">${fmtChf(netMonthly)}</td>`;
      } else {
        const netYearly = Math.max(0, (grossMonthly - rebate) * 12);
        const oop = calcOutOfPocket(state.medicalCost, f, isKid);
        return `<td class="${cls}" data-label="F ${f}">${fmtChf(netYearly + oop, 0)}</td>`;
      }
    }).join("");

    return `
      <tr class="matrix-row" data-plan-idx="${p.originalIdx}" style="cursor:pointer;" title="${dict.matrixRowTip}">
        <th scope="row">${esc(p.insurer)}</th>
        <td data-label="${dict.thModel}">${esc(p.model)}</td>
        ${cells}
      </tr>
    `;
  }).join("");
}

function renderHistoryChart(rows, years) {
  const svg = document.getElementById("history-svg");
  const legendEl = document.getElementById("history-chart-legend");
  if (!svg || !legendEl || !years.length || !rows.length) return;

  const topRows = rows
    .filter(r => years.some(y => r.history?.[y]?.premium !== null && r.history?.[y]?.premium !== undefined))
    .slice(0, 8);

  if (topRows.length === 0) {
    svg.innerHTML = "";
    legendEl.innerHTML = "";
    return;
  }

  let minP = Infinity;
  let maxP = -Infinity;
  for (const r of topRows) {
    for (const y of years) {
      const p = r.history?.[y]?.premium;
      if (p !== null && p !== undefined) {
        if (p < minP) minP = p;
        if (p > maxP) maxP = p;
      }
    }
  }
  minP = Math.floor(minP / 20) * 20 - 10;
  maxP = Math.ceil(maxP / 20) * 20 + 10;
  if (maxP <= minP) maxP = minP + 100;

  const W = 820, H = 300;
  const padL = 68, padR = 28, padT = 20, padB = 38;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const scaleX = (idx) => padL + (years.length > 1 ? (idx / (years.length - 1)) * plotW : plotW / 2);
  const scaleY = (val) => padT + plotH - ((val - minP) / (maxP - minP)) * plotH;

  const parts = [];
  const yTicks = 4;
  for (let i = 0; i <= yTicks; i++) {
    const val = minP + ((maxP - minP) * i) / yTicks;
    const py = scaleY(val);
    parts.push(`<line x1="${padL}" y1="${py}" x2="${W - padR}" y2="${py}" stroke="#e5e7eb" stroke-width="1" />`);
    parts.push(`<text x="${padL - 8}" y="${py + 4}" text-anchor="end" font-size="12" fill="#4b5563">${fmtChf(val, 0)}</text>`);
  }

  years.forEach((y, idx) => {
    const px = scaleX(idx);
    parts.push(`<line x1="${px}" y1="${padT}" x2="${px}" y2="${H - padB}" stroke="#e5e7eb" stroke-width="1" />`);
    parts.push(`<text x="${px}" y="${H - padB + 20}" text-anchor="middle" font-size="12" font-weight="600" fill="#4b5563">${y}</text>`);
  });

  topRows.forEach((r, rIdx) => {
    const color = HISTORY_LINE_COLORS[rIdx % HISTORY_LINE_COLORS.length];
    const pts = [];
    years.forEach((y, yIdx) => {
      const p = r.history?.[y]?.premium;
      if (p !== null && p !== undefined) {
        pts.push({ x: scaleX(yIdx), y: scaleY(p) });
      }
    });
    if (pts.length > 1) {
      parts.push(`<polyline fill="none" stroke="${color}" stroke-width="2.4" points="${pts.map(pt => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ")}" />`);
    }
    for (const pt of pts) {
      parts.push(`<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="3.5" fill="${color}" stroke="#fff" stroke-width="1.2" />`);
    }
  });

  svg.innerHTML = parts.join("");
  legendEl.innerHTML = topRows.map((r, rIdx) => {
    const color = HISTORY_LINE_COLORS[rIdx % HISTORY_LINE_COLORS.length];
    return `
      <span class="legend-item">
        <span class="legend-dot" style="background:${color}"></span>
        <span>${esc(r.insurer)} (${fmtSignedPct(r.avgIncreasePct)})</span>
      </span>
    `;
  }).join("");
}

function renderHistoryTable(historyRows, years) {
  const dict = I18N[state.lang] || I18N.zh;
  const thead = document.getElementById("history-thead");
  const tbody = document.getElementById("history-tbody");

  const q = state.searchQuery.trim().toLowerCase();
  const rows = historyRows.filter(r => !q || r.insurer.toLowerCase().includes(q));
  rows.sort((a, b) => (a.avgIncreasePct ?? 99) - (b.avgIncreasePct ?? 99));

  renderHistoryChart(rows, years);

  thead.innerHTML = `
    <tr>
      <th scope="col">${dict.thInsurer}</th>
      ${years.map(y => `<th scope="col" class="num-col">${y}</th>`).join("")}
      <th scope="col" class="num-col">${dict.th5YrAvg}</th>
    </tr>
  `;

  tbody.innerHTML = rows.map(r => {
    const yearCells = years.map(y => {
      const item = r.history?.[y];
      if (!item || item.premium === null) return `<td class="num-col" data-label="${y}">—</td>`;
      const pctColor = item.changePct > 6.5
        ? "var(--red-bad)"
        : (item.changePct < 0 ? "var(--green-good)" : "var(--text-muted)");
      const pctHtml = item.changePct !== null && item.changePct !== undefined
        ? `<div style="font-size:0.7rem;color:${pctColor}">${fmtSignedPct(item.changePct, 1)}</div>`
        : "";
      return `<td class="num-col" data-label="${y}"><div><strong>${fmtChf(item.premium)}</strong></div>${pctHtml}</td>`;
    }).join("");

    return `
      <tr>
        <th scope="row">${esc(r.insurer)}</th>
        ${yearCells}
        <td class="num-col" data-label="${dict.th5YrAvg}">${getTrendBadgeHtml(r.avgIncreasePct)}</td>
      </tr>
    `;
  }).join("");
}

function renderGuideTab() {
  const dict = I18N[state.lang] || I18N.zh;
  const g = dict.guide;
  const container = document.getElementById("guide-dynamic-container");
  if (!container || !g) return;

  container.innerHTML = `
    <div class="guide-banner">
      <span class="guide-kicker">${g.kicker}</span>
      <h2>${g.title}</h2>
      <p>${g.desc}</p>
    </div>
    <div class="guide-grid">
      ${g.cards.map(c => `
        <article class="guide-card ${c.highlight ? "highlight-guide-card" : ""}">
          <div class="guide-card-top">
            <span class="cat-tag ${c.cat === "RULE" ? "" : `cat-${c.cat}`}" ${c.cat === "RULE" ? 'style="background:#fef3c7;color:#b45309;"' : ""}>${c.badge}</span>
            <span class="discount-tag ${c.discountGreen ? "text-green" : ""}">${c.discount}</span>
          </div>
          <h3>${c.title}</h3>
          <p>${c.desc}</p>
          <ul class="guide-list">
            ${c.bullets.map(b => `<li>${b}</li>`).join("")}
          </ul>
        </article>
      `).join("")}
    </div>
  `;
}

function updateMobileCollapseLabel() {
  const dict = I18N[state.lang] || I18N.zh;
  const span = document.getElementById("mobile-filter-summary");
  const btn = document.getElementById("btn-toggle-filters");
  if (!span || !btn) return;
  if (state.mobileFiltersCollapsed) {
    const shortCity = (state.locationName || "").split(" ")[0];
    span.textContent = `${shortCity} · ${state.yob} · F${state.franchise} · ${dict.mobileCollapseClosed}`;
    btn.setAttribute("aria-expanded", "false");
  } else {
    span.textContent = dict.mobileCollapseOpen;
    btn.setAttribute("aria-expanded", "true");
  }
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

function exportRankingToCsv() {
  const enriched = getEnrichedPlans();
  const filtered = filterAndSortPlans(enriched);
  if (!filtered.length) return;

  const headers = [
    "Rank", "Insurer", "Plan", "Category",
    "MonthlyNet_CHF", "YearlyNet_CHF", "EstOutOfPocket_CHF",
    "TotalAnnualCost_CHF", "Avg5YrIncrease_Pct"
  ];
  const lines = [headers.join(",")];
  filtered.forEach((p, idx) => {
    const row = [
      idx + 1,
      `"${(p.insurer || "").replace(/"/g, '""')}"`,
      `"${(p.model || "").replace(/"/g, '""')}"`,
      p.modelCategory,
      (p.monthlyNet ?? 0).toFixed(2),
      (p.yearlyNet ?? 0).toFixed(2),
      (p.outOfPocket ?? 0).toFixed(2),
      (p.totalYearCost ?? 0).toFixed(2),
      p.avgIncreasePct !== null && p.avgIncreasePct !== undefined ? p.avgIncreasePct.toFixed(1) : ""
    ];
    lines.push(row.join(","));
  });

  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const citySlug = (state.locationName || "swiss").replace(/[^a-zA-Z0-9]+/g, "-");
  a.href = url;
  a.download = `priminfo-2027-${citySlug}-${state.yob}-F${state.franchise}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
    const { matches, totalCount } = searchLocations(query);
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
