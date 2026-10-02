import * as fs from "node:fs";
import * as path from "node:path";
import OpenAI from "openai";
import type { CardKind, KbCard, KbFile, KbVectors } from "./webexone-kb-types";

/**
 * Runtime retrieval over the consolidated WebexOne knowledge base (server/data/webexone/kb, built by
 * scripts/build-webexone-kb.ts). Hybrid ranking: BM25 over title/aliases/questions/text, semantic similarity
 * against both the question aliases and the content, exact matches on names and codes, and facets for
 * days and rooms. Returns answer-ready cards, so one search is normally enough.
 */
const KB_DIR = path.resolve(process.cwd(), "server/data/webexone/kb");

interface IndexedCard extends KbCard {
  index: number;
  qVec?: Float32Array;
  tVec?: Float32Array;
  terms: Map<string, number>;
  length: number;
}
interface Index { cards: IndexedCard[]; df: Map<string, number>; avgLength: number; semantic: boolean; embeddingModel: string; dimensions: number }

const STOP = new Set("a an and are as at be been but by can could did do does for from get give go going has have how i if in is it its me my of on or our please should so tell that the their them there these they this to us was we were what when where which who will with would you your about any also just like really some very webexone webex one event conference 2026 attend attendee attendees".split(" "));
const SYNONYMS: Record<string, string[]> = {
  restroom: ["bathroom", "toilet", "washroom"], bathroom: ["restroom", "toilet", "washroom"], toilet: ["restroom", "bathroom"],
  eat: ["food", "meal", "lunch", "breakfast", "dining"], food: ["meal", "lunch", "breakfast", "eat"], hungry: ["food", "meal", "lunch"], dining: ["food", "meal", "restaurant"],
  wifi: ["wi-fi", "internet", "wireless", "network", "password"], internet: ["wifi", "wireless", "network"],
  badge: ["registration", "check-in"], checkin: ["registration", "badge"], "check-in": ["registration", "badge"],
  parking: ["garage", "valet", "self-parking"], medical: ["first", "aid", "emt", "health"], doctor: ["medical", "first", "aid", "emt"],
  coffee: ["café", "cafe", "fizz"], cafe: ["coffee", "fizz"], swag: ["brandmakers", "patches"], hotel: ["accommodations", "fairmont", "overflow"],
  airport: ["austin-bergstrom", "aus", "transportation"], taxi: ["rideshare", "transportation"], uber: ["rideshare", "transportation"],
  cost: ["price", "rate", "fee"], price: ["cost", "rate", "fee"], headshot: ["headshots", "photo"], photo: ["headshot", "headshots"],
};

