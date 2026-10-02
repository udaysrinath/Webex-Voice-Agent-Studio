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
  tVec?: Float32Array;
  terms: Map<string, number>;
  length: number;
}
interface Index { cards: IndexedCard[]; df: Map<string, number>; avgLength: number; semantic: boolean; embeddingModel: string; dimensions: number; questionVectors?: Int8Array; questionCard?: number[] }

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
    return { ...card, index, terms, length: tokens.length, tVec: vectors ? decode(vectors.text[index], vectors.dimensions) : undefined };
  });
  const questionBuffer = vectors ? Buffer.from(vectors.questions, "base64") : undefined;
  const questionVectors = questionBuffer ? new Int8Array(questionBuffer.buffer, questionBuffer.byteOffset, questionBuffer.length) : undefined;
  const semantic = !!vectors && vectors.text.length === cards.length && !!questionVectors && questionVectors.length === vectors.questionCard.length * vectors.dimensions;
  return (cached = { cards, df, avgLength: total / Math.max(1, cards.length), semantic, embeddingModel: kb.embeddingModel, dimensions: kb.dimensions, questionVectors: semantic ? questionVectors : undefined, questionCard: semantic ? vectors!.questionCard : undefined });
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
/** Embeds several short texts in ONE request (same latency as one), serving repeats from the query cache. */
export async function embedQueries(texts: string[], dimensions: number, model: string): Promise<Array<Float32Array | undefined>> {
  if (!process.env.OPENAI_API_KEY) return texts.map(() => undefined);
  const keys = texts.map((text) => text.trim().toLowerCase());
  const missing = [...new Set(keys.filter((key) => !queryCache.has(key)))];
  if (missing.length) {
    client ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 4000, maxRetries: 1 });
    try {
      const response = await client.embeddings.create({ model, dimensions, input: missing, encoding_format: "float" });
      for (const item of response.data) {
        const raw = item.embedding;
        if (raw.length !== dimensions) continue;
        const length = Math.sqrt(raw.reduce((sum, value) => sum + value * value, 0)) || 1;
        if (queryCache.size >= 500) queryCache.delete(queryCache.keys().next().value!);
        queryCache.set(missing[item.index], Float32Array.from(raw, (value) => value / length));
      }
    } catch (error) {
      console.warn("WebexOne batch query embedding failed.", error instanceof Error ? error.message : error);
    }
  }
  return keys.map((key) => queryCache.get(key));
}
const dot = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/** Best similarity of the query to any single question alias of each card, and to the card's content. */
function semanticScores(index: Index, vector: Float32Array): number[] {
  const dims = index.dimensions;
  const best = new Array<number>(index.cards.length).fill(0);
  const q = index.questionVectors!;
  const owner = index.questionCard!;
  for (let row = 0; row < owner.length; row++) {
    let sum = 0;
    const base = row * dims;
    for (let i = 0; i < dims; i++) sum += q[base + i] * vector[i];
    const score = sum / 127;
    if (score > best[owner[row]]) best[owner[row]] = score;
  }
  return index.cards.map((card, i) => Math.max(best[i], dot(vector, card.tVec!) * 0.92));
}

