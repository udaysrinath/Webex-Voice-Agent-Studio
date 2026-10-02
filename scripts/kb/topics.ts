import type { CardKind, KbCard } from "../../server/webexone-kb-types";
import type { Conflict } from "./consolidate";
import { extractFacts } from "./facts";
import { BUILD_MODEL, cosine, embed, jsonCompletion } from "./llm";

/**
 * Second consolidation level. The first pass merges overlapping passages, but one subject (Capture the Flag, lunch,
 * registration) can still be spread over several cards, one of which carries the room while another carries the
 * audience. Here the LLM names the topics people ask about, tags every card with the topics it states facts about,
 * and writes ONE authoritative card per topic from all of them. Every merge is fact-checked against its inputs.
 */
export interface TopicResult { cards: KbCard[]; conflicts: Conflict[]; report: string[]; topics: Array<{ name: string; description: string; cards: number }> }

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const KINDS: CardKind[] = ["faq", "info", "activity", "award", "sponsor", "product"];
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n)}…` : text);

async function mapLimit<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await work(items[i], i); } }));
  return out;
}

const TAXONOMY_SYSTEM = `You organise the knowledge base of a voice concierge for WebexOne 2026 (Cisco's conference, Fairmont Austin, Oct 5-8, 2026).
From card titles and snippets, define the canonical topics attendees ask about. Each topic is a specific subject someone could ask a question about: a place, program, activity, policy, service, product, award, sponsor tier, travel or hotel matter.
Topics must be NARROW: one subject that a single card of about 1500 characters could answer completely. Good: "Breakfast and lunch", "Registration desk hours and location", "Wi-Fi access", "Parking at the Fairmont", "Capture the Flag", "Opening Reception", "Evening Celebration", "Professional headshots", "First aid and EMT", "Airport transportation", "Hotel room block and overflow hotels", "Technical Training agenda builder", "Training attendance and waitlist policy".
Bad (too broad or vague): "Technical Training Program", "WebexOne dates and location", "Agenda and schedule", "General information", "Miscellaneous", "Things to do". Meals, registration, receptions and each activation are separate topics. Prefer 150-250 narrow topics. Return JSON {"topics":[{"name":"...","description":"one line"}]}.`;

const TAG_SYSTEM = `You tag knowledge cards for a conference concierge. Given a topic list and some cards, list for each card EVERY topic from the list that the card states concrete facts about (a time, place, price, rule, contact, description). A daily schedule card may touch many topics: list them all (at most 8). Use topic names exactly as written in the list. Only if a fact-bearing card fits nothing, add a short new topic name. Return JSON {"items":[{"id":"...","topics":["..."]}]}.`;

const HUB_SYSTEM = `You write the authoritative knowledge card(s) for ONE topic of a voice concierge for WebexOne 2026 (Cisco's conference, Fairmont Austin, Oct 5-8, 2026; times are Central).
You receive passages from several cards. Use ONLY facts that concern the topic; ignore other topics in the same passage.
Rules:
1. Keep EVERY fact about the topic: names, dates, times, rooms and levels, prices, phone numbers, URLs, eligibility, quantities. Never invent or generalise.
2. Merge duplicates into one clear statement. Keep who-it-applies-to (for example Training Pass holders only versus all attendees) attached to each fact, and keep place and time together, per day when days differ.
3. Conflicts: prefer the higher-precedence source; session/activity times and rooms come from "socio" over everything else. Record each conflict.
4. Plain text, short sentences or "- " bullets, no markdown headings, no agent instructions or marketing filler.
5. One card if it fits in about 1500 characters. If the topic has clearly separate aspects (for example registration hours versus registration fees), return several cards titled "Topic — aspect".
6. For each card write 8-12 natural spoken questions attendees might ask (casual phrasing and synonyms) that the card answers.
Return JSON {"cards":[{"title":"...","kind":"faq|info|activity|award|sponsor|product","text":"...","questions":["..."]}],"conflicts":[{"topic":"...","kept":"...","dropped":"...","reason":"..."}]}.`;

interface HubOut { cards?: Array<{ title: string; kind: string; text: string; questions?: string[] }>; conflicts?: Array<{ topic: string; kept: string; dropped: string; reason: string }> }


export async function buildTopicHubs(prose: KbCard[], precedenceOf: (card: KbCard) => number): Promise<TopicResult> {
  const report: string[] = [];
  const conflicts: Conflict[] = [];

  // 1. taxonomy
  const listing = prose.map((card) => `${card.id} | ${card.title} | ${clip(card.text.replace(/\s+/g, " "), 150)}`).join("\n");
  const taxonomy = await jsonCompletion<{ topics?: Array<{ name: string; description: string }> }>(BUILD_MODEL, TAXONOMY_SYSTEM, listing, "taxonomy");
  const topics = new Map<string, { name: string; description: string }>();
  for (const topic of taxonomy.topics || []) if (topic.name?.trim()) topics.set(topic.name.trim().toLowerCase(), { name: topic.name.trim(), description: topic.description || "" });
  report.push(`Topic taxonomy: ${topics.size} topics.`);

  // 2. tag every card with the topics it states facts about
  const vocabulary = () => [...topics.values()].map((topic) => `- ${topic.name}: ${topic.description}`).join("\n");
  const batches: KbCard[][] = [];
  for (let i = 0; i < prose.length; i += 12) batches.push(prose.slice(i, i + 12));
  const vocab = vocabulary();
  const tags = new Map<string, string[]>();
  await mapLimit(batches, 5, async (batch, index) => {
    const out = await jsonCompletion<{ items?: Array<{ id: string; topics: string[] }> }>(
      BUILD_MODEL, TAG_SYSTEM,
      `Topics:\n${vocab}\n\nCards:\n${batch.map((card) => `### id: ${card.id}\ntitle: ${card.title}\n${clip(card.text, 1800)}`).join("\n\n")}`,
      `tag ${index + 1}/${batches.length}`,
    );
    for (const item of out.items || []) tags.set(item.id, (item.topics || []).map((topic) => topic.trim()).filter(Boolean));
  });
  const canonical = new Map<string, string>();
  for (const topic of topics.values()) canonical.set(topic.name.toLowerCase(), topic.name);
  const cardTopics = new Map<string, string[]>();
  for (const card of prose) {
    const names = [...new Set((tags.get(card.id) || []).map((name) => { const known = canonical.get(name.toLowerCase()); if (!known) { canonical.set(name.toLowerCase(), name); topics.set(name.toLowerCase(), { name, description: "" }); } return canonical.get(name.toLowerCase())!; }))];
    cardTopics.set(card.id, names);
  }
  // Overlapping topic names would produce overlapping cards. Merge only near-identical names (strict embedding match),
  // keeping the topic with the most cards as the canonical one, so distinct subjects are never folded together.
  const counts = new Map<string, number>();
  for (const names of cardTopics.values()) for (const name of names) counts.set(name, (counts.get(name) || 0) + 1);
  const names = [...counts.keys()].sort((a, b) => (counts.get(b)! - counts.get(a)!) || a.localeCompare(b));
  const nameVectors = await embed(names.map((name) => `${name}: ${topics.get(name.toLowerCase())?.description || ""}`));
  const remap = new Map<string, string>();
  const canonicalIndex: number[] = [];
  names.forEach((name, i) => {
    const match = canonicalIndex.find((j) => cosine(nameVectors[i], nameVectors[j]) >= 0.9);
    if (match !== undefined) remap.set(name, names[match]); else canonicalIndex.push(i);
  });
  for (const [id, list] of cardTopics) cardTopics.set(id, [...new Set(list.map((name) => remap.get(name) || name))]);
  report.push(`Topic names: ${names.length} → ${canonicalIndex.length} after merging near-identical ones (${[...remap].slice(0, 8).map(([from, to]) => `“${from}” → “${to}”`).join("; ")}).`);
  const groups = new Map<string, KbCard[]>();
  for (const card of prose) for (const name of cardTopics.get(card.id) || []) groups.set(name, [...(groups.get(name) || []), card]);

  // 3. one authoritative card per topic with several contributing cards
  const MAX_HUB_INPUT = 14;
  const hubTopics = [...groups].filter(([, cards]) => cards.length >= 2 && cards.length <= MAX_HUB_INPUT);
  const tooBroad = [...groups].filter(([, cards]) => cards.length > MAX_HUB_INPUT).map(([name, cards]) => `${name} (${cards.length})`);
  if (tooBroad.length) report.push(`Topics too broad for one card (left as individual cards): ${tooBroad.join(", ")}.`);
  report.push(`Tagging: ${prose.length - [...cardTopics.values()].filter((t) => !t.length).length}/${prose.length} cards tagged; ${hubTopics.length} topics have two or more cards.`);
  const unresolved: string[] = [];
  const hubCards: KbCard[] = [];
  const hubsByTopic = new Map<string, KbCard[]>();
  await mapLimit(hubTopics, 5, async ([name, members], index) => {
    const ordered = [...members].sort((a, b) => precedenceOf(b) - precedenceOf(a)).slice(0, MAX_HUB_INPUT);
    const description = topics.get(name.toLowerCase())?.description || "";
    const prompt = `Topic: ${name}${description ? ` — ${description}` : ""}\n\n${ordered.map((card, i) => `### Passage ${i + 1} — card "${card.title}" — sources: ${card.sources.join(", ")} — precedence ${precedenceOf(card)}\n${card.text}`).join("\n\n")}`;
    const label = `hub ${index + 1}/${hubTopics.length} «${name.slice(0, 40)}»`;
    let out = await jsonCompletion<HubOut>(BUILD_MODEL, HUB_SYSTEM, prompt, label);
    const droppedText = () => (out.conflicts || []).map((c) => `${c.dropped} ${c.reason}`).join(" ");
    const outputText = () => `${(out.cards || []).map((card) => card.text).join("\n")}\n${droppedText()}`;
    // A hub may omit facts (a card is only dropped later if EVERY fact in it is covered), but it may never invent one.
    const invented = () => [...extractFacts((out.cards || []).map((card) => card.text).join("\n"))].filter((fact) => !extractFacts(ordered.map((card) => card.text).join("\n")).has(fact));
    let problems = invented().map((fact) => `unsupported:${fact}`);
    if (problems.length) {
      out = await jsonCompletion<HubOut>(BUILD_MODEL, HUB_SYSTEM, `${prompt}\n\nYour previous answer contains details that are not in the passages and must be removed: ${problems.join(", ")}. Return the full JSON again.`, `${label} retry`);
      problems = invented().map((fact) => `unsupported:${fact}`);
    }
    const cards: KbCard[] = (out.cards || []).filter((card) => card.text?.trim()).map((card, i) => ({
      id: `topic-${slug(card.title || name)}${i ? `-${i}` : ""}`,
      kind: (KINDS.includes(card.kind as CardKind) ? card.kind : "info") as CardKind,
      title: card.title.trim(), text: card.text.trim(), questions: [...new Set((card.questions || []).map((q) => q.trim()).filter(Boolean))],
      sources: [...new Set(ordered.flatMap((member) => member.sources))], aliases: [name],
    }));
    if (!cards.length || problems.length) {
      unresolved.push(`${name}: hub rejected (${problems.slice(0, 4).join(", ")}); original cards kept`);
      return;
    }
    hubsByTopic.set(name, cards);
    hubCards.push(...cards);
    for (const c of out.conflicts || []) conflicts.push({ ...c, sources: [...new Set(ordered.flatMap((member) => member.sources))] });
  });
  report.push(`Topic hubs written: ${hubsByTopic.size} topics → ${hubCards.length} cards; conflicts recorded: ${conflicts.length}.`);

  // 4. drop cards whose every fact now lives in a hub (they would only duplicate it)
  const hubFacts = new Map<string, Set<string>>();
  for (const [name, cards] of hubsByTopic) hubFacts.set(name, extractFacts(cards.map((card) => card.text).join("\n")));
  const kept: KbCard[] = [];
  const dropped: string[] = [];
  for (const card of prose) {
    const names = (cardTopics.get(card.id) || []).filter((name) => hubsByTopic.has(name));
    const covered = new Set(names.flatMap((name) => [...(hubFacts.get(name) || [])]));
    const own = extractFacts(card.text);
    const subsumed = names.length > 0 && names.length === (cardTopics.get(card.id) || []).length && names.length <= 2 && [...own].every((fact) => covered.has(fact));
    if (subsumed) dropped.push(card.title); else kept.push(card);
  }
  report.push(`Cards fully covered by a topic card and dropped as duplicates: ${dropped.length}; kept (unique or multi-topic schedule cards): ${kept.length}.`);
  if (unresolved.length) report.push("Topic merges needing attention:", ...unresolved.map((line) => `  - ${line}`));
  return {
    cards: [...hubCards, ...kept], conflicts, report,
    topics: [...groups].map(([name, cards]) => ({ name, description: topics.get(name.toLowerCase())?.description || "", cards: cards.length })).sort((a, b) => b.cards - a.cards),
  };
}
