/**
 * Retrieval evaluation: does the right document come back, how high, at what token cost and latency?
 * Compares keyword-only, semantic-only and hybrid retrieval on the same labelled questions.
 */
import fs from "node:fs";
import path from "node:path";
import { loadIndex } from "../src/index-store.js";
import { percentile } from "../src/metrics.js";
import { ROOT } from "../src/paths.js";
import { Retriever, type Mode } from "../src/retrieve.js";

interface Question {
  q: string;
  expect: string;
  /** Other documents that are also a correct first answer. */
  also?: string[];
}

const BUDGET = 800;
const index = loadIndex();
if (!index) throw new Error("No index. Run `npm run ingest` first.");
const questions: Question[] = JSON.parse(fs.readFileSync(path.join(ROOT, "eval", "questions.json"), "utf8"));

const rows: string[] = [];
const misses: string[] = [];
for (const mode of ["bm25", "vector", "hybrid"] as Mode[]) {
  // Fresh retriever per mode: no query-embedding cache shared between modes.
  const retriever = new Retriever(index);
  await retriever.rank("warm up the embedding model");
  let hit1 = 0;
  let hit3 = 0;
  let rr = 0;
  let inContext = 0;
  const tokens: number[] = [];
  const latency: number[] = [];
  for (const { q, expect, also = [] } of questions) {
    const start = performance.now();
    const { ranked } = await retriever.rank(q, { mode });
    const packed = retriever.pack(ranked, BUDGET);
    latency.push(performance.now() - start);
    tokens.push(packed.tokensUsed);

    const docOrder = [...new Set(ranked.map((r) => r.doc.id))];
    const accepted = [expect, ...also];
    const rank = docOrder.findIndex((id) => accepted.includes(id)) + 1;
    if (rank === 1) hit1++;
    if (rank >= 1 && rank <= 3) hit3++;
    if (rank >= 1) rr += 1 / rank;
    if (packed.selected.some((r) => accepted.includes(r.doc.id))) inContext++;
    if (mode === "hybrid" && rank !== 1) misses.push(`| ${q} | ${expect} | ${docOrder[0] ?? "—"} | ${rank || "not found"} |`);
  }
  const n = questions.length;
  rows.push(
    `| ${mode} | ${((hit1 / n) * 100).toFixed(0)}% | ${((hit3 / n) * 100).toFixed(0)}% | ${(rr / n).toFixed(2)} | ` +
      `${((inContext / n) * 100).toFixed(0)}% | ${Math.round(tokens.reduce((a, b) => a + b, 0) / n)} | ` +
      `${percentile(latency, 50).toFixed(1)} | ${percentile(latency, 95).toFixed(1)} |`,
  );
}

const report = [
  "# Retrieval evaluation",
  "",
  `${questions.length} labelled questions over ${index.docs.length} documents (${index.chunks.length} chunks). ` +
    `Context budget: ${BUDGET} tokens. Model: \`${index.model}\` running locally on CPU.`,
  "",
  "| Mode | Hit@1 | Recall@3 | MRR | Expected doc in packed context | Avg context tokens | p50 ms | p95 ms |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ...rows,
  "",
  "Hit@1: the expected document ranks first. Recall@3: it is in the top 3 documents. " +
    "MRR: mean reciprocal rank of the expected document. Latency includes embedding the query.",
  "",
  "## Hybrid misses",
  "",
  misses.length ? "| Question | Expected | Ranked first | Rank of expected |\n| --- | --- | --- | --- |\n" + misses.join("\n") : "None.",
  "",
].join("\n");

fs.writeFileSync(path.join(ROOT, "eval", "RESULTS.md"), report);
console.log(report);
