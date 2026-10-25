import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSearchStr, buildLocationIndex, searchLocations } from "../../static/js/location-search.js";

const index = buildLocationIndex({
  1: "8001 Zürich",
  2: "8002 Zürich",
  3: "8400 Winterthur",
  4: "3011 Bern",
  5: "3007 Bern (Gemeinde Köniz)",
  6: "1201 Genève"
});
const ids = (query) => searchLocations(index, query).matches.map(m => m.id);

test("normalizeSearchStr: case, umlauts (both spellings), accents, ß and outer spaces", () => {
  assert.equal(normalizeSearchStr("Zürich"), "zurich");
  assert.equal(normalizeSearchStr("ZUERICH"), "zurich");
  assert.equal(normalizeSearchStr("Genève"), "geneve");
  assert.equal(normalizeSearchStr("Straße"), "strasse");
  assert.equal(normalizeSearchStr("  Bern "), "bern");
  assert.equal(normalizeSearchStr(null), "");
});

test("buildLocationIndex: splits off the PLZ and indexes normalized words", () => {
  const [zh] = buildLocationIndex({ 1: "8001 Zürich" });
  assert.deepEqual(zh, { id: "1", name: "8001 Zürich", plz: "8001", cityOnly: "zurich", normFull: "8001 zurich", words: ["8001", "zurich"] });
  const [noPlz] = buildLocationIndex({ 9: "Zürich" });
  assert.equal(noPlz.plz, "");
  assert.equal(noPlz.cityOnly, "zurich");
});

test("searchLocations: an exact PLZ ranks above the same digits elsewhere in the name", () => {
  const idx = buildLocationIndex({ 1: "8001 Zürich", 7: "Postfach 8001 Zürich" });
  assert.deepEqual(searchLocations(idx, "8001").matches.map(m => m.id), ["1", "7"]);
});

test("searchLocations: city names match without umlauts; ties sort by name", () => {
  assert.deepEqual(ids("zurich"), ["1", "2"]);
  assert.deepEqual(ids("Zuerich"), ["1", "2"]);
  assert.deepEqual(ids("gen"), ["6"]);
});

test("searchLocations: every query word must match", () => {
  assert.deepEqual(ids("bern koniz"), ["5"]);
  assert.deepEqual(ids("bern"), ["4", "5"]);
});

test("searchLocations: empty query, empty index or no match return nothing", () => {
  const none = { matches: [], totalCount: 0 };
  assert.deepEqual(searchLocations(index, "   "), none);
  assert.deepEqual(searchLocations([], "bern"), none);
  assert.deepEqual(searchLocations(index, "zzzz"), none);
});

test("searchLocations: returns at most 15 matches but counts them all", () => {
  const many = buildLocationIndex(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i, `${8100 + i} Testdorf`])));
  const res = searchLocations(many, "testdorf");
  assert.equal(res.matches.length, 15);
  assert.equal(res.totalCount, 20);
});
