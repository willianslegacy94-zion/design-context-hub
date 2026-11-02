import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CORPUS_DIR = process.env.CORPUS_DIR ?? path.join(ROOT, "corpus");
export const INDEX_FILE = path.join(ROOT, "index", "index.json");
export const METRICS_FILE = path.join(ROOT, ".metrics", "usage.jsonl");
export const MODEL_CACHE = path.join(ROOT, ".cache", "models");
