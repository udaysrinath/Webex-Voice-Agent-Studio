import * as fs from "node:fs";
import * as path from "node:path";
import OpenAI from "openai";
import { loadWebexOneSource, KB_DIMENSIONS, KB_INDEX_PATH, KB_MODEL, KB_VERSION, type EmbeddingIndex } from "../server/webexone-knowledge";

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required to build the WebexOne embedding index.");
  const { chunks, sourceHash } = loadWebexOneSource();
  const existing = fs.existsSync(KB_INDEX_PATH) ? JSON.parse(fs.readFileSync(KB_INDEX_PATH, "utf8")) as EmbeddingIndex : undefined;
  const reusable = existing?.version === KB_VERSION && existing.model === KB_MODEL && existing.dimensions === KB_DIMENSIONS
    ? new Map(existing.chunks.filter((item) => item.embedding.length === KB_DIMENSIONS).map((item) => [item.id, item.embedding]))
    : new Map<string, number[]>();
  const vectors = new Map<string, number[]>(reusable);
  const missing = chunks.filter((chunk) => !vectors.has(chunk.id));
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  console.info(`WebexOne KB: ${chunks.length} passages, ${missing.length} embeddings to generate.`);
  for (let offset = 0; offset < missing.length; offset += 64) {
    const batch = missing.slice(offset, offset + 64);
    const response = await client.embeddings.create({
      model: KB_MODEL,
      dimensions: KB_DIMENSIONS,
      input: batch.map((chunk) => `${chunk.title}\n${chunk.section}\n${chunk.text}`),
      encoding_format: "float",
    });
    for (const item of response.data) {
      if (!batch[item.index] || item.embedding.length !== KB_DIMENSIONS) throw new Error("Embedding service returned an invalid batch.");
      vectors.set(batch[item.index].id, item.embedding);
    }
    console.info(`Embedded ${Math.min(offset + batch.length, missing.length)} of ${missing.length} passages.`);
  }
  if (chunks.some((chunk) => !vectors.has(chunk.id))) throw new Error("Embedding index is incomplete.");
  const index: EmbeddingIndex = {
    version: KB_VERSION, model: KB_MODEL, dimensions: KB_DIMENSIONS, sourceHash, generatedAt: new Date().toISOString(),
    chunks: chunks.map((chunk) => ({ id: chunk.id, embedding: vectors.get(chunk.id)! })),
  };
  const temporaryPath = `${KB_INDEX_PATH}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(KB_INDEX_PATH), { recursive: true });
  fs.writeFileSync(temporaryPath, JSON.stringify(index));
  fs.renameSync(temporaryPath, KB_INDEX_PATH);
  console.info(`Saved WebexOne embedding index: ${KB_INDEX_PATH}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
