/** Okapi BM25 over pre-tokenized chunks. Small corpora fit in memory easily. */
export class BM25 {
  private readonly df = new Map<string, number>();
  private readonly tf: Map<string, number>[];
  private readonly lengths: number[];
  private readonly avgLength: number;

  constructor(docs: string[][], private readonly k1 = 1.2, private readonly b = 0.75) {
    this.tf = docs.map((tokens) => {
      const counts = new Map<string, number>();
      for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
      for (const t of counts.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return counts;
    });
    this.lengths = docs.map((d) => d.length);
    this.avgLength = this.lengths.reduce((a, b) => a + b, 0) / Math.max(docs.length, 1);
  }

  scores(query: string[]): number[] {
    const n = this.tf.length;
    return this.tf.map((counts, i) => {
      let score = 0;
      for (const term of new Set(query)) {
        const f = counts.get(term);
        if (!f) continue;
        const df = this.df.get(term) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        const norm = f + this.k1 * (1 - this.b + (this.b * this.lengths[i]) / this.avgLength);
        score += idf * ((f * (this.k1 + 1)) / norm);
      }
      return score;
    });
  }
}
