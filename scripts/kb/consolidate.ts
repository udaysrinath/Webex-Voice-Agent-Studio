import type { CardKind, KbCard } from "../../server/webexone-kb-types";
import { extractFacts, missingFacts } from "./facts";
import { BUILD_MODEL, cosine, embed, jsonCompletion } from "./llm";
import type { Unit } from "./units";

export interface Conflict { topic: string; kept: string; dropped: string; reason: string; sources: string[] }
export interface ConsolidationResult { cards: KbCard[]; conflicts: Conflict[]; report: string[]; unresolved: string[] }

const JOIN_THRESHOLD = 0.8;
const MAX_CLUSTER = 6;
const EXACT_THRESHOLD = 0.985;

const compatible = (a: Unit, b: Unit) => {
  if (a.kind === "product" || b.kind === "product") return a.kind === b.kind;
  if (a.kind === "sponsor" || b.kind === "sponsor") return a.kind === b.kind;
  if (a.kind === "award" || b.kind === "award") return a.kind === b.kind;
  return true;
};

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const sourceLabel = (unit: Unit) => unit.source === "socio" ? "socio (official event platform, exported Oct 2)" : unit.source.startsWith("onedrive/") ? `${unit.source} (curated document, Oct 1)` : `${unit.source} (older website crawl)`;

const SYSTEM = `You maintain the knowledge base behind a voice concierge for WebexOne 2026 (Cisco's conference, Fairmont Austin, October 5-8, 2026; all times Central).
You receive source passages that overlap, repeat, or partly disagree. Write the smallest set of self-contained answer cards that together keep every fact.

Rules:
1. Keep EVERY concrete fact: names, dates, times, rooms and levels, prices, phone numbers, emails, URLs, policies, quantities, eligibility ("Training Pass holders only"). Never invent or generalise.
2. Remove duplication and marketing filler. Do not write instructions to an agent. No markdown headings; short sentences or "- " bullets.
3. Keep place and time together in the same card, and keep who-it-applies-to attached to each fact (for example training attendees versus everyone).
4. If sources conflict, keep the version from the source with the higher precedence, except that session/activity times and rooms come from "socio" over every other source. Record each conflict.
5. If the passages cover different topics, return several cards. One topic per card, at most about 1500 characters each.
6. For every card write 6-10 natural spoken questions an attendee might ask that this card answers (include casual phrasings and synonyms, e.g. "where do I eat" for a meals card).
7. Card "kind" must be one of: faq, info, activity, award, sponsor, product.
Return JSON: {"cards":[{"title":"...","kind":"...","text":"...","questions":["..."]}],"conflicts":[{"topic":"...","kept":"...","dropped":"...","reason":"..."}]}`;

interface LlmOutput { cards?: Array<{ title: string; kind: string; text: string; questions?: string[] }>; conflicts?: Array<{ topic: string; kept: string; dropped: string; reason: string }> }

function userPrompt(members: Unit[], extra = ""): string {
  return `${members.map((unit, index) => `### Passage ${index + 1} — source: ${sourceLabel(unit)} — precedence ${unit.precedence}\n${unit.text}`).join("\n\n")}${extra ? `\n\n${extra}` : ""}`;
}

async function mergeCluster(members: Unit[], label: string): Promise<{ cards: KbCard[]; conflicts: Conflict[]; unresolved: string[] }> {
  const sources = [...new Set(members.map((unit) => unit.source))];
  const inputs = members.map((unit) => unit.text);
  let output = await jsonCompletion<LlmOutput>(BUILD_MODEL, SYSTEM, userPrompt(members), label);
  const droppedText = () => (output.conflicts || []).map((c) => `${c.dropped} ${c.reason}`).join(" ");
  const gaps = () => missingFacts(inputs, `${(output.cards || []).map((card) => card.text).join("\n")}\n${droppedText()}`);
  let missing = gaps();
  if (missing.length) {
    output = await jsonCompletion<LlmOutput>(BUILD_MODEL, SYSTEM, userPrompt(members, `Your previous answer omitted these details, which appear in the passages: ${missing.join(", ")}. Return the full JSON again with every one of them included (or recorded in "conflicts" if a higher-precedence source contradicts it).`), `${label} retry`);
    missing = gaps();
  }
  const unresolved: string[] = [];
  const cards: KbCard[] = (output.cards || []).filter((card) => card.text?.trim()).map((card, index) => ({
    id: `${slug(card.title || members[0].key)}-${members[0].id.replace(/[^a-z0-9]+/gi, "-")}${index ? `-${index}` : ""}`,
    kind: (["faq", "info", "activity", "award", "sponsor", "product"].includes(card.kind) ? card.kind : members[0].kind) as CardKind,
    title: card.title.trim(), text: card.text.trim(), questions: [...new Set((card.questions || []).map((q) => q.trim()).filter(Boolean))], sources,
  }));
  if (missing.length && cards.length) {
    // Never lose a fact: attach the original sentences that carry them to the closest card.
    const sentences = inputs.flatMap((text) => text.split(/(?<=[.!?])\s+|\n+/)).filter((sentence) => [...extractFacts(sentence)].some((fact) => missing.includes(fact)));
    cards[0].text += `\nAdditional details from the sources: ${[...new Set(sentences.map((s) => s.trim()))].join(" ")}`;
    unresolved.push(`${label}: restored from sources after LLM dropped ${missing.join(", ")}`);
  }
  if (!cards.length) { // LLM returned nothing usable: keep the sources verbatim
    for (const unit of members) cards.push({ id: `${slug(unit.key)}-${unit.id.replace(/[^a-z0-9]+/gi, "-")}`, kind: unit.kind, title: unit.key.slice(0, 120), text: unit.text, questions: [], sources: [unit.source] });
    unresolved.push(`${label}: LLM returned no cards; sources kept verbatim`);
  }
  const conflicts: Conflict[] = (output.conflicts || []).map((c) => ({ ...c, sources }));
  return { cards, conflicts, unresolved };
}

