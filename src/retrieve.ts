import { BM25 } from "./bm25.js";
import type { Doc, Status } from "./corpus.js";
import { cosine, embed } from "./embed.js";
import type { IndexedChunk, KnowledgeIndex } from "./index-store.js";
import { tokenize } from "./text.js";

export type Mode = "bm25" | "vector" | "hybrid";

export interface SearchOptions {
  mode?: Mode;
  repo?: string;
  kind?: string;
}

export interface Ranked {
  chunk: IndexedChunk;
  doc: Doc;
  score: number;
}

export interface Packed {
  selected: Ranked[];
  tokensUsed: number;
  budget: number;
  /** Relevant results that did not fit in the token budget. */
  omitted: number;
}

/** Canonical docs win ties; stale or unreviewed forks are demoted, not hidden. */
const AUTHORITY: Record<Status, number> = { canonical: 1, draft: 0.75, superseded: 0.5 };
const RRF_K = 60;
/** Below this cosine similarity a chunk is noise for all-MiniLM-L6-v2; keeps padding out of the context. */
const MIN_COSINE = 0.3;

export class Retriever {
  private readonly bm25: BM25;
  private readonly docs = new Map<string, Doc>();
  private readonly queryCache = new Map<string, number[]>();

  constructor(readonly index: KnowledgeIndex) {
    this.bm25 = new BM25(index.chunks.map((c) => c.terms));
    for (const d of index.docs) this.docs.set(d.id, d);
  }

  getDoc(id: string): Doc | undefined {
    return this.docs.get(id);
  }

  listDocs(): Doc[] {
    return [...this.docs.values()];
  }

  private async queryVector(query: string): Promise<{ vector: number[]; cacheHit: boolean }> {
    const key = query.trim().toLowerCase();
    const cached = this.queryCache.get(key);
    if (cached) return { vector: cached, cacheHit: true };
    const [vector] = await embed([query]);
    this.queryCache.set(key, vector);
    if (this.queryCache.size > 500) this.queryCache.delete(this.queryCache.keys().next().value!);
    return { vector, cacheHit: false };
  }

  async rank(query: string, opts: SearchOptions = {}): Promise<{ ranked: Ranked[]; cacheHit: boolean }> {
    const mode = opts.mode ?? "hybrid";
    const candidates = this.index.chunks
      .map((chunk, i) => ({ chunk, i, doc: this.docs.get(chunk.docId)! }))
      .filter(({ doc }) => (!opts.repo || doc.repo === opts.repo) && (!opts.kind || doc.kind === opts.kind));

    const lexical = this.bm25.scores(tokenize(query));
    let semantic: number[] = [];
    let cacheHit = false;
    if (mode !== "bm25") {
      const q = await this.queryVector(query);
      cacheHit = q.cacheHit;
      semantic = this.index.chunks.map((c) => cosine(q.vector, c.vector));
    }

    const rankOf = (scores: number[], minScore: number) => {
      const order = candidates.filter((c) => scores[c.i] > minScore).sort((a, b) => scores[b.i] - scores[a.i]);
      return new Map(order.map((c, r) => [c.i, r + 1]));
    };

    let score: (i: number) => number;
    if (mode === "bm25") score = (i) => lexical[i];
    else if (mode === "vector") score = (i) => (semantic[i] >= MIN_COSINE ? semantic[i] : 0);
    else {
      // Reciprocal Rank Fusion: robust to the very different scales of BM25 and cosine.
      const lexRank = rankOf(lexical, 0);
      const semRank = rankOf(semantic, MIN_COSINE);
      score = (i) =>
        (lexRank.has(i) ? 1 / (RRF_K + lexRank.get(i)!) : 0) + (semRank.has(i) ? 1 / (RRF_K + semRank.get(i)!) : 0);
    }

    const ranked = candidates
      .map(({ chunk, i, doc }) => ({ chunk, doc, score: score(i) * AUTHORITY[doc.status] }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
    return { ranked, cacheHit };
  }

  /**
   * Greedy packing under a token budget: at most `maxPerDoc` chunks per document
   * (diversity) and at most `topK` chunks overall (relevance floor).
   */
  pack(ranked: Ranked[], budget: number, topK = 6, maxPerDoc = 2): Packed {
    const selected: Ranked[] = [];
    const perDoc = new Map<string, number>();
    let tokensUsed = 0;
    let omitted = 0;
    for (const r of ranked.slice(0, topK * 2)) {
      if (selected.length >= topK) break;
      if ((perDoc.get(r.doc.id) ?? 0) >= maxPerDoc) continue;
      if (tokensUsed + r.chunk.tokens > budget) {
        omitted++;
        continue;
      }
      selected.push(r);
      perDoc.set(r.doc.id, (perDoc.get(r.doc.id) ?? 0) + 1);
      tokensUsed += r.chunk.tokens;
    }
    return { selected, tokensUsed, budget, omitted };
  }

  /** Markdown context grouped by source, with provenance and staleness warnings. */
  format(packed: Packed): string {
    if (packed.selected.length === 0) return "No matching design knowledge found.";
    const byDoc = new Map<string, Ranked[]>();
    for (const r of packed.selected) byDoc.set(r.doc.id, [...(byDoc.get(r.doc.id) ?? []), r]);

    const lines = [
      `Context: ${byDoc.size} source(s), ~${packed.tokensUsed}/${packed.budget} tokens` +
        (packed.omitted ? `, ${packed.omitted} more result(s) left out to stay within budget` : ""),
    ];
    for (const [id, hits] of byDoc) {
      const doc = hits[0].doc;
      lines.push("", `### ${doc.title}`, `\`${doc.repo}/${id}\` · ${doc.status} · ${doc.unit} · updated ${doc.updated}`);
      if (doc.status === "superseded" && doc.supersededBy)
        lines.push(`> Warning: superseded by \`${doc.supersededBy}\`. Prefer the canonical document.`);
      if (doc.status === "draft") {
        const replacement = doc.supersededBy ? ` Canonical replacement: \`${doc.supersededBy}\`.` : "";
        lines.push(`> Warning: local draft owned by ${doc.unit}, not reviewed as a standard.${replacement}`);
      }
      for (const h of hits) lines.push(`**${h.chunk.section}:** ${h.chunk.text.split("\n").slice(1).join(" ")}`);
    }
    return lines.join("\n");
  }
}