function tokenize(value: string): string[] {
  return (value.toLowerCase().replace(/&/g, " and ").match(/[a-z0-9][a-z0-9'+-]*/g) || [])
    .map((term) => term.replace(/'s$/, "").replace(/(?<=[a-z]{4})s$/, ""))
    .filter((term) => term.length > 1 && !STOP.has(term));
}
const norm = (value: string) => value.toLowerCase().replace(/&amp;/g, "&").replace(/[^a-z0-9]+/g, " ").trim();

function decode(base64: string, dimensions: number): Float32Array {
  const buffer = Buffer.from(base64, "base64");
  return new Float32Array(buffer.buffer, buffer.byteOffset, dimensions).slice();
}

let cached: Index | undefined;
export function loadKnowledgeBase(): Index {
  if (cached) return cached;
  const kb = JSON.parse(fs.readFileSync(path.join(KB_DIR, "cards.json"), "utf8")) as KbFile;
  let vectors: KbVectors | undefined;
  try { vectors = JSON.parse(fs.readFileSync(path.join(KB_DIR, "vectors.json"), "utf8")) as KbVectors; }
  catch { console.warn("WebexOne KB vectors missing; using lexical search only. Run npm run kb:build."); }
  const df = new Map<string, number>();
  let total = 0;
  const cards = kb.cards.map((card, index): IndexedCard => {
    // title and aliases are repeated so they weigh more than body text
    const weighted = [card.title, card.title, card.title, ...(card.aliases || []), ...(card.aliases || []), ...card.questions, ...card.questions, card.text].join("\n");
    const terms = new Map<string, number>();
    const tokens = tokenize(weighted);
    for (const term of tokens) terms.set(term, (terms.get(term) || 0) + 1);
    for (const term of terms.keys()) df.set(term, (df.get(term) || 0) + 1);
    total += tokens.length;
    return { ...card, index, terms, length: tokens.length, qVec: vectors ? decode(vectors.question[index], vectors.dimensions) : undefined, tVec: vectors ? decode(vectors.text[index], vectors.dimensions) : undefined };
  });
  return (cached = { cards, df, avgLength: total / Math.max(1, cards.length), semantic: !!vectors && vectors.question.length === cards.length, embeddingModel: kb.embeddingModel, dimensions: kb.dimensions });
}

// ---- query embedding ------------------------------------------------------------------------------------
const queryCache = new Map<string, Float32Array>();
let client: OpenAI | undefined;
export async function embedQuery(query: string, dimensions: number, model: string): Promise<Float32Array | undefined> {
  if (!process.env.OPENAI_API_KEY) return undefined;
  const key = query.trim().toLowerCase();
  const hit = queryCache.get(key);
  if (hit) return hit;
  client ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 4000, maxRetries: 1 });
  try {
    const response = await client.embeddings.create({ model, dimensions, input: query, encoding_format: "float" });
    const raw = response.data[0]?.embedding;
    if (!raw || raw.length !== dimensions) return undefined;
    const length = Math.sqrt(raw.reduce((sum, value) => sum + value * value, 0)) || 1;
    const vector = Float32Array.from(raw, (value) => value / length);
    if (queryCache.size >= 500) queryCache.delete(queryCache.keys().next().value!);
    queryCache.set(key, vector);
    return vector;
  } catch (error) {
    console.warn("WebexOne query embedding failed; lexical results only.", error instanceof Error ? error.message : error);
    return undefined;
  }
}
const dot = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

// ---- intent ---------------------------------------------------------------------------------------------------
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DATE_TO_DAY: Record<string, string> = { "4": "sunday", "5": "monday", "6": "tuesday", "7": "wednesday", "8": "thursday" };
function queryDays(query: string): string[] {
  const lower = query.toLowerCase();
  const days = DAYS.filter((day) => lower.includes(day) || lower.includes(day.slice(0, 3) + " ") || new RegExp(`\\b${day.slice(0, 3)}\\b`).test(lower));
  for (const match of lower.matchAll(/\boct(?:ober)?\.?\s*(\d{1,2})/g)) if (DATE_TO_DAY[match[1]]) days.push(DATE_TO_DAY[match[1]]);
  return [...new Set(days)];
}
interface Intent { person: boolean; session: boolean; code?: string }
function detectIntent(query: string): Intent {
  const lower = query.toLowerCase();
  return {
    person: /\b(who is|who's|speaker|speakers|bio|biography|speaking|presenter|presents|presenting|ceo|president)\b/.test(lower),
    session: /\b(session|sessions|class|classes|lab|labs|keynote|keynotes|roundtable|roundtables|breakout|breakouts|quick take|quick takes|panel|talk|talks|workshop)\b/.test(lower),
    code: query.match(/\b([A-Z]{3}-\d{4,5})\b/i)?.[1]?.toUpperCase(),
  };
}

// ---- retrieval --------------------------------------------------------------------------------------------------
export interface RetrieveOptions {
  limit?: number;
  maxChars?: number;
  /** How long to wait for the query embedding before answering from lexical ranking alone. Spoken answers cannot wait on a slow API call. */
  embedBudgetMs?: number;
}
const EMBED_BUDGET_MS = Number(process.env.WEBEXONE_EMBED_BUDGET_MS) || 700;
export interface Retrieved { id: string; title: string; kind: CardKind; score: number }
export interface RetrieveResult { text: string; cards: Retrieved[] }

const KIND_PRIOR: Record<CardKind, number> = { activity: 1.15, info: 1.1, faq: 1.1, room: 1.0, award: 1.0, sponsor: 1.0, product: 1.0, session: 0.95, training: 0.9, speaker: 0.85 };

export async function retrieveWebexOne(rawQuery: string, options: RetrieveOptions = {}): Promise<RetrieveResult> {
  const limit = options.limit ?? 5;
  const maxChars = options.maxChars ?? 1500;
  const query = rawQuery.trim();
  if (!query) return { text: "", cards: [] };
  const index = loadKnowledgeBase();
  const intent = detectIntent(query);
  const days = queryDays(query);

  // lexical
  const base = [...new Set(tokenize(query))];
  const expanded = [...new Set(base.flatMap((term) => [term, ...(SYNONYMS[term] || [])]))];
  const bm25 = index.cards.map((card) => {
    let score = 0;
    for (const term of expanded) {
      const frequency = card.terms.get(term) || 0;
      if (!frequency) continue;
      const df = index.df.get(term) || 0;
      const idf = Math.log(1 + (index.cards.length - df + 0.5) / (df + 0.5));
      const weight = base.includes(term) ? 1 : 0.5;
      score += weight * idf * (frequency * 2.2) / (frequency + 1.2 * (0.25 + 0.75 * card.length / Math.max(1, index.avgLength)));
    }
    return score;
  });

  // semantic
  let semantic: number[] | undefined;
  if (index.semantic) {
    const pending = embedQuery(query, index.dimensions, index.embeddingModel);
    const budget = options.embedBudgetMs ?? EMBED_BUDGET_MS;
    const vector = await Promise.race([pending, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), budget))]);
    if (vector) semantic = index.cards.map((card) => Math.max(dot(vector, card.qVec!), dot(vector, card.tVec!) * 0.92));
    else console.warn(`WebexOne query embedding exceeded ${budget}ms; answering from lexical ranking (the embedding still completes and is cached).`);
  }

  // exact entity matches: titles, aliases, session codes
  const normalizedQuery = ` ${norm(query)} `;
  const exact = index.cards.map((card) => {
    let bonus = 0;
    if (intent.code && card.aliases?.some((alias) => alias.toUpperCase() === intent.code)) bonus += 2;
    for (const name of [card.title, ...(card.aliases || [])]) {
      const n = norm(name.split(",")[0]);
      if (n.length >= 5 && normalizedQuery.includes(` ${n} `)) bonus = Math.max(bonus, n === norm(card.title) ? 1.2 : 1.0);
    }
    return bonus;
  });

  const rank = (scores: number[]) => {
    const order = scores.map((score, i) => [score, i] as const).filter(([score]) => score > 0).sort((a, b) => b[0] - a[0]).slice(0, 60);
    const ranks = new Map<number, number>();
    order.forEach(([, i], position) => ranks.set(i, position));
    return ranks;
  };
  const lexicalRank = rank(bm25);
  const semanticRank = semantic ? rank(semantic.map((score) => (score >= 0.2 ? score : 0))) : undefined;

  const scored = index.cards.map((card) => {
    let score = 0;
    const l = lexicalRank.get(card.index); if (l !== undefined) score += 1 / (20 + l);
    const s = semanticRank?.get(card.index); if (s !== undefined) score += 1.4 / (20 + s);
    score += exact[card.index] * 0.05;
    if (!score) return { card, score: 0 };
    let prior = KIND_PRIOR[card.kind];
    if (card.kind === "speaker" && intent.person) prior = 1.25;
    if ((card.kind === "session" || card.kind === "training") && intent.session) prior = 1.2;
    if (days.length && card.days?.length && card.days.some((day) => days.some((wanted) => day.startsWith(wanted)))) prior *= 1.12;
    return { card, score: score * prior };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);

  // Topic cards are the consolidated, authoritative answer: prefer them, then drop results that merely repeat a better one.
  for (const item of scored) if (item.card.id.startsWith("topic-")) item.score *= 1.15;
  scored.sort((a, b) => b.score - a.score);
  const picked: typeof scored = [];
  for (const item of scored) {
    if (picked.length >= limit) break;
    const duplicate = picked.some((chosen) => chosen.card.kind === item.card.kind && chosen.card.tVec && item.card.tVec && dot(chosen.card.tVec, item.card.tVec) > 0.9);
    if (!duplicate) picked.push(item);
  }
  const text = picked.map(({ card }) => `[${card.title}]\n${card.text.length > maxChars ? `${card.text.slice(0, maxChars).replace(/\s+\S*$/, "")}…` : card.text}`).join("\n\n---\n\n");
  return { text, cards: picked.map(({ card, score }) => ({ id: card.id, title: card.title, kind: card.kind, score })) };
}

// ---- off-topic gate ---------------------------------------------------------------------------------------------
/** Cosine floor under which a spoken turn is treated as unrelated background talk. Deliberately low; tune with WEBEXONE_RELEVANCE_MIN. */
export const WEBEXONE_RELEVANCE_MIN = Number(process.env.WEBEXONE_RELEVANCE_MIN) || 0.3;

/**
 * Cheap on-topic check for noisy microphones: the best semantic match between the turn and any card's question
 * aliases or content. Short follow-ups ("who is he?") are also scored together with the previous user turn.
 * Fails open (relevant) when semantic search is unavailable.
 */
export async function checkWebexOneRelevance(query: string, previousUserTurn?: string): Promise<{ relevant: boolean; score: number | null }> {
  const index = loadKnowledgeBase();
  if (!index.semantic) return { relevant: true, score: null };
  let best: number | null = null;
  for (const text of [query, previousUserTurn ? `${previousUserTurn} ${query}` : ""]) {
    if (!text.trim()) continue;
    const vector = await embedQuery(text, index.dimensions, index.embeddingModel);
    if (!vector) return { relevant: true, score: null };
    const score = index.cards.reduce((max, card) => Math.max(max, dot(vector, card.qVec!), dot(vector, card.tVec!) * 0.92), 0);
    best = Math.max(best ?? 0, score);
    if (best >= WEBEXONE_RELEVANCE_MIN) break;
  }
  return { relevant: best === null || best >= WEBEXONE_RELEVANCE_MIN, score: best };
}

/** Load the index and open the embedding connection before the first caller, so the first question is as fast as the rest. */
export async function warmWebexOneKnowledge(): Promise<void> {
  try {
    const index = loadKnowledgeBase();
    if (index.semantic) await embedQuery("where is lunch", index.dimensions, index.embeddingModel);
    console.info(`WebexOne KB ready: ${index.cards.length} cards${index.semantic ? ", semantic search warm" : ", lexical only"}.`);
  } catch (error) {
    console.warn("WebexOne KB warm-up failed:", error instanceof Error ? error.message : error);
  }
}
