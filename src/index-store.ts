import fs from "node:fs";
import path from "node:path";
import { chunkDoc, loadCorpus, type Chunk, type Doc } from "./corpus.js";
import { EMBEDDING_MODEL, embed } from "./embed.js";
import { INDEX_FILE } from "./paths.js";
import { tokenize } from "./text.js";

export interface IndexedChunk extends Chunk {
  terms: string[];
  vector: number[];
}

export interface KnowledgeIndex {
  model: string;
  builtAt: string;
  docs: Doc[];
  chunks: IndexedChunk[];
}

export async function buildIndex(corpusDir: string): Promise<KnowledgeIndex> {
  const docs = loadCorpus(corpusDir);
  const chunks = docs.flatMap(chunkDoc);
  const vectors = await embed(chunks.map((c) => c.text));
  return {
    model: EMBEDDING_MODEL,
    builtAt: new Date().toISOString(),
    docs,
    chunks: chunks.map((c, i) => ({ ...c, terms: tokenize(c.text), vector: vectors[i] })),
  };
}

export function saveIndex(index: KnowledgeIndex, file = INDEX_FILE): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(index));
}

export function loadIndex(file = INDEX_FILE): KnowledgeIndex | undefined {
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8")) as KnowledgeIndex;
}
