import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import OpenAI from "openai";

export const KB_MODEL = "text-embedding-3-small";
export const KB_DIMENSIONS = 512;
export const KB_VERSION = 1;
export const KB_INDEX_PATH = path.resolve(process.cwd(), "server/data/webexone/embeddings.json");

export interface KnowledgeChunk { id: string; source: string; url: string; title: string; section: string; text: string }
export interface EmbeddingIndex {
  version: number; model: string; dimensions: number; sourceHash: string; generatedAt: string;
  chunks: Array<{ id: string; embedding: number[] }>;
}
type SearchChunk = KnowledgeChunk & { terms: Map<string, number>; length: number; vector?: Float32Array };

const STOP_WORDS = new Set("about after again all also an and any are as at be been before being between both but by can could did do does for from had has have how if in into is it its more most no not of on or our out over same she should so some such than that the their them then there these they this those through to too under up us was we were what which who why will with would you your webexone webex event".split(" "));
const SOURCE_HINTS: Array<[RegExp, string[]]> = [
  [/\b(?:room|ballroom|floor|level \d)\b|where (?:is|are|does|do|will)\b.*\b(?:session|keynote|talk|panel|speak\w*|present\w*)/i, ["socio-rooms", "socio-agenda", "socio-speakers"]],
  [/where|venue|hotel|stay|address|location|travel|airport/i, ["venue.html"]],
  [/agenda|session|schedule|keynote|breakout|roundtable|lab/i, ["socio-agenda", "faqs.html", "training.html"]],
  [/speaker|presenter|who is/i, ["socio-speakers"]],
  [/ticket|register|registration|price|pass/i, ["tickets.html", "faqs.html"]],
  [/training|class|technical|lab/i, ["training.html", "faqs.html"]],
  [/award|nomination/i, ["awards.html"]],
  [/sponsor|sponsorship/i, ["sponsorships.html"]],
  [/entertainment|music|performer/i, ["entertainment.html"]],
  [/faq|app|download|access|login|sign in/i, ["faqs.html"]],
  [/when|date|time|day/i, ["faqs.html", "socio-agenda"]],
];

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g)?.filter((term) => term.length > 2 && !/^20\d\d$/.test(term) && !STOP_WORDS.has(term)) || [];
}
function clean(value: string): string {
  return value.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/\\([*#_-])/g, "$1").replace(/[*_`]+/g, "").replace(/\s+/g, " ").trim();
}

/** Retain page and section context while splitting the exported Markdown into small passages. */
export function loadWebexOneSource(): { chunks: KnowledgeChunk[]; sourceHash: string } {
  const directory = path.resolve(process.cwd(), "server/data/webexone");
  const files = fs.readdirSync(directory).filter((file) => file.endsWith(".md")).sort();
  const hash = createHash("sha256").update(String(KB_VERSION));
  const chunks: KnowledgeChunk[] = [];
  for (const file of files) {
    const raw = fs.readFileSync(path.join(directory, file), "utf8");
    hash.update(file).update(raw);
    const frontmatter = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    const url = frontmatter?.[1].match(/^url:\s*"?([^"\n]+)"?/m)?.[1] || "";
    const title = frontmatter?.[1].match(/^title:\s*"?([^"\n]+)"?/m)?.[1] || file;
    const source = file.replace("www.webexone.com_", "").replace(".md", "").replace(/^\./, "home");
    const headings: string[] = [];
    let question = "";
    let pending = "";
    const flush = () => {
      if (!pending.trim()) return;
      const section = [...headings, question].filter(Boolean).join(" > ") || title;
      let part = "";
      for (const word of pending.trim().split(/\s+/)) {
        if (part && part.length + word.length + 1 > 1050) {
          const id = createHash("sha256").update(`${source}\n${section}\n${part}`).digest("hex");
          chunks.push({ id, source, url, title, section, text: part });
          part = "";
        }
        part += `${part ? " " : ""}${word}`;
      }
      if (part) {
        const id = createHash("sha256").update(`${source}\n${section}\n${part}`).digest("hex");
        chunks.push({ id, source, url, title, section, text: part });
      }
      pending = "";
    };
    for (const line of raw.slice(frontmatter?.[0].length || 0).split(/\r?\n/)) {
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        flush(); question = "";
        headings.length = heading[1].length - 1;
        headings[heading[1].length - 1] = clean(heading[2]);
        continue;
      }
      const text = clean(line);
      if (!text) continue;
      if (source === "faqs.html" && text.endsWith("?") && text.length < 150) {
        flush(); question = text; continue;
      }
      if (pending && pending.length + text.length + 1 > 1050) flush();
      pending += `${pending ? " " : ""}${text}`;
    }
    flush();
  }
  const seen = new Set<string>();
  const uniqueChunks = chunks.filter((chunk) => {
    if (seen.has(chunk.id)) return false;
    seen.add(chunk.id);
    return true;
  });
  return { chunks: uniqueChunks, sourceHash: hash.digest("hex") };
}

