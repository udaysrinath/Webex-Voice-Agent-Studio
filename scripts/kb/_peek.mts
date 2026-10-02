import { retrieveWebexOne } from "../../server/webexone-kb";
for (const q of process.argv.slice(2)) { const r = await retrieveWebexOne(q, { limit: 6 }); console.log("\n### " + q); r.cards.forEach((c) => console.log(`  ${c.score.toFixed(4)} [${c.kind}] ${c.title.slice(0, 80)}`)); }
