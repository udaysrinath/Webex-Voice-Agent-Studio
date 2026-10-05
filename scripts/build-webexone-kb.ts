// Builds the WebexOne knowledge base (server/data/webexone/kb) from every source:
//   Socio export (raw/socio.json)  → sessions, speakers, rooms, logistics   (structured, no LLM)
//   OneDrive documents + crawled site → consolidated, deduplicated answer cards (LLM, fact-checked)
// Usage: node --env-file=.env --import tsx scripts/build-webexone-kb.ts
import * as fs from "node:fs";
import * as path from "node:path";
import type { KbCard, KbFile, KbVectors } from "../server/webexone-kb-types";
import { consolidate } from "./kb/consolidate";
import { coverageAudit } from "./kb/audit";
import { buildTopicHubs } from "./kb/topics";
import { ALIAS_MODEL, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, embed, jsonCompletion } from "./kb/llm";
import { DATA_DIR, norm } from "./kb/parse";
import { buildStructuredCards } from "./kb/structured";
import { loadUnits } from "./kb/units";

const OUT = path.join(DATA_DIR, "kb");
const KB_VERSION = 3;

async function addQuestions(cards: KbCard[]): Promise<number> {
  const needing = cards.filter((card) => card.questions.length < 4);
  const batches: KbCard[][] = [];
  for (let i = 0; i < needing.length; i += 8) batches.push(needing.slice(i, i + 8));
  let added = 0;
  let next = 0;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      const out = await jsonCompletion<{ items?: Array<{ id: string; questions: string[] }> }>(
        ALIAS_MODEL,
        "For each knowledge card write 6-8 short, natural spoken questions an attendee at the WebexOne 2026 conference might ask that this card answers. Include casual phrasings and synonyms. Return JSON {\"items\":[{\"id\":\"...\",\"questions\":[\"...\"]}]} covering every card.",
        batch.map((card) => `id: ${card.id}\ntitle: ${card.title}\n${card.text.slice(0, 900)}`).join("\n\n---\n\n"),
        `questions ×${batch.length}`,
      );
      for (const item of out.items || []) {
        const card = batch.find((candidate) => candidate.id === item.id);
        if (card) { card.questions = [...new Set([...card.questions, ...(item.questions || []).map((q) => q.trim()).filter(Boolean)])]; added++; }
      }
    }
  }));
  return added;
}