function unitVector(values: number[]): Float32Array {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return Float32Array.from(values, (value) => value / norm);
}
let cachedIndex: { chunks: SearchChunk[]; df: Map<string, number>; averageLength: number; semanticReady: boolean } | undefined;
function getIndex() {
  if (cachedIndex) return cachedIndex;
  const { chunks, sourceHash } = loadWebexOneSource();
  let vectors = new Map<string, Float32Array>();
  if (fs.existsSync(KB_INDEX_PATH)) {
    try {
      const saved = JSON.parse(fs.readFileSync(KB_INDEX_PATH, "utf8")) as EmbeddingIndex;
      if (saved.version === KB_VERSION && saved.model === KB_MODEL && saved.dimensions === KB_DIMENSIONS &&
          saved.sourceHash === sourceHash && saved.chunks.length === chunks.length &&
          saved.chunks.every((item, index) => item.id === chunks[index].id && item.embedding.length === KB_DIMENSIONS)) {
        vectors = new Map(saved.chunks.map((item) => [item.id, unitVector(item.embedding)]));
      } else console.warn("WebexOne embedding index is stale. Run npm run kb:index; using keyword search.");
    } catch (error) { console.warn("WebexOne embedding index unreadable; using keyword search.", error); }
  } else console.warn("WebexOne embedding index missing. Run npm run kb:index; using keyword search.");
  const df = new Map<string, number>();
  let totalLength = 0;
  const searchChunks: SearchChunk[] = chunks.map((chunk) => {
    const terms = tokenize(`${chunk.title} ${chunk.section} ${chunk.text}`);
    const frequencies = new Map<string, number>();
    for (const term of terms) frequencies.set(term, (frequencies.get(term) || 0) + 1);
    for (const term of frequencies.keys()) df.set(term, (df.get(term) || 0) + 1);
    totalLength += terms.length;
    return { ...chunk, terms: frequencies, length: terms.length, vector: vectors.get(chunk.id) };
  });
  cachedIndex = { chunks: searchChunks, df, averageLength: totalLength / Math.max(1, chunks.length), semanticReady: vectors.size === chunks.length && chunks.length > 0 };
  console.info(`WebexOne KB: ${chunks.length} passages; semantic search ${cachedIndex.semanticReady ? "ready" : "unavailable"}.`);
  return cachedIndex;
}

const queryVectors = new Map<string, Float32Array>();
let embeddingClient: OpenAI | undefined;
async function embedQuery(query: string): Promise<Float32Array | undefined> {
  if (!process.env.OPENAI_API_KEY) return undefined;
  const key = query.trim().toLowerCase();
  const cached = queryVectors.get(key);
  if (cached) return cached;
  try {
    embeddingClient ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 1800, maxRetries: 0 });
    const response = await embeddingClient.embeddings.create({ model: KB_MODEL, dimensions: KB_DIMENSIONS, input: query, encoding_format: "float" });
    const values = response.data[0]?.embedding;
    if (!values || values.length !== KB_DIMENSIONS) return undefined;
    const vector = unitVector(values);
    if (queryVectors.size >= 100) queryVectors.delete(queryVectors.keys().next().value!);
    queryVectors.set(key, vector);
    return vector;
  } catch (error) {
    console.warn("WebexOne query embedding failed; using keyword results.", error instanceof Error ? error.message : error);
    return undefined;
  }
}
function similarity(left: Float32Array, right: Float32Array): number {
  let score = 0;
  for (let i = 0; i < left.length; i++) score += left[i] * right[i];
  return score;
}

