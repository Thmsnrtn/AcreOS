import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// ── Knowledge Loader ────────────────────────────────────────────────────────

/**
 * Read all .md files from a knowledge directory and return their contents
 * as an array of strings, each prefixed with the filename as a heading.
 *
 * These are concatenated into the Claude system prompt for domain context.
 */
export async function loadKnowledge(
  knowledgeDir: string,
): Promise<string[]> {
  const entries = await readdir(knowledgeDir, { withFileTypes: true });

  const mdFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .sort((a, b) => a.name.localeCompare(b.name));

  const contents: string[] = [];

  for (const file of mdFiles) {
    const filePath = join(knowledgeDir, file.name);
    const raw = await readFile(filePath, 'utf-8');

    // Prefix with filename-derived heading for clarity in Claude's context
    const heading = file.name
      .replace(/\.md$/, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

    contents.push(`## ${heading}\n\n${raw.trim()}`);
  }

  return contents;
}

/**
 * Load knowledge files and return as a single concatenated string.
 * Useful when you need the full context as one blob.
 */
export async function loadKnowledgeAsString(
  knowledgeDir: string,
): Promise<string> {
  const parts = await loadKnowledge(knowledgeDir);
  return parts.join('\n\n---\n\n');
}
