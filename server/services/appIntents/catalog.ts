/**
 * Tahoe E8 — App Intent catalog.
 *
 * Registers every customer-facing intent into the App Intent registry. Each
 * entry tags an existing Pax tool with the customer-nav door it lives behind
 * and the permission-ladder scope it requires, then reuses:
 *   - the legacy `toolDefinitions[name].parameters` as its canonical input
 *     schema (raw JSON-schema → guarantees Pax sees byte-identical parameters
 *     to the pre-registry list), and
 *   - the legacy `executeTool` as its handler.
 *
 * This is the migration of ALL existing Pax tools into the registry. New
 * intents (or external-agent-only intents) can instead pass a zod `inputSchema`
 * — the registry converts it to JSON-Schema / Anthropic input_schema via the
 * shared zod→json-schema util.
 *
 * Importing this module performs the registration as a side effect. It is
 * imported by server/services/appIntents/index.ts which is the single mount
 * point the Pax loop reads.
 */
import { toolDefinitions, executeTool, APPROVAL_REQUIRED_TOOLS } from "../../ai/tools";
import type { Scope } from "../../middleware/roleScope";
import { registerIntent, type CustomerDoor } from "./registry";
import { INTENT_META } from "./intentScopes";

/**
 * Door + scope per tool now live in `./intentScopes`, so `ai/tools.ts` can
 * enforce the scope at the tool chokepoint without importing this module (which
 * imports `executeTool` from it, and would be a cycle). One table, two readers.
 */


/**
 * Register every tool in toolDefinitions as an App Intent. Any tool missing
 * from INTENT_META is registered with a safe default (deals door, deal_read
 * scope) and flagged — this keeps the registry exhaustive even if a new tool
 * is added to toolDefinitions without an explicit door mapping.
 */
let registered = false;

export function registerAllIntents(): void {
  if (registered) return;
  registered = true;

  for (const [name, def] of Object.entries(toolDefinitions)) {
    const meta = INTENT_META[name] ?? { door: "deals" as CustomerDoor, scope: "deal_read" as Scope };
    registerIntent({
      name: def.name ?? name,
      description: def.description ?? "",
      door: meta.door,
      requiredScope: meta.scope,
      approvalRequired: APPROVAL_REQUIRED_TOOLS.has(name),
      // Reuse the legacy JSON-schema parameters verbatim → byte-parity for Pax.
      inputSchema: (def.parameters ?? { type: "object", properties: {} }) as Record<string, unknown>,
      handler: (args, org) => executeTool(name, args, org),
    });
  }
}