function eventOverviewChunk(query: string, chunks: SearchChunk[]): SearchChunk | undefined {
  const asksAboutEvent = /\b(?:webexone|webex one|event|conference)\b/i.test(query);
  const asksAboutSpecificProgram = /\b(?:session|keynote|speaker|training|lab|reception|award|workshop|breakout)\b/i.test(query);
  if (!asksAboutEvent || asksAboutSpecificProgram) return undefined;
  const faqQuestion = /\b(?:when|date|dates)\b/i.test(query)
    ? "What are the dates and times of WebexOne 2026?"
    : /\b(?:where|venue|location)\b/i.test(query)
      ? "Where will WebexOne take place?"
      : undefined;
  return faqQuestion
    ? chunks.find((chunk) => chunk.source === "faqs.html" && chunk.section.endsWith(faqQuestion))
    : undefined;
}

/** Search local reference passages with BM25 and semantic rank fusion. */
export async function findWebexOneExcerpts(query: string, limit = 5): Promise<string> {
  if (!query.trim()) return "";
  const index = getIndex();
  const terms = [...new Set(tokenize(query))];
  const overview = eventOverviewChunk(query, index.chunks);
  if (overview) return `[Source: ${overview.title} | ${overview.section} | ${overview.url}]\n${overview.text}`;
  const hinted = SOURCE_HINTS.find(([pattern]) => pattern.test(query))?.[1] || [];
  const lexical = index.chunks.map((chunk) => {
    const bm25 = terms.reduce((sum, term) => {
      const frequency = chunk.terms.get(term) || 0;
      if (!frequency) return sum;
      const df = index.df.get(term) || 0;
      const idf = Math.log(1 + (index.chunks.length - df + 0.5) / (df + 0.5));
      return sum + idf * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * chunk.length / Math.max(1, index.averageLength)));
    }, 0);
    return { chunk, score: bm25 + (hinted.some((source) => chunk.source.endsWith(source)) ? 1.25 : 0) };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 30);
  const vector = index.semanticReady ? await embedQuery(query) : undefined;
  const semantic = vector ? index.chunks.map((chunk) => ({ chunk, score: similarity(vector, chunk.vector!) }))
    .filter((item) => item.score >= 0.40).sort((a, b) => b.score - a.score).slice(0, 30) : [];
  const fused = new Map<string, { chunk: SearchChunk; score: number }>();
  for (const list of [lexical, semantic]) list.forEach((item, rank) => {
    const previous = fused.get(item.chunk.id);
    fused.set(item.chunk.id, { chunk: item.chunk, score: (previous?.score || 0) + 1 / (60 + rank + 1) });
  });
  return [...fused.values()].sort((a, b) => b.score - a.score).slice(0, limit)
    .map((item) => item.chunk)
    .map((chunk) => `[Source: ${chunk.title} | ${chunk.section} | ${chunk.url}]\n${chunk.text}`).join("\n\n");
}

/** Cosine floor below which a spoken turn is treated as unrelated background talk. Deliberately low. */
export const WEBEXONE_RELEVANCE_MIN = Number(process.env.WEBEXONE_RELEVANCE_MIN) || 0.25;

/**
 * Cheap on-topic check for noisy microphones: the best semantic match against the WebexOne passages.
 * Short follow-ups ("who is he?") are also scored together with the previous user turn. Fails open
 * (relevant) whenever semantic search is unavailable.
 */
export async function checkWebexOneRelevance(query: string, previousUserTurn?: string): Promise<{ relevant: boolean; score: number | null }> {
  const index = getIndex();
  if (!index.semanticReady) return { relevant: true, score: null };
  let best: number | null = null;
  for (const text of [query, previousUserTurn ? `${previousUserTurn} ${query}` : ""]) {
    if (!text.trim()) continue;
    const vector = await embedQuery(text);
    if (!vector) return { relevant: true, score: null };
    const score = index.chunks.reduce((max, chunk) => Math.max(max, similarity(vector, chunk.vector!)), 0);
    best = Math.max(best ?? 0, score);
    if (best >= WEBEXONE_RELEVANCE_MIN) break;
  }
  return { relevant: best === null || best >= WEBEXONE_RELEVANCE_MIN, score: best };
}