/** "## Search Aliases" in the OneDrive speakers document: "Tom Brady: tom brady, brady, the goat". */
function applySearchAliases(cards: KbCard[]): number {
  const raw = fs.readFileSync(path.join(DATA_DIR, "onedrive/speakers-sessions-kb.md"), "utf8");
  const block = raw.match(/## Search Aliases\n([\s\S]*?)\n# /)?.[1] || "";
  let applied = 0;
  for (const line of block.split("\n")) {
    const match = line.match(/^(.+?):\s*(.+)$/);
    if (!match) continue;
    const aliases = match[2].split(",").map((alias) => alias.trim()).filter(Boolean);
    for (const card of cards) {
      if (norm(card.title) === norm(match[1]) || (card.kind !== "speaker" && card.text.toLowerCase().includes(match[1].toLowerCase()) && card.kind === "session" && /keynote/i.test(match[1]) === /keynote/i.test(card.title))) {
        card.aliases = [...new Set([...(card.aliases || []), ...aliases])];
        applied++;
      }
    }
  }
  return applied;
}

const f32 = (vector: Float32Array) => Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString("base64");

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required to build the knowledge base.");
  fs.mkdirSync(OUT, { recursive: true });
  const report: string[] = ["# WebexOne knowledge base build report", `Built ${new Date().toISOString()}`, ""];

  console.info("1/5 structured cards (Socio + training codes + speaker directory)");
  const structured = buildStructuredCards();
  report.push("## Structured data", ...structured.report.map((line) => `- ${line}`), "");

  console.info("2/5 prose units");
  const { units, guidance, report: unitReport } = loadUnits();
  report.push("## Prose sources", ...unitReport.map((line) => `- ${line}`), `- ${guidance.length} agent-instruction sections were set aside as guidance (kb/guidance.json), not facts.`, "");

  console.info("3/5 consolidating overlapping sources");
  const prose = await consolidate(units);
  report.push("## Consolidation", ...prose.report.map((line) => `- ${line}`), ...(prose.unresolved.length ? ["", "Restored after the LLM dropped a fact (nothing was lost):", ...prose.unresolved.map((line) => `- ${line}`)] : []), "");

  console.info("3b/5 topic hubs (one authoritative card per topic)");
  const precedenceByCard = new Map(prose.cards.map((card) => [card.id, Math.max(...card.sources.map((source) => (source === "socio" ? 95 : units.find((u) => u.source === source)?.precedence ?? 50)))]));
  // Only logistics content gets topic cards. Awards, sponsors and products are already one clean card per item.
  const LOGISTICS = new Set(["info", "activity", "faq"]);
  const eligible = prose.cards.filter((card) => LOGISTICS.has(card.kind));
  const passthrough = prose.cards.filter((card) => !LOGISTICS.has(card.kind));
  const topics = await buildTopicHubs(eligible, (card) => precedenceByCard.get(card.id) ?? 50);
  topics.cards.push(...passthrough);
  prose.conflicts.push(...topics.conflicts);
  report.push("## Topic hubs", ...topics.report.map((line) => `- ${line}`), "", "Topics by number of contributing cards:", ...topics.topics.slice(0, 40).map((topic) => `- ${topic.name} (${topic.cards})`), "");

  const cards = [...structured.cards, ...topics.cards];
  const ids = new Map<string, number>();
  for (const card of cards) { const n = (ids.get(card.id) || 0) + 1; ids.set(card.id, n); if (n > 1) card.id = `${card.id}-${n}`; }

  console.info("4/5 question aliases");
  const aliased = await addQuestions(cards);
  const aliasHits = applySearchAliases(cards);
  report.push("## Retrieval aids", `- Generated spoken-question aliases for ${aliased} cards; ${aliasHits} cards got Search Aliases from the speakers document.`, "");

  console.info("5/5 embeddings");
  // Each question alias is embedded on its own so a card is matched by its best single phrasing; blending them into
  // one vector made broad cards lose to narrow ones ("When is WebexOne?" ranked "What is WebexOne?" first).
  const questionTexts: string[] = [];
  const questionCard: number[] = [];
  cards.forEach((card, index) => {
    const phrases = new Set<string>([card.title, ...card.questions, ...(card.aliases || [])].map((phrase) => phrase.trim()).filter((phrase) => phrase.length > 1));
    for (const phrase of phrases) { questionTexts.push(phrase); questionCard.push(index); }
  });
  const textVectors = await embed(cards.map((card) => `${card.title}\n${card.text}`));
  const questionVectors = await embed(questionTexts);
  const quantised = new Int8Array(questionVectors.length * EMBEDDING_DIMENSIONS);
  questionVectors.forEach((vector, row) => vector.forEach((value, column) => { quantised[row * EMBEDDING_DIMENSIONS + column] = Math.max(-127, Math.min(127, Math.round(value * 127))); }));

  const audit = coverageAudit(cards);
  report.push("## Coverage audit (every fact in every source must be in some card)", ...audit.report, "");
  console.info(`Coverage audit: ${audit.missingTotal} source fact(s) not found in any card (see REPORT.md).`);

  const kb: KbFile = { version: KB_VERSION, builtAt: new Date().toISOString(), embeddingModel: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS, cards };
  const vectors: KbVectors = { version: KB_VERSION, dimensions: EMBEDDING_DIMENSIONS, text: textVectors.map(f32), questions: Buffer.from(quantised.buffer).toString("base64"), questionCard };
  fs.writeFileSync(path.join(OUT, "cards.json"), JSON.stringify(kb));
  fs.writeFileSync(path.join(OUT, "vectors.json"), JSON.stringify(vectors));
  fs.writeFileSync(path.join(OUT, "guidance.json"), JSON.stringify(guidance, null, 1));

  const byKind = new Map<string, number>();
  for (const card of cards) byKind.set(card.kind, (byKind.get(card.kind) || 0) + 1);
  report.push("## Result", `- ${cards.length} cards: ${[...byKind].map(([kind, count]) => `${kind} ${count}`).join(", ")}`, "", "## Conflicts between sources", "Where sources disagreed, the higher-precedence source was kept (Socio for schedule facts, then OneDrive documents, then the older website crawl). Review these.", "");
  for (const conflict of prose.conflicts) report.push(`- **${conflict.topic}** — kept: ${conflict.kept} | dropped: ${conflict.dropped} | why: ${conflict.reason} _(${conflict.sources.join(", ")})_`);
  fs.writeFileSync(path.join(OUT, "REPORT.md"), report.join("\n") + "\n");
  console.info(`Done: ${cards.length} cards → ${OUT}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; });
