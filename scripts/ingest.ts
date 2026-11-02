import { buildIndex, saveIndex } from "../src/index-store.js";
import { CORPUS_DIR, INDEX_FILE } from "../src/paths.js";

const start = performance.now();
const index = await buildIndex(CORPUS_DIR);
saveIndex(index);

const repos = new Set(index.docs.map((d) => d.repo));
const tokens = index.chunks.reduce((s, c) => s + c.tokens, 0);
console.log(
  `Indexed ${index.docs.length} docs from ${repos.size} repositories into ${index.chunks.length} chunks ` +
    `(~${tokens} tokens, avg ~${Math.round(tokens / index.chunks.length)} per chunk) ` +
    `in ${Math.round(performance.now() - start)} ms → ${INDEX_FILE}`,
);
