/**
 * Tahoe E8 — App Intent Registry.
 *
 * A single typed catalog of customer-facing "intents". Each intent is one
 * capability the product exposes, described once and invokable from MULTIPLE
 * surfaces:
 *
 *   1. Pax tool-use     — the customer AI agent loop (server/ai/executive.ts)
 *      reads its tool list FROM this registry, so adding an intent here
 *      automatically exposes it to Pax. No second hand-maintained list.
 *   2. Command palette / quick-action surfaces — `listIntents()` returns the
 *      catalog grouped by the five customer-nav doors.
 *   3. External agents (future) — `getAnthropicToolDefinitions()` emits the
 *      Anthropic `input_schema` tool shape; `getOpenAIToolDefinitions()` emits
 *      the OpenAI/OpenRouter `function` shape. Both are DERIVED from the same
 *      registry entries, never duplicated.
 *
 * Each intent declares:
 *   - name          stable identifier (matches the executeTool switch case)
 *   - description    what it does + when to call it (drives Pax tool selection)
 *   - door           the customer-nav door it belongs to (five-door model)
 *   - requiredScope  permission-ladder scope (server/middleware/roleScope.ts),
 *                    or null for read-only/no-gate intents
 *   - approvalRequired  whether the action needs explicit user approval
 *   - inputSchema    canonical input schema: a zod schema, OR a raw JSON-schema
 *                    object for intents migrated verbatim from the legacy
 *                    toolDefinitions (guarantees byte-parity with the old list).
 *   - handler        async executor (org-scoped).
 *
 * The customer-nav door model (CLAUDE.md): exactly five doors —
 *   Today · Map · Deals · Finance · Pax  (+ Inbox, Settings).
 * Every intent is tagged with the door its capability lives behind. Intents
 * never add a sixth door; they live behind one of these.
 */
import type { z } from "zod";
import type { Organization } from "@shared/schema";
import type { Scope } from "../../middleware/roleScope";
import { zodToJsonSchema } from "../../utils/zodToJsonSchema";

/** The five fixed customer-nav doors (plus the two top-bar surfaces). */
export type CustomerDoor =
  | "today"
  | "map"
  | "deals"
  | "finance"
  | "pax"
  | "inbox"
  | "settings";

export interface IntentResult {
  success: boolean;
  data?: any;
  error?: string;
}

export type IntentHandler = (
  args: Record<string, any>,
  org: Organization,
) => Promise<IntentResult>;

/**
 * Canonical input schema for an intent. Either a zod schema (preferred for new
 * intents — gives type inference + runtime validation) or a raw JSON-schema
 * object (used for the legacy tools migrated from toolDefinitions so the
 * parameters reach Pax byte-identical to before).
 */
export type IntentInputSchema = z.ZodTypeAny | Record<string, unknown>;

export interface AppIntent {
  name: string;
  description: string;
  door: CustomerDoor;
  requiredScope: Scope | null;
  approvalRequired: boolean;
  inputSchema: IntentInputSchema;
  handler: IntentHandler;
}

const REGISTRY = new Map<string, AppIntent>();

function isZodSchema(s: IntentInputSchema): s is z.ZodTypeAny {
  return typeof (s as any)?._def === "object" && (s as any)?._def != null;
}

/** Resolve an intent's input schema to a JSON-Schema object. */
export function resolveInputSchema(intent: AppIntent): Record<string, unknown> {
  if (isZodSchema(intent.inputSchema)) {
    return zodToJsonSchema(intent.inputSchema);
  }
  return intent.inputSchema as Record<string, unknown>;
}

/** Register one intent. Throws on duplicate name (catches copy-paste drift). */
export function registerIntent(intent: AppIntent): void {
  if (REGISTRY.has(intent.name)) {
    throw new Error(`[appIntents] duplicate intent name: ${intent.name}`);
  }
  REGISTRY.set(intent.name, intent);
}

export function getIntent(name: string): AppIntent | undefined {
  return REGISTRY.get(name);
}

export function listIntents(filter?: {
  door?: CustomerDoor;
  approvalRequired?: boolean;
}): AppIntent[] {
  const all = Array.from(REGISTRY.values());
  if (!filter) return all;
  return all.filter(
    (i) =>
      (filter.door == null || i.door === filter.door) &&
      (filter.approvalRequired == null ||
        i.approvalRequired === filter.approvalRequired),
  );
}

export function intentNames(): string[] {
  return Array.from(REGISTRY.keys());
}

/** Intents grouped by their customer-nav door — for the command palette. */
export function intentsByDoor(): Record<CustomerDoor, AppIntent[]> {
  const grouped = {
    today: [], map: [], deals: [], finance: [], pax: [], inbox: [], settings: [],
  } as Record<CustomerDoor, AppIntent[]>;
  for (const intent of REGISTRY.values()) {
    grouped[intent.door].push(intent);
  }
  return grouped;
}

// ─── Derived tool-definition projections (single source of truth) ────────────

/**
 * Anthropic / Claude tool definitions, DERIVED from the registry.
 * Shape: { name, description, input_schema } — the Messages API tool shape.
 */
export function getAnthropicToolDefinitions(
  names?: string[],
): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  return selectIntents(names).map((intent) => ({
    name: intent.name,
    description: intent.description,
    input_schema: resolveInputSchema(intent),
  }));
}

/**
 * OpenAI / OpenRouter tool definitions, DERIVED from the registry.
 * Shape: { type: "function", function: { name, description, parameters } }.
 * This is what the Pax loop (OpenAI SDK → OpenRouter) consumes.
 */
export function getOpenAIToolDefinitions(
  names?: string[],
): Array<{
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return selectIntents(names).map((intent) => ({
    type: "function" as const,
    function: {
      name: intent.name,
      description: intent.description,
      parameters: resolveInputSchema(intent),
    },
  }));
}

function selectIntents(names?: string[]): AppIntent[] {
  if (!names) return Array.from(REGISTRY.values());
  const out: AppIntent[] = [];
  for (const n of names) {
    const intent = REGISTRY.get(n);
    if (intent) out.push(intent);
  }
  return out;
}

/** Test-only reset. NEVER call in production. */
export function __resetIntentRegistryForTests(): void {
  REGISTRY.clear();
}
