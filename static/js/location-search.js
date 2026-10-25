// Swiss PLZ / place-name search over the /api/locations names (pure: the index is passed in)

export function normalizeSearchStr(str) {
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

export function buildLocationIndex(names) {
  return Object.entries(names).map(([id, name]) => {
    const normFull = normalizeSearchStr(name);
    const plzMatch = name.match(/^(\d{4})\s+(.*)$/);
    const plz = plzMatch ? plzMatch[1] : "";
    const cityOnly = plzMatch ? normalizeSearchStr(plzMatch[2]) : normFull;
    const words = normFull.split(/[\s,()/-]+/).filter(Boolean);
    return { id, name, plz, cityOnly, normFull, words };
  });
}

export function searchLocations(index, query) {
  if (!index.length || !query.trim()) {
    return { matches: [], totalCount: 0 };
  }
  const qNorm = normalizeSearchStr(query);
  const qWords = qNorm.split(/[\s,]+/).filter(Boolean);
  if (qWords.length === 0) return { matches: [], totalCount: 0 };

  const scored = [];

  for (const loc of index) {
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
