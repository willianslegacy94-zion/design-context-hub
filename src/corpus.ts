import fs from "node:fs";
import path from "node:path";
import { approxTokens } from "./text.js";

export type Status = "canonical" | "draft" | "superseded";

export interface DocMeta {
  id: string;
  repo: string;
  title: string;
  kind: string;
  unit: string;
  status: Status;
  updated: string;
  supersedes?: string;
  /** Filled at ingest: the canonical doc that replaces this one, if any. */
  supersededBy?: string;
}

export interface Doc extends DocMeta {
  body: string;
}

export interface Chunk {
  id: string;
  docId: string;
  section: string;
  /** Contextual header + section text. Embedded and searched as one unit. */
  text: string;
  tokens: number;
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: match[2] };
}

/** Each sub-folder of the corpus is one "local repository" owned by a team. */
export function loadCorpus(dir: string): Doc[] {
  const docs: Doc[] = [];
  for (const repo of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!repo.isDirectory()) continue;
    for (const file of fs.readdirSync(path.join(dir, repo.name))) {
      if (!file.endsWith(".md")) continue;
      const { meta, body } = parseFrontmatter(fs.readFileSync(path.join(dir, repo.name, file), "utf8"));
      const id = file.replace(/\.md$/, "");
      docs.push({
        id,
        repo: repo.name,
        title: meta.title ?? id,
        kind: meta.kind ?? "unknown",
        unit: meta.unit ?? "unknown",
        status: (meta.status as Status) ?? "draft",
        updated: meta.updated ?? "unknown",
        supersedes: meta.supersedes,
        body,
      });
    }
  }
  // Resolve the reverse link so a stale doc can point readers to its replacement.
  for (const doc of docs) {
    if (doc.supersedes) {
      const old = docs.find((d) => d.id === doc.supersedes);
      if (old) old.supersededBy = doc.id;
    }
  }
  return docs;
}

/**
 * Split by "## " sections. Every chunk carries a contextual header
 * (repo / title / section) so it still makes sense when retrieved alone.
 */
export function chunkDoc(doc: Doc): Chunk[] {
  const parts = doc.body.split(/^## /m).slice(1);
  return parts.map((part, i) => {
    const [heading, ...rest] = part.split(/\r?\n/);
    const section = heading.trim();
    const text = `${doc.title} — ${section} (${doc.repo})\n${rest.join("\n").trim()}`;
    return { id: `${doc.id}#${i}`, docId: doc.id, section, text, tokens: approxTokens(text) };
  });
}
