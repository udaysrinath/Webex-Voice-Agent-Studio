import type { KbCard } from "../../server/webexone-kb-types";
import { extractFacts } from "./facts";
import { readDocument } from "./parse";
import { SOURCES } from "./units";

/**
 * Coverage audit: every concrete fact (time, date, price, phone, URL, room, quantity) found anywhere in a source
 * document must appear somewhere in the final cards. Anything missing is reported with the sentence it came from.
 */
export function coverageAudit(cards: KbCard[]): { report: string[]; missingTotal: number } {
  const have = extractFacts(cards.map((card) => card.text).join("\n"));
  const report: string[] = [];
  let missingTotal = 0;
  for (const source of SOURCES) {
    const { blocks } = readDocument(source.file);
    const sentences = blocks.flatMap((block) => block.text.split(/(?<=[.!?])\s+|\n+/));
    const missing = new Map<string, string>();
    for (const sentence of sentences) for (const fact of extractFacts(sentence)) if (!have.has(fact) && !missing.has(fact)) missing.set(fact, sentence.trim());
    // URLs with tracking parameters and bare navigation links are noise for a voice agent
    for (const fact of [...missing.keys()]) if (/^url:.*(utm_|\?|#)/.test(fact) || /^url:.*\.(jpg|png|svg|pdf)$/.test(fact)) missing.delete(fact);
    missingTotal += missing.size;
    report.push(`- ${source.file}: ${missing.size === 0 ? "all facts present" : `${missing.size} fact(s) not in any card`}`);
    for (const [fact, sentence] of [...missing].slice(0, 12)) report.push(`    - ${fact} ← “${sentence.slice(0, 140)}”`);
  }
  return { report, missingTotal };
}