// ---- intent ---------------------------------------------------------------------------------------------------
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DATE_TO_DAY: Record<string, string> = { "4": "sunday", "5": "monday", "6": "tuesday", "7": "wednesday", "8": "thursday" };
function queryDays(query: string): string[] {
  const lower = query.toLowerCase();
  const days = DAYS.filter((day) => lower.includes(day) || lower.includes(day.slice(0, 3) + " ") || new RegExp(`\\b${day.slice(0, 3)}\\b`).test(lower));
  for (const match of lower.matchAll(/\boct(?:ober)?\.?\s*(\d{1,2})/g)) if (DATE_TO_DAY[match[1]]) days.push(DATE_TO_DAY[match[1]]);
  return [...new Set(days)];
}
interface Intent { person: boolean; session: boolean; code?: string; when: boolean; where: boolean }
// A "when" question is answered by a card that holds a date or time, a "where" question by one that names a place.
// "when is Webex One" otherwise ranks "What is WebexOne?" first, because "Webex" and "One" carry no weight.
const HAS_TIME = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b|\b\d{1,2}(?::\d{2})?\s?[ap]\.?m\b|\b(?:monday|tuesday|wednesday|thursday|friday|sunday)\b/i;
const HAS_PLACE = /\b(?:level \d|ballroom|foyer|room|floor|located|address|street|desk|terrace|theater|lobby|hotel)\b/i;
function detectIntent(query: string): Intent {
  const lower = query.toLowerCase();
  return {
    person: /\b(who is|who's|speaker|speakers|bio|biography|speaking|presenter|presents|presenting|ceo|president)\b/.test(lower),
    session: /\b(session|sessions|class|classes|lab|labs|keynote|keynotes|roundtable|roundtables|breakout|breakouts|quick take|quick takes|panel|talk|talks|workshop)\b/.test(lower),
    code: query.match(/\b([A-Z]{3}-\d{4,5})\b/i)?.[1]?.toUpperCase(),
    when: /\b(when|what time|what day|what date|dates?|start|begin|end|open|close|until|hours)\b/.test(lower),
    where: /\b(where|which room|what room|what floor|location|located|address)\b/.test(lower),
  };
}

// ---- retrieval --------------------------------------------------------------------------------------------------
export interface RetrieveOptions {
  limit?: number;
  maxChars?: number;
  /** How long to wait for the query embedding before answering from lexical ranking alone. Spoken answers cannot wait on a slow API call. */
  embedBudgetMs?: number;
  /** A query embedding computed elsewhere (batched with other candidates), so no extra API call is made. */
  vector?: Float32Array;
}
const EMBED_BUDGET_MS = Number(process.env.WEBEXONE_EMBED_BUDGET_MS) || 1100;
export interface Retrieved { id: string; title: string; kind: CardKind; score: number }
export interface RetrieveResult {
  text: string;
  cards: Retrieved[];
  /** Best semantic similarity between the query and any card (0-1). Low means the query probably is not a real WebexOne question (a misheard transcript, background talk). Undefined when semantic search was unavailable. */
  confidence?: number;
  /** True when the query contains the exact title or alias of a returned card (a real name, code or room). */
  exactMatch?: boolean;
}

const KIND_PRIOR: Record<CardKind, number> = { activity: 1.15, info: 1.1, faq: 1.1, room: 1.0, award: 1.0, sponsor: 1.0, product: 1.0, session: 0.95, training: 0.9, speaker: 0.85 };

export async function retrieveWebexOne(rawQuery: string, options: RetrieveOptions = {}): Promise<RetrieveResult> {
  const limit = options.limit ?? 5;
  const maxChars = options.maxChars ?? 1500;
  const query = rawQuery.trim();
  if (!query) return { text: "", cards: [], exactMatch: false };
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
  if (index.semantic && options.vector) {
    semantic = semanticScores(index, options.vector);
  } else if (index.semantic) {
    const pending = embedQuery(query, index.dimensions, index.embeddingModel);
    const budget = options.embedBudgetMs ?? EMBED_BUDGET_MS;
    const vector = await Promise.race([pending, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), budget))]);
    if (vector) semantic = semanticScores(index, vector);
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
    if (intent.when && HAS_TIME.test(card.text)) prior *= 1.12;
    if (intent.where && HAS_PLACE.test(card.text)) prior *= 1.12;
    if (days.length && card.days?.length && card.days.some((day) => days.some((wanted) => day.startsWith(wanted)))) prior *= 1.12;
    return { card, score: score * prior };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);

  // Topic cards are the consolidated, authoritative answer: prefer them, then drop results that merely repeat a better one.
  for (const item of scored) if (item.card.id.startsWith("topic-")) item.score *= 1.15;
  scored.sort((a, b) => b.score - a.score);
  const confidence = semantic ? Math.max(...semantic) : undefined;
  const picked: typeof scored = [];
  for (const item of scored) {
    if (picked.length >= limit) break;
    const duplicate = picked.some((chosen) => chosen.card.kind === item.card.kind && chosen.card.tVec && item.card.tVec && dot(chosen.card.tVec, item.card.tVec) > 0.9);
    if (!duplicate) picked.push(item);
  }
  const text = picked.map(({ card }) => `[${card.title}]\n${card.text.length > maxChars ? `${card.text.slice(0, maxChars).replace(/\s+\S*$/, "")}…` : card.text}`).join("\n\n---\n\n");
  return { text, cards: picked.map(({ card, score }) => ({ id: card.id, title: card.title, kind: card.kind, score })), confidence, exactMatch: picked.some(({ card }) => exact[card.index] > 0) };
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
    const score = Math.max(...semanticScores(index, vector));
    best = Math.max(best ?? 0, score);
    if (best >= WEBEXONE_RELEVANCE_MIN) break;
  }
  return { relevant: best === null || best >= WEBEXONE_RELEVANCE_MIN, score: best };
}

