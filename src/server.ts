import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildIndex, loadIndex } from "./index-store.js";
import { record, summarize } from "./metrics.js";
import { CORPUS_DIR } from "./paths.js";
import { TokenBucket } from "./rate-limit.js";
import { Retriever } from "./retrieve.js";
import { approxTokens } from "./text.js";

// stdout is the MCP channel: every log goes to stderr.
const log = (...args: unknown[]) => console.error("[design-context-hub]", ...args);

const index = loadIndex() ?? (log("no index found, building from corpus..."), await buildIndex(CORPUS_DIR));
const retriever = new Retriever(index);
const bucket = new TokenBucket(30, 0.5); // bursts of 30 calls, then 1 call every 2s
log(`ready: ${index.docs.length} docs, ${index.chunks.length} chunks`);

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type Measured = { text: string; tokensOut?: number; budget?: number; results?: number; omitted?: number; cacheHit?: boolean };

/** Every tool call is rate limited and leaves one metrics event, success or failure. */
async function instrumented(tool: string, run: () => Promise<Measured>): Promise<ToolResult> {
  const start = performance.now();
  if (!bucket.tryTake()) {
    record({ tool, latencyMs: 0, error: "rate_limited" });
    return { content: [{ type: "text", text: "Rate limit reached. Retry in a few seconds." }], isError: true };
  }
  try {
    const { text, ...metrics } = await run();
    record({ tool, latencyMs: Math.round(performance.now() - start), ...metrics });
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record({ tool, latencyMs: Math.round(performance.now() - start), error: message });
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
}

const server = new McpServer(
  { name: "design-context-hub", version: "0.1.0" },
  {
    instructions:
      "Design and research knowledge for the whole function. Call search_design_knowledge first; " +
      "it returns compact, cited context within a token budget. Prefer canonical sources and " +
      "mention warnings about superseded or draft documents in your answer.",
  },
);

server.registerTool(
  "search_design_knowledge",
  {
    title: "Search design knowledge",
    description:
      "Hybrid (keyword + semantic) search across all design and research repositories. " +
      "Returns cited context packed under max_tokens, canonical sources first.",
    inputSchema: {
      query: z.string().min(2).describe("Natural-language question or keywords"),
      max_tokens: z.number().int().min(200).max(4000).default(1200).describe("Context budget"),
      repo: z.string().optional().describe("Limit to one repository, e.g. design-system"),
      kind: z.enum(["guideline", "research", "component", "content"]).optional(),
    },
  },
  async ({ query, max_tokens, repo, kind }) =>
    instrumented("search_design_knowledge", async () => {
      const { ranked, cacheHit } = await retriever.rank(query, { repo, kind });
      const packed = retriever.pack(ranked, max_tokens);
      return {
        text: retriever.format(packed),
        tokensOut: packed.tokensUsed,
        budget: max_tokens,
        results: packed.selected.length,
        omitted: packed.omitted,
        cacheHit,
      };
    }),
);

server.registerTool(
  "get_document",
  {
    title: "Get full document",
    description: "Full text of one document by id. Use only when the search context is not enough.",
    inputSchema: { id: z.string().describe("Document id, e.g. button or color-palette") },
  },
  async ({ id }) =>
    instrumented("get_document", async () => {
      const doc = retriever.getDoc(id);
      if (!doc) throw new Error(`Unknown document "${id}". Use list_sources to see valid ids.`);
      const note = doc.supersededBy ? `\n\n> Superseded by \`${doc.supersededBy}\`.` : "";
      const text = `\`${doc.repo}/${doc.id}\` · ${doc.status} · updated ${doc.updated}${note}\n\n${doc.body.trim()}`;
      return { text, tokensOut: approxTokens(text) };
    }),
);

server.registerTool(
  "list_sources",
  {
    title: "List sources",
    description: "Every repository and document with owner unit, status and last update.",
    inputSchema: {},
  },
  async () =>
    instrumented("list_sources", async () => {
      const rows = retriever
        .listDocs()
        .sort((a, b) => a.repo.localeCompare(b.repo) || a.id.localeCompare(b.id))
        .map((d) => `| ${d.repo} | ${d.id} | ${d.unit} | ${d.status} | ${d.updated} |`);
      const text = ["| repo | id | unit | status | updated |", "| --- | --- | --- | --- | --- |", ...rows].join("\n");
      return { text, results: rows.length };
    }),
);

server.registerTool(
  "usage_stats",
  {
    title: "Usage stats",
    description: "Calls, latency p50/p95, tokens returned, budget utilization and cache hit rate per tool.",
    inputSchema: {},
  },
  async () => instrumented("usage_stats", async () => ({ text: JSON.stringify(summarize(), null, 2) })),
);

await server.connect(new StdioServerTransport());
