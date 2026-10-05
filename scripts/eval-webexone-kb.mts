// Measures retrieval quality against server/data/webexone/kb/golden.json.
// Usage: node --env-file=.env --import tsx scripts/eval-webexone-kb.mts [old|new] [topK]
import * as fs from "node:fs";
import * as path from "node:path";

const impl = process.argv[2] || "new";
const topK = Number(process.argv[3]) || 5;
const goldenFile = process.env.EVAL_SET || "golden";
const golden = JSON.parse(fs.readFileSync(path.resolve(`server/data/webexone/kb/${goldenFile}.json`), "utf8")) as { cases: Array<{ id: string; question: string; all: string[][] }> };

async function retrieve(question: string): Promise<string> {
  if (impl === "old") return (await import("../server/webexone-knowledge")).findWebexOneExcerpts(question, topK);
  return (await import("../server/webexone-kb")).retrieveWebexOne(question, { limit: topK }).then((result) => result.text);
}

let passed = 0;
const failures: string[] = [];
for (const testCase of golden.cases) {
  const text = (await retrieve(testCase.question)).toLowerCase();
  const missing = testCase.all.filter((group) => !group.some((alternative) => text.includes(alternative.toLowerCase())));
  if (!missing.length) passed++;
  else failures.push(`${testCase.id} ${testCase.question}\n      missing: ${missing.map((group) => group.join(" | ")).join("  &&  ")}`);
}
console.log(`\n[${impl}] top-${topK}: ${passed}/${golden.cases.length} passed (${((passed / golden.cases.length) * 100).toFixed(0)}%)`);
if (failures.length) console.log(`\nFailures:\n  ${failures.join("\n  ")}`);
if (process.env.EVAL_MIN_PASS && passed / golden.cases.length < Number(process.env.EVAL_MIN_PASS)) process.exitCode = 1;
