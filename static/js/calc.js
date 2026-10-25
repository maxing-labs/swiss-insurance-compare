// Pure premium/cost calculations: no DOM, no app state, everything comes in as arguments.

export function calcOutOfPocket(medicalBills, franchise, isKid) {
  const maxSelbstbehalt = isKid ? 350 : 700;
  const partFranchise = Math.min(medicalBills, franchise);
  const remaining = Math.max(0, medicalBills - partFranchise);
  const partSelbstbehalt = Math.min(remaining * 0.1, maxSelbstbehalt);
  return partFranchise + partSelbstbehalt;
}

// Adds the out-of-pocket cost and yearly total at the selected franchise, plus the cheapest franchise at medicalCost
export function enrichPlans(plans, { medicalCost, franchise, isKid, rebate, franchises }) {
  const outOfPocketSelected = calcOutOfPocket(medicalCost, franchise, isKid);

  return plans.map((p, originalIdx) => {
    const totalYearCost = (p.yearlyNet || 0) + outOfPocketSelected;

    let bestFranchiseForPlan = franchise;
    let minTotalForPlan = totalYearCost;

    for (const f of franchises) {
      const grossMonthly = p.matrixPrices?.[String(f)];
      if (grossMonthly !== null && grossMonthly !== undefined) {
        const netYearly = Math.max(0, (grossMonthly - rebate) * 12);
        const oop = calcOutOfPocket(medicalCost, f, isKid);
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

// One cost curve per franchise the plan offers: yearly outlay at each x in xPoints and at medicalCost
export function buildCurveSeries(plan, { franchises, rebate, isKid, medicalCost, xPoints }) {
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
    const cursorOop = calcOutOfPocket(medicalCost, f, isKid);
    const cursorTotal = netYearly + cursorOop;
    seriesList.push({
      franchise: f,
      netMonthly,
      netYearly,
      points,
      cursorOop,
      cursorTotal
    });
  }
  return seriesList;
}

// First medical bill (CHF 10 steps, up to maxX) at which lowS costs no more than highS; null if never
export function findCrossover(lowS, highS, isKid, maxX) {
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
  return crossoverX;
}

// Ascending sort comparator; null / undefined (a plan without a premium) sorts after every number
export function ascNullsLast(a, b) {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull || bNull) return aNull - bNull;
  return a - b;
}

export function buildInsurerMinMap(plans) {
  const map = {};
  for (const p of plans || []) {
    if (p.monthlyNet === null || p.monthlyNet === undefined) continue;
    if (map[p.insurer] === undefined || p.monthlyNet < map[p.insurer].monthlyNet) {
      map[p.insurer] = { monthlyNet: p.monthlyNet, model: p.model };
    }
  }
  return map;
}

// Insurers offered to every profile that has an insurerMinMap, by combined monthly premium; [] below 2 profiles
export function familyBundleTop5(profiles) {
  const readyProfiles = profiles.filter(p => p.insurerMinMap && Object.keys(p.insurerMinMap).length > 0);
  if (readyProfiles.length < 2) return [];
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
  return commonTotals.slice(0, 5);
}