/** Load the index and open the embedding connection before the first caller, so the first question is as fast as the rest. */
export async function warmWebexOneKnowledge(): Promise<void> {
  try {
    const index = loadKnowledgeBase();
    if (index.semantic) {
      await embedQuery("where is lunch", index.dimensions, index.embeddingModel);
      // An idle HTTPS connection goes cold, and the first embedding after a quiet spell can take over a second. A tiny
      // periodic call keeps it open so spoken answers do not fall back to lexical ranking.
      setInterval(() => { void embedQuery(`keepalive ${Date.now()}`, index.dimensions, index.embeddingModel); }, 20_000).unref();
    }
    console.info(`WebexOne KB ready: ${index.cards.length} cards${index.semantic ? ", semantic search warm" : ", lexical only"}.`);
  } catch (error) {
    console.warn("WebexOne KB warm-up failed:", error instanceof Error ? error.message : error);
  }
}

// ---- core reference ---------------------------------------------------------------------------------------------
let corePack: string | undefined;
const CORE_QUERIES = ["when is WebexOne dates", "where is WebexOne venue address Fairmont Austin", "where is lunch served breakfast", "where is registration badge pickup hours", "wifi password network", "keynote times Manchester Ballroom"];

/**
 * The few facts people ask for most (dates, venue, meals, registration, Wi-Fi, keynotes), a sentence or two each.
 * Attached when a lookup looks unreliable (a misheard transcript), so the common questions still get a grounded answer.
 */
export async function coreReference(): Promise<string> {
  if (corePack) return corePack;
  const parts: string[] = [];
  for (const query of CORE_QUERIES) {
    const top = (await retrieveWebexOne(query, { limit: 1, maxChars: 280, embedBudgetMs: 1 })).text.replace(/\s+/g, " ");
    if (top) parts.push(top.replace(/^\[([^\]]+)\]\s*/, "$1: "));
  }
  return (corePack = [...new Set(parts)].join("\n"));
}

// ---- picking the question out of a noisy transcript ------------------------------------------------------------
const WH_START = /^(where|when|what|who|whose|which|how|is|are|can|could|do|does|did|will|would|should|may)\b/i;

/**
 * GPT-Live's transcript of a noisy room carries background words ("So then I told him, where is lunch served, the hotel
 * was..."), and searching with all of it steers the lookup to the wrong cards. Split it into clauses and windows,
 * score each against the knowledge base (one batched embedding call), and use the one that looks most like a real
 * WebexOne question. Questions (a "?" or a leading wh-word) get a small bonus.
 */
export async function pickQuestion(transcript: string, budgetMs = 900): Promise<{ question: string; candidates: number }> {
  const text = transcript.replace(/\s+/g, " ").trim();
  const words = text.split(" ").filter(Boolean);
  if (words.length <= 4) return { question: text, candidates: 1 };
  const clauses = text.split(/(?<=[.?!;])\s*|,\s+/).map((clause) => clause.trim()).filter((clause) => clause.split(" ").length >= 2);
  const windows = [words.slice(-6).join(" "), words.slice(-10).join(" ")];
  const candidates = [...new Set([...clauses, ...windows, text])].slice(0, 7);
  const index = loadKnowledgeBase();
  const fallback = [...clauses].reverse().find((clause) => clause.endsWith("?")) || candidates[candidates.length - 1];
  if (!index.semantic) return { question: fallback, candidates: candidates.length };
  const vectors = await Promise.race([embedQueries(candidates, index.dimensions, index.embeddingModel), new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), budgetMs))]);
  if (!vectors) return { question: fallback, candidates: candidates.length };
  let best = { text: fallback, score: -1 };
  candidates.forEach((candidate, i) => {
    const vector = vectors[i];
    if (!vector) return;
    const score = Math.max(...semanticScores(index, vector)) + (candidate.endsWith("?") || WH_START.test(candidate) ? 0.05 : 0) - (candidate.split(" ").length < 3 ? 0.05 : 0);
    if (score > best.score) best = { text: candidate, score };
  });
  return { question: best.text, candidates: candidates.length };
}

