import { readFile } from 'node:fs/promises';
import type { JourneyConfig } from './types.js';

// ── Frontmatter Parser ──────────────────────────────────────────────────────

function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('---')) {
    return { frontmatter: '', body: raw };
  }

  const endIndex = trimmed.indexOf('\n---', 3);
  if (endIndex === -1) {
    return { frontmatter: '', body: raw };
  }

  const frontmatter = trimmed.slice(4, endIndex).trim();
  const body = trimmed.slice(endIndex + 4).trim();
  return { frontmatter, body };
}

/**
 * Minimal YAML parser for journey frontmatter.
 * Handles scalar values, inline arrays, and block sequences.
 */
function parseYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim() || line.trim().startsWith('#')) {
      i++;
      continue;
    }

    const match = line.match(/^(\w[\w_-]*)\s*:\s*(.*)/);
    if (!match) {
      i++;
      continue;
    }

    const key = match[1];
    let value = match[2].trim();

    // Inline array
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1);
      result[key] = inner
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      i++;
      continue;
    }

    // Scalar value on same line
    if (value) {
      result[key] = value;
      i++;
      continue;
    }

    // Block sequence (indented list items)
    const items: string[] = [];
    i++;

    while (i < lines.length) {
      const nextLine = lines[i];
      if (!nextLine.trim()) {
        i++;
        continue;
      }
      if (!nextLine.match(/^\s+/)) {
        break;
      }
      const trimmedNext = nextLine.trim();
      if (trimmedNext.startsWith('- ')) {
        items.push(trimmedNext.slice(2).trim());
        i++;
      } else {
        break;
      }
    }

    if (items.length > 0) {
      result[key] = items;
    } else {
      result[key] = '';
    }
  }

  return result;
}

// ── Journey Loader ──────────────────────────────────────────────────────────

/**
 * Load a journey .md file and return a typed JourneyConfig.
 */
export async function loadJourney(filePath: string): Promise<JourneyConfig> {
  const raw = await readFile(filePath, 'utf-8');
  return parseJourney(raw);
}

/**
 * Parse journey content (useful when content is already loaded).
 */
export function parseJourney(content: string): JourneyConfig {
  const { frontmatter, body } = splitFrontmatter(content);
  const data = parseYaml(frontmatter);

  const maxSteps = parseInt(
    String(
      data.max_steps ??
        data.maxSteps ??
        process.env.MAX_STEPS_PER_JOURNEY ??
        '150',
    ),
    10,
  );

  const timeoutMinutes = parseInt(
    String(data.timeout_minutes ?? data.timeoutMinutes ?? '30'),
    10,
  );

  return {
    id: String(data.id ?? ''),
    name: String(data.name ?? ''),
    description: String(data.description ?? ''),
    startUrl: String(data.start_url ?? data.startUrl ?? ''),
    maxSteps: isNaN(maxSteps) ? 150 : maxSteps,
    timeoutMinutes: isNaN(timeoutMinutes) ? 30 : timeoutMinutes,
    successConditions: Array.isArray(data.success_conditions)
      ? data.success_conditions.map(String)
      : Array.isArray(data.successConditions)
        ? (data.successConditions as unknown[]).map(String)
        : [],
    body,
  };
}
