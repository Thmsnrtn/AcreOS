import { describe, it, expect } from "vitest";
import {
  GOVERNANCE_CONTROLS,
  summarizeControlCatalog,
  renderControlCatalogMarkdown,
  type ControlKind,
} from "../../server/services/governance/controlCatalog";

/**
 * Frontier #14 — the control catalog is the auditable map of every governance
 * control. These tests pin two things: (1) NOTHING fails open (the headline
 * safety claim), and (2) the catalog COVERS the whole gate stack (a new gate
 * can't ship uncatalogued).
 */
describe("governance control catalog", () => {
  it("THE HEADLINE INVARIANT: no control fails OPEN", () => {
    const s = summarizeControlCatalog();
    expect(s.failOpen).toEqual([]);
    // every gate + switch must fail closed (invariants/audits are n/a)
    for (const c of GOVERNANCE_CONTROLS) {
      if (c.kind === "gate" || c.kind === "switch") expect(c.failMode).toBe("closed");
    }
  });

  it("covers the FULL gate stack — a new gate can't ship uncatalogued", () => {
    const ids = new Set(GOVERNANCE_CONTROLS.map((c) => c.id));
    for (const required of [
      "compliance_gate",
      "eval_gate",
      "budget_gate",
      "domain_autonomy_gate",
      "risk_gate",
      "witnessed_send",
    ]) {
      expect(ids.has(required)).toBe(true);
    }
  });

  it("covers the master switches + the kill switch", () => {
    const ids = new Set(GOVERNANCE_CONTROLS.map((c) => c.id));
    expect(ids.has("panic_stop")).toBe(true);
    expect(ids.has("dispatch_enabled")).toBe(true);
    expect(ids.has("publish_enabled")).toBe(true);
  });

  it("names the sacred learning invariant + the offline-verifiable receipt chain", () => {
    const ids = new Set(GOVERNANCE_CONTROLS.map((c) => c.id));
    expect(ids.has("learning_never_fabricates")).toBe(true);
    expect(ids.has("proof_receipt_chain")).toBe(true);
  });

  it("summary counts every kind and has unique ids", () => {
    const s = summarizeControlCatalog();
    expect(s.total).toBe(GOVERNANCE_CONTROLS.length);
    const kinds: ControlKind[] = ["gate", "switch", "invariant", "audit"];
    expect(kinds.reduce((n, k) => n + s.byKind[k], 0)).toBe(s.total);
    expect(new Set(GOVERNANCE_CONTROLS.map((c) => c.id)).size).toBe(GOVERNANCE_CONTROLS.length);
  });

  it("renders a Markdown table with a row per control", () => {
    const md = renderControlCatalogMarkdown();
    expect(md).toMatch(/# AcreOS Governance Control Catalog/);
    expect(md).toMatch(/\| id \| control \| kind \| fail-mode \|/);
    for (const c of GOVERNANCE_CONTROLS) expect(md).toContain(`| ${c.id} |`);
  });
});