async function mapLimit<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await work(items[index], index); }
  }));
  return results;
}

export async function consolidate(units: Unit[]): Promise<ConsolidationResult> {
  const report: string[] = [];
  const ordered = [...units].sort((a, b) => b.precedence - a.precedence || a.id.localeCompare(b.id));
  const vectors = await embed(ordered.map((unit) => `${unit.key}\n${unit.text.slice(0, 700)}`));

  // 1. exact duplicates across sources: keep the higher-precedence text, never drop a fact it lacks
  const dropped = new Set<number>();
  const absorbed = new Map<number, number[]>();
  for (let i = 0; i < ordered.length; i++) {
    if (dropped.has(i)) continue;
    for (let j = i + 1; j < ordered.length; j++) {
      if (dropped.has(j) || ordered[i].source === ordered[j].source || !compatible(ordered[i], ordered[j])) continue;
      if (cosine(vectors[i], vectors[j]) < EXACT_THRESHOLD) continue;
      if (missingFacts([ordered[j].text], ordered[i].text).length) continue;
      dropped.add(j);
      absorbed.set(i, [...(absorbed.get(i) || []), j]);
    }
  }
  report.push(`Exact duplicates removed: ${dropped.size} (lower-precedence copy dropped, no fact lost).`);

  // 2. cluster what overlaps without being identical
  const clusters: number[][] = [];
  for (let i = 0; i < ordered.length; i++) {
    if (dropped.has(i)) continue;
    let target = -1, best = JOIN_THRESHOLD;
    clusters.forEach((cluster, index) => {
      if (cluster.length >= MAX_CLUSTER || !cluster.every((member) => compatible(ordered[member], ordered[i]))) return;
      const score = Math.max(...cluster.map((member) => cosine(vectors[member], vectors[i])));
      if (score >= best && cluster.some((member) => ordered[member].source !== ordered[i].source || ordered[member].source === "socio")) { best = score; target = index; }
    });
    if (target >= 0) clusters[target].push(i); else clusters.push([i]);
  }
  const multi = clusters.filter((cluster) => cluster.length > 1);
  report.push(`Clusters: ${clusters.length} (${multi.length} multi-source merges, ${clusters.length - multi.length} single).`);

  const cards: KbCard[] = [];
  const conflicts: Conflict[] = [];
  const unresolved: string[] = [];
  const results = await mapLimit(clusters, 6, async (cluster, index) => {
    const members = cluster.map((i) => ordered[i]);
    const extraSources = cluster.flatMap((i) => (absorbed.get(i) || []).map((j) => ordered[j].source));
    const merged = members.length === 1 && members[0].verbatim && !extraSources.length
      ? { cards: [{ id: `${slug(members[0].key)}-${members[0].id.replace(/[^a-z0-9]+/gi, "-")}`, kind: members[0].kind, title: members[0].key.slice(0, 120), text: members[0].text.replace(/^Q:\s*/, "").replace(/\nA:\s*/, "\n"), questions: [], sources: [members[0].source] } satisfies KbCard], conflicts: [] as Conflict[], unresolved: [] as string[] }
      : await mergeCluster(members, `cluster ${index + 1}/${clusters.length} «${members[0].key.slice(0, 40)}»`);
    // attach provenance of absorbed exact duplicates
    for (const card of merged.cards) card.sources = [...new Set([...card.sources, ...extraSources])];
    return merged;
  });
  for (const result of results) { cards.push(...result.cards); conflicts.push(...result.conflicts); unresolved.push(...result.unresolved); }
  report.push(`Prose cards: ${cards.length}; conflicts recorded: ${conflicts.length}; facts restored after LLM drop: ${unresolved.length}.`);
  return { cards, conflicts, report, unresolved };
}
