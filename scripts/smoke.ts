/** End-to-end check: start the MCP server over stdio, call every tool like an agent would. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { ROOT } from "../src/paths.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", path.join(ROOT, "src", "server.ts")],
  cwd: ROOT,
  stderr: "inherit",
});
const client = new Client({ name: "smoke-test", version: "0.1.0" });
await client.connect(transport);

const text = (r: Awaited<ReturnType<typeof client.callTool>>) =>
  (r.content as { type: string; text: string }[]).map((c) => c.text).join("\n");

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

for (const args of [
  { query: "What corner radius should the Lending team use for buttons?", max_tokens: 600 },
  { query: "Which purple is our primary color?", max_tokens: 400 },
]) {
  console.log(`\n=== search_design_knowledge ${JSON.stringify(args)}\n`);
  console.log(text(await client.callTool({ name: "search_design_knowledge", arguments: args })));
}

console.log("\n=== get_document color-palette-2024\n");
console.log(text(await client.callTool({ name: "get_document", arguments: { id: "color-palette-2024" } })));

console.log("\n=== usage_stats\n");
console.log(text(await client.callTool({ name: "usage_stats", arguments: {} })));
await client.close();
