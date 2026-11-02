const STOPWORDS = new Set(
  ("a an and are as at be by can do does for from how i in is it its of on or our should " +
    "the their this to use used we what when where which who why with you your").split(" "),
);

/** Lowercase and strip accents so "límite" matches "limite". */
export function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Light tokenizer for BM25: alphanumerics and hex colors, no stopwords, naive plural folding. */
export function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9#]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map((t) => (t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));
}

/**
 * Token estimate (~4 characters per token for English text).
 * Good enough for budgeting; swap for the model's tokenizer when exact counts matter.
 */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
