import { describe, it, expect } from "vitest";
import {
  supportToolDefinitions,
  INTERACTIVE_BLOCKED_SUPPORT_TOOLS,
  DESTRUCTIVE_TOOL_NAME_PREFIXES,
  DESTRUCTIVE_PREFIX_SAFE_EXCEPTIONS,
} from "../../server/ai/supportAgent";

/**
 * Interactive-lane blast-radius guard (completes the audit remedy for the
 * Phase-0 CRITICAL support-agent finding). The customer-driven support chat
 * must not be able to invoke operator-only destructive tools — most dangerously
 * `repair_orphaned_records` with dry_run:false, which deletes records. This
 * pins the denylist and enforces a default-deny rule for destructive-verb tools
 * so a NEW one can't silently reach a customer chat.
 */
const allToolNames = Object.values(supportToolDefinitions).map(
  (t) => (t as { name: string }).name,
);

describe("support interactive tool gate", () => {
  it("every blocked tool name is a real tool (no stale entries)", () => {
    for (const name of INTERACTIVE_BLOCKED_SUPPORT_TOOLS) {
      expect(allToolNames).toContain(name);
    }
  });

  it("blocks the known destructive/privileged operator tools", () => {
    // Regression anchors for the specific tools the audit flagged.
    for (const name of [
      "repair_orphaned_records",
      "invalidate_user_sessions",
      "apply_bulk_fix",
      "clear_org_cache",
      "resync_stripe",
    ]) {
      expect(INTERACTIVE_BLOCKED_SUPPORT_TOOLS).toContain(name);
    }
  });

  it("default-deny: any destructive-verb tool is blocked or a reviewed exception", () => {
    const blocked = new Set(INTERACTIVE_BLOCKED_SUPPORT_TOOLS);
    const exceptions = new Set(DESTRUCTIVE_PREFIX_SAFE_EXCEPTIONS);
    const offenders = allToolNames.filter(
      (name) =>
        DESTRUCTIVE_TOOL_NAME_PREFIXES.some((p) => name.startsWith(p)) &&
        !blocked.has(name) &&
        !exceptions.has(name),
    );
    // A new destructive-named tool must be consciously classified (blocked or
    // added to DESTRUCTIVE_PREFIX_SAFE_EXCEPTIONS with review) before it ships.
    expect(offenders).toEqual([]);
  });

  it("the safe payment-update tool is still offered (no over-reach)", () => {
    expect(INTERACTIVE_BLOCKED_SUPPORT_TOOLS).not.toContain("apply_billing_fix");
    expect(DESTRUCTIVE_PREFIX_SAFE_EXCEPTIONS).toContain("apply_billing_fix");
  });
});
