import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { MODEL_CACHE } from "./paths.js";

/** Small local embedding model: no API key, no data leaves the machine. */
export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

env.cacheDir = MODEL_CACHE;
let extractor: Promise<FeatureExtractionPipeline> | undefined;

export async function embed(texts: string[]): Promise<number[][]> {
  // Cast: transformers.js' pipeline() overloads are too large for the TS checker to resolve.
  extractor ??= (pipeline as (task: string, model: string, opts: object) => Promise<FeatureExtractionPipeline>)(
    "feature-extraction",
    EMBEDDING_MODEL,
    { dtype: "q8" },
  );
  const output = await (await extractor)(texts, { pooling: "mean", normalize: true });
  return output.tolist() as number[][];
}

/** Vectors are normalized, so the dot product is the cosine similarity. */
export function cosine(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}
