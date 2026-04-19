import { readFile } from 'node:fs/promises';
import type { PersonaConfig } from './types.js';

// ── Frontmatter Parser ──────────────────────────────────────────────────────

/**
 * Split a markdown file with YAML frontmatter into { frontmatter, body }.
 * Expects the file to start with `---` and have a closing `---`.
 */
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
 * Minimal YAML parser that handles the flat key-value + list structures
 * used in persona frontmatter. Handles:
 * - scalar values: `key: value`
 * - inline arrays: `key: [a, b, c]`
 * - block sequences: `key:\n  - item1\n  - item2`
 * - nested objects (single level): `key:\n  subkey: value`
 */
function parseYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines and comments
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

    // Inline array: [a, b, c]
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1);
      result[key] = inner
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      i++;
      continue;
    }

    // Inline object: { key: value, key2: value2 }
    if (value.startsWith('{') && value.endsWith('}')) {
      const inner = value.slice(1, -1);
      const obj: Record<string, unknown> = {};
      for (const pair of inner.split(',')) {
        const [k, ...vParts] = pair.split(':');
        if (k && vParts.length > 0) {
          const v = vParts.join(':').trim();
          obj[k.trim()] = isNaN(Number(v)) ? v : Number(v);
        }
      }
      result[key] = obj;
      i++;
      continue;
    }

    // Value present on same line — scalar
    if (value) {
      result[key] = value;
      i++;
      continue;
    }

    // No value on this line — look for block sequence or nested object
    const items: string[] = [];
    const nestedObj: Record<string, unknown> = {};
    let isSequence = false;
    let isObject = false;
    i++;

    while (i < lines.length) {
      const nextLine = lines[i];
      if (!nextLine.trim()) {
        i++;
        continue;
      }
      // Check indentation — must be indented under the key
      if (!nextLine.match(/^\s+/)) {
        break;
      }
      const trimmedNext = nextLine.trim();
      if (trimmedNext.startsWith('- ')) {
        isSequence = true;
        items.push(trimmedNext.slice(2).trim());
        i++;
      } else if (trimmedNext.includes(':')) {
        isObject = true;
        const [nk, ...nvParts] = trimmedNext.split(':');
        const nv = nvParts.join(':').trim();
        nestedObj[nk.trim()] = isNaN(Number(nv)) ? nv : Number(nv);
        i++;
      } else {
        break;
      }
    }

    if (isSequence) {
      result[key] = items;
    } else if (isObject) {
      result[key] = nestedObj;
    } else {
      result[key] = '';
    }
  }

  return result;
}

// ── Persona Loader ──────────────────────────────────────────────────────────

/**
 * Load a persona .md file and return a typed PersonaConfig.
 */
export async function loadPersona(filePath: string): Promise<PersonaConfig> {
  const raw = await readFile(filePath, 'utf-8');
  return parsePersona(raw);
}

/**
 * Parse persona content (useful when content is already loaded).
 */
export function parsePersona(content: string): PersonaConfig {
  const { frontmatter, body } = splitFrontmatter(content);
  const data = parseYaml(frontmatter);

  // Normalize viewport
  let viewport = { width: 1280, height: 720 };
  if (data.viewport && typeof data.viewport === 'object') {
    const vp = data.viewport as Record<string, unknown>;
    viewport = {
      width: typeof vp.width === 'number' ? vp.width : 1280,
      height: typeof vp.height === 'number' ? vp.height : 720,
    };
  }

  // Normalize assigned_journeys — ensure string array
  const rawJourneys = data.assigned_journeys;
  const assignedJourneys: string[] = Array.isArray(rawJourneys)
    ? rawJourneys.map(String)
    : [];

  return {
    id: String(data.id ?? ''),
    name: String(data.name ?? ''),
    age: Number(data.age ?? 0),
    location: String(data.location ?? ''),
    yearsInvesting: String(data.years_investing ?? data.yearsInvesting ?? ''),
    capitalAvailable: String(data.capital_available ?? data.capitalAvailable ?? ''),
    investmentThesis: String(data.investment_thesis ?? data.investmentThesis ?? ''),
    sourceOfInterest: String(data.source_of_interest ?? data.sourceOfInterest ?? ''),
    techComfort: String(data.tech_comfort ?? data.techComfort ?? ''),
    patience: String(data.patience ?? ''),
    preferredDevice: String(data.preferred_device ?? data.preferredDevice ?? ''),
    competitorMentalModel: String(data.competitor_mental_model ?? data.competitorMentalModel ?? ''),
    assignedJourneys,
    viewport,
    successCriteria: Array.isArray(data.success_criteria)
      ? data.success_criteria.map(String)
      : [],
    abandonmentTriggers: Array.isArray(data.abandonment_triggers)
      ? data.abandonment_triggers.map(String)
      : [],
    backstory: body,
  };
}
