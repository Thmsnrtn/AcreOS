import { describe, it, expect, vi } from "vitest";
import { classifyCodeChange, isPatchBump } from "../../server/services/autopilot/codeChangeGate";
import { parseAudit, autoFixCandidates, actionableCandidates } from "../../server/services/autopilot/dependencyAudit";
import { planSecurityResponse, immuneSystemLine } from "../../server/services/autopilot/immuneSystem";
import { errorSignature, topErrorSignatures, investigationBrief, runIncidentTriage } from "../../server/services/autopilot/rootCause";

// Gate the incident-triage motor OFF for this assertion (master switch off) —
// it must no-op before touching the DB or enqueueing anything.
vi.mock("../../server/services/autopilot/settings", () => ({
  isDispatchEnabled: vi.fn().mockResolvedValue(false),
}));

describe("codeChangeGate — the immune system's guardrail (conservative)", () => {
  it("FORBIDS touching the constitution / security gate / the guardrail itself", () => {
    for (const f of [
      "shared/immutables.json",
      "server/services/solene/constitutionalGuard.ts",
      ".github/workflows/security.yml",
      ".github/workflows/deploy.yml",
      "server/services/autopilot/codeChangeGate.ts",
      "server/auth.ts",
      "server/services/approvalKernel.ts",
      "server/services/autopilot/pendingHands.ts",
    ]) {
      expect(classifyCodeChange({ files: [f] }).class, f).toBe("forbidden");
    }
  });

  it("FORBIDS the whole gate estate (F3 eternal lines): ratchets, statutes, tests, ALL workflows, the tamper watch", () => {
    // The original list covered only the security + deploy workflows and no
    // ratchet estate at all — the immune system could in principle have
    // auto-touched a baseline JSON, a governance registry, or a unit test and
    // weakened a gate without tripping "forbidden". Now the entire gate
    // estate is off-limits.
    for (const f of [
      ".github/workflows/ci.yml",
      ".github/workflows/test.yml",
      "scripts/ratchet.mjs",
      "scripts/ratchets/res-status-raw.json",
      "scripts/ratchets/run-scheduled-jobs-linecount.json",
      "scripts/regenerate-gate-manifest.mjs", // the manifest's only sanctioned writer
      "shared/governance/statuteRegister.ts",
      "shared/governance/constitution.ts",
      "tests/unit/constitution.test.ts",
      "tests/unit/moneyCustodyHardStop.test.ts",
      "server/services/autopilot/gateTamperWatch.ts",
      "server/services/autopilot/gateTamperManifest.json",
    ]) {
      expect(classifyCodeChange({ files: [f] }).class, f).toBe("forbidden");
    }
  });

  it("allows safe_auto ONLY for a clean dependency patch bump touching only package files", () => {
    const v = classifyCodeChange({
      files: ["package.json", "package-lock.json"],
      depChanges: [{ name: "lodash", fromVersion: "4.17.20", toVersion: "4.17.21" }],
    });
    expect(v.class).toBe("safe_auto");
  });

  it("downgrades to witnessed when a dep bump is minor or major (not patch)", () => {
    expect(classifyCodeChange({ files: ["package.json", "package-lock.json"], depChanges: [{ name: "x", fromVersion: "1.2.0", toVersion: "1.3.0" }] }).class).toBe("witnessed");
    expect(classifyCodeChange({ files: ["package.json", "package-lock.json"], depChanges: [{ name: "x", fromVersion: "1.2.0", toVersion: "2.0.0" }] }).class).toBe("witnessed");
  });

  it("witnesses any source/config change, and an empty change", () => {
    expect(classifyCodeChange({ files: ["server/routes-billing.ts"] }).class).toBe("witnessed");
    expect(classifyCodeChange({ files: ["package.json", "src/app.ts"], depChanges: [{ name: "x", fromVersion: "1.0.0", toVersion: "1.0.1" }] }).class).toBe("witnessed"); // touches a non-package file
    expect(classifyCodeChange({ files: [] }).class).toBe("witnessed");
  });

  it("isPatchBump is strict (same major.minor, patch strictly greater)", () => {
    expect(isPatchBump("1.2.3", "1.2.4")).toBe(true);
    expect(isPatchBump("1.2.3", "1.2.3")).toBe(false); // no real upgrade
    expect(isPatchBump("1.2.3", "1.3.0")).toBe(false);
    expect(isPatchBump("1.2.3", "2.2.4")).toBe(false);
    expect(isPatchBump("^1.2.3", "1.2.5")).toBe(true); // tolerates a range prefix
  });
});

