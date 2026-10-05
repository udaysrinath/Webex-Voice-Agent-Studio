import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import OpenAI from "openai";
import { DATA_DIR } from "./parse";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 512;
export const BUILD_MODEL = process.env.KB_BUILD_MODEL || "gpt-4.1";
export const ALIAS_MODEL = process.env.KB_ALIAS_MODEL || "gpt-4.1-mini";

const CACHE_DIR = path.join(DATA_DIR, "kb/.cache");
fs.mkdirSync(CACHE_DIR, { recursive: true });
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);

let client: OpenAI | undefined;
const openai = () => (client ||= new OpenAI({ timeout: 120_000, maxRetries: 3 }));

function cacheRead<T>(name: string): Record<string, T> {
  const file = path.join(CACHE_DIR, name);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}
function cacheWrite(name: string, value: unknown) { fs.writeFileSync(path.join(CACHE_DIR, name), JSON.stringify(value)); }

/** Embeddings are cached by content so reruns only pay for changed text. */
export async function embed(texts: string[]): Promise<Float32Array[]> {
  const cache = cacheRead<number[]>("embeddings.json");
  const keys = texts.map((text) => hash(`${EMBEDDING_MODEL}:${EMBEDDING_DIMENSIONS}:${text}`));
  const missing = [...new Set(keys.filter((key) => !cache[key]))];
  const textFor = new Map(keys.map((key, index) => [key, texts[index]]));
  for (let offset = 0; offset < missing.length; offset += 64) {
    const batch = missing.slice(offset, offset + 64);
    const response = await openai().embeddings.create({ model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS, input: batch.map((key) => textFor.get(key)!.slice(0, 7000)), encoding_format: "float" });
    response.data.forEach((item) => { cache[batch[item.index]] = item.embedding; });
    console.info(`  embedded ${Math.min(offset + batch.length, missing.length)}/${missing.length}`);
  }
  if (missing.length) cacheWrite("embeddings.json", cache);
  return keys.map((key) => {
    const vector = Float32Array.from(cache[key]);
    const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return vector.map((value) => value / length);
  });
}
export const cosine = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/** JSON-mode chat completion, cached on (model, prompt) so a rebuild is deterministic and cheap. */
export async function jsonCompletion<T>(model: string, system: string, user: string, label: string): Promise<T> {
  const cache = cacheRead<T>("llm.json");
  const key = hash(`${model}\n${system}\n${user}`);
  if (cache[key]) return cache[key];
  const response = await openai().chat.completions.create({
    model, temperature: 0, response_format: { type: "json_object" },
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
  });
  const parsed = JSON.parse(response.choices[0]?.message?.content || "{}") as T;
  const fresh = cacheRead<T>("llm.json");
  fresh[key] = parsed;
  cacheWrite("llm.json", fresh);
  console.info(`  llm ${label} (${response.usage?.total_tokens ?? "?"} tokens)`);
  return parsed;
}