// ---- retrieval for a noisy spoken transcript -----------------------------------------------------------------------
export interface TranscriptRetrieval {
  /** The clause that looks most like the question (for logging and the final instruction). */
  question: string;
  /** Fact packs for session.thinking.append, each small enough for one append, best first. */
  packs: string[];
  cards: Retrieved[];
  /** Best semantic similarity of the best candidate; undefined when semantic search timed out. */
  confidence?: number;
  topIsGuessedName: boolean;
}

const PACK_CHARS = 1150;

/**
 * Retrieve for every plausible reading of the transcript, not just one. The voice model heard the real audio, so it can
 * pick the right facts out of a wider set even when background talk has leaked into the transcript, which a single
 * guessed query cannot do.
 */
export async function retrieveForTranscript(transcript: string, previousQuestion?: string, options: { budgetMs?: number } = {}): Promise<TranscriptRetrieval> {
  const index = loadKnowledgeBase();
  // Background audio in another language leaks in as non-Latin script ("...WebexOne है"); search only on the Latin text.
  const text = transcript.replace(/[^\u0000-\u024F\u2010-\u206F]+/g, " ").replace(/\s+/g, " ").trim();
  const words = text.split(" ").filter(Boolean);
  const clauses = text.split(/(?<=[.?!;])\s*|,\s+/).map((clause) => clause.trim()).filter((clause) => clause.split(" ").length >= 2);
  let candidates = words.length <= 4 ? [text] : [...new Set([...clauses, words.slice(-6).join(" "), words.slice(-10).join(" "), text])].slice(0, 6);
  // A genuine follow-up ("what time?", "and on Thursday?") is searched together with the previous question. It is only a
  // candidate, with a penalty, so a complete new question ("where is registration") is never contaminated by the last one.
  const withContext = previousQuestion && words.length < 5 ? `${previousQuestion} ${text}` : undefined;
  if (withContext) candidates = [...candidates, withContext];

  const budget = options.budgetMs ?? EMBED_BUDGET_MS;
  const vectors = index.semantic
    ? await Promise.race([embedQueries(candidates, index.dimensions, index.embeddingModel), new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), budget))])
    : undefined;
  const scored = await Promise.all(candidates.map(async (candidate, i) => {
    const vector = vectors?.[i];
    const result = await retrieveWebexOne(candidate, { limit: 3, maxChars: 560, vector, embedBudgetMs: vector ? undefined : 1 });
    const bonus = (candidate.endsWith("?") || WH_START.test(candidate) ? 0.05 : 0) - (candidate.split(" ").length < 3 ? 0.05 : 0);
    const penalty = candidate === withContext ? 0.12 : 0;
    return { candidate, result, rank: (vector ? (result.confidence ?? 0) : 0) + bonus - penalty };
  }));
  scored.sort((a, b) => b.rank - a.rank);
  const best = scored[0];

  // Merge: the best reading contributes its top cards, the others add what is new.
  const seen = new Set<string>();
  const sections: string[] = [];
  const cards: Retrieved[] = [];
  scored.forEach(({ result }, order) => {
    const blocks = result.text ? result.text.split("\n\n---\n\n") : [];
    result.cards.forEach((card, k) => {
      if (seen.has(card.id) || k >= (order === 0 ? 3 : 2)) return;
      seen.add(card.id);
      cards.push(card);
      if (blocks[k]) sections.push(blocks[k]);
    });
  });
  const packs: string[] = [];
  let current = "";
  for (const section of sections) {
    const piece = section.length > PACK_CHARS ? `${section.slice(0, PACK_CHARS).replace(/\s+\S*$/, "")}…` : section;
    if (current && current.length + piece.length + 7 > PACK_CHARS) { packs.push(current); current = ""; }
    current += (current ? "\n---\n" : "") + piece;
    if (packs.length >= 3) break;
  }
  if (current && packs.length < 3) packs.push(current);

  const topIsGuessedName = best.result.cards[0]?.kind === "speaker" && !best.result.exactMatch && !/\b(who|speaker|bio|speaking|presenter)\b/i.test(best.candidate);
  return { question: best.candidate, packs, cards, confidence: vectors ? best.result.confidence : undefined, topIsGuessedName };
}