describe("dependencyAudit — parse npm audit --json (pure, tolerant)", () => {
  const audit = {
    vulnerabilities: {
      lodash: { severity: "high", fixAvailable: { name: "lodash", version: "4.17.21", isSemVerMajor: false } },
      minimist: { severity: "critical", fixAvailable: { name: "minimist", version: "2.0.0", isSemVerMajor: true } },
      leftpad: { severity: "low", fixAvailable: false },
    },
  };

  it("summarizes counts by severity", () => {
    const s = parseAudit(audit);
    expect(s.total).toBe(3);
    expect(s.bySeverity.high).toBe(1);
    expect(s.bySeverity.critical).toBe(1);
  });

  it("auto-fix candidates exclude major + no-fix advisories", () => {
    const names = autoFixCandidates(parseAudit(audit)).map((c) => c.name);
    expect(names).toEqual(["lodash"]);
  });

  it("actionable = high/critical", () => {
    expect(actionableCandidates(parseAudit(audit)).map((c) => c.name).sort()).toEqual(["lodash", "minimist"]);
  });

  it("degrades to empty on junk input", () => {
    expect(parseAudit(null).total).toBe(0);
    expect(parseAudit({ nope: 1 }).total).toBe(0);
  });
});

describe("immuneSystem — gated repair plan (cold-start safe)", () => {
  const summary = parseAudit({
    vulnerabilities: {
      lodash: { severity: "high", fixAvailable: { name: "lodash", version: "4.17.21", isSemVerMajor: false } },
      minimist: { severity: "critical", fixAvailable: { name: "minimist", version: "2.0.0", isSemVerMajor: true } },
      leftpad: { severity: "low", fixAvailable: false },
    },
  });

  it("routes EVERYTHING to the founder when auto-PR autonomy is not yet earned", () => {
    const plan = planSecurityResponse(summary, false);
    expect(plan.autoCount).toBe(0);
    expect(plan.items.find((i) => i.name === "lodash")?.action).toBe("witnessed");
  });

  it("auto-fixes the non-major class ONLY once autonomy is earned; breaking high/critical still witnessed", () => {
    const plan = planSecurityResponse(summary, true);
    expect(plan.items.find((i) => i.name === "lodash")?.action).toBe("auto_pr");
    expect(plan.items.find((i) => i.name === "minimist")?.action).toBe("witnessed"); // major fix for a critical → founder
    expect(plan.items.find((i) => i.name === "leftpad")?.action).toBe("skip");
  });

  it("renders a letter line", () => {
    expect(immuneSystemLine(planSecurityResponse(summary, true))).toContain("auto-fixable");
  });
});

describe("rootCause — error signatures + investigation brief (pure)", () => {
  it("collapses volatile parts so the same bug shares one signature", () => {
    const a = errorSignature("user 4821 not found at /app/server/x.ts");
    const b = errorSignature("user 9930 not found at /app/server/y.ts");
    expect(a).toBe(b);
  });

  it("ranks the loudest signature first", () => {
    const groups = topErrorSignatures([
      { message: "null id 1" },
      { message: "null id 2" },
      { message: "timeout 5000" },
    ]);
    expect(groups[0].count).toBe(2);
  });

  it("the investigation brief forbids deploy + asks for a risk class", () => {
    const brief = investigationBrief({ signature: "x", count: 7, sample: "boom" });
    expect(brief).toContain("do not deploy");
    expect(brief.toLowerCase()).toContain("risk class");
  });
});

describe("rootCause — incident triage is gated behind the dispatch master switch", () => {
  it("no-ops (no DB, no enqueue) when dispatch is disabled", async () => {
    const r = await runIncidentTriage();
    expect(r.enqueued).toBe(false);
    expect(r.reason).toBe("dispatch disabled");
  });
});
