import { RETAIL_STORE_ASSISTANT_USE_CASE } from "./shared/use-cases";

const catalog = RETAIL_STORE_ASSISTANT_USE_CASE.inventory;

function normStr(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function lookupFastPath(query: string): string {
  const q = query.toLowerCase();
  const matched = catalog.find((item) => {
    const nameLower = item.name.toLowerCase();
    const catLower = item.category.toLowerCase();
    const skuLower = item.sku.toLowerCase();

    // Fast path: whole-word regex on category, substring on name/sku
    const fastPathRegex = new RegExp(`\\b${q.replace(/[^a-z0-9\s]/g, " ").trim().replace(/\s+/g, "\\b.*\\b")}\\b`);
    if (nameLower.includes(q) || fastPathRegex.test(catLower) || skuLower.includes(q) || q.includes(nameLower)) {
      return true;
    }

    // Word-overlap path
    const queryWords = q
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !/^(\d+(st|nd|rd|th|gb|tb|mm|inch)?|generation|model|new|the|and|for|with)$/.test(w));

    if (queryWords.length >= 2) {
      const hits = queryWords.filter((w) => {
        const r = new RegExp(`\\b${w}\\b`);
        return r.test(nameLower) || r.test(skuLower) || r.test(catLower);
      });
      return hits.length >= Math.min(2, queryWords.length);
    }
    return queryWords.length === 1 && (new RegExp(`\\b${queryWords[0]}\\b`).test(nameLower) || new RegExp(`\\b${queryWords[0]}\\b`).test(skuLower));
  });
  return matched ? matched.name : "No match";
}

function reserveItemMatch(query: string): string {
  const q = query.toLowerCase();
  const qNorm = normStr(query);
  const matched = catalog.find((item) => {
    const nameLower = item.name.toLowerCase();
    const nameNorm = normStr(item.name);
    const skuLower = item.sku.toLowerCase();
    // NOTE: queryNorm.includes(nameNorm) intentionally removed — prevents accessory queries matching parent product
    return skuLower === q || nameLower === q || nameNorm === qNorm || nameNorm.includes(qNorm);
  });
  return matched ? matched.name : "No match";
}

type TestCase = { query: string; expectedContains: string; fn: (q: string) => string; label: string };

const tests: TestCase[] = [
  { label: "lookup",  query: "pro",                            expectedContains: "iPad Pro",                   fn: lookupFastPath }, // ambiguous single word — first "pro" match in catalog is iPad Pro
  { label: "lookup",  query: "iphone",                         expectedContains: "iPhone 16 Pro Max",          fn: lookupFastPath },
  { label: "lookup",  query: "iphone 16 pro max",              expectedContains: "iPhone 16 Pro Max",          fn: lookupFastPath },
  { label: "lookup",  query: "samsung galaxy s25",             expectedContains: "Samsung Galaxy S25+",        fn: lookupFastPath },
  { label: "lookup",  query: "airpods",                        expectedContains: "AirPods Pro",                fn: lookupFastPath },
  { label: "lookup",  query: "macbook air",                    expectedContains: "MacBook Air",                fn: lookupFastPath },
  { label: "lookup",  query: "phone",                          expectedContains: "Samsung Galaxy S25+",        fn: lookupFastPath },
  { label: "reserve", query: "iphone 16 pro max",              expectedContains: "iPhone 16 Pro Max",          fn: reserveItemMatch },
  { label: "reserve", query: "iphone 16 pro max 256gb natural titanium", expectedContains: "iPhone 16 Pro Max", fn: reserveItemMatch },
  { label: "reserve", query: "samsung galaxy s25+",            expectedContains: "Samsung Galaxy S25+",        fn: reserveItemMatch },
  { label: "reserve", query: "apple watch series 9",           expectedContains: "Apple Watch",                fn: reserveItemMatch },
  { label: "reserve", query: "nintendo switch 2",              expectedContains: "Nintendo Switch 2",          fn: reserveItemMatch },
  // Regression: accessory query should NOT match the parent product
  { label: "reserve", query: "carrying case for nintendo switch 2",   expectedContains: "Carrying Case for Nintendo Switch 2", fn: reserveItemMatch },
  { label: "reserve", query: "sport band for apple watch midnight",    expectedContains: "Sport Band for Apple Watch",          fn: reserveItemMatch },
  { label: "reserve", query: "spare battery pack for dji mini 4 pro", expectedContains: "Spare Battery Pack for DJI Mini 4 Pro", fn: reserveItemMatch },
  // Regression: partial-category query should not cause wrong lookup match
  { label: "lookup",  query: "foam ear tips sony linkbuds",           expectedContains: "Sony LinkBuds",          fn: lookupFastPath },
  { label: "lookup",  query: "airpods pro 2nd generation",            expectedContains: "AirPods Pro",             fn: lookupFastPath },
];

let pass = 0;
let fail = 0;

for (const t of tests) {
  const result = t.fn(t.query);
  const ok = result.toLowerCase().includes(t.expectedContains.toLowerCase());
  const status = ok ? "✓ PASS" : "✗ FAIL";
  if (ok) pass++; else fail++;
  console.log(`${status} [${t.label}] "${t.query}" → "${result}" (expected to contain: "${t.expectedContains}")`);
}

console.log(`\n${pass} passed, ${fail} failed`);
