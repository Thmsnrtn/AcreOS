import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runGatedSelfPatch, type GitOps } from "../../server/services/autopilot/selfPatch";

const AUDIT = {
  vulnerabilities: {
    lodash: { severity: "high", fixAvailable: { name: "lodash", version: "4.17.21", isSemVerMajor: false } },
  },
};

function makeGit(over: Partial<GitOps> = {}): GitOps {
  return {
    audit: vi.fn().mockResolvedValue(AUDIT),
    createBranch: vi.fn().mockResolvedValue(undefined),
    runAuditFix: vi.fn().mockResolvedValue({ files: ["package.json", "package-lock.json"], depChanges: [{ name: "lodash", fromVersion: "4.17.20", toVersion: "4.17.21" }] }),
    commit: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
    openPr: vi.fn().mockResolvedValue("https://github.com/x/y/pull/1"),
    ...over,
  };
}

describe("selfPatch — the gated immune-system motor (D1)", () => {
  beforeEach(() => { process.env.SELF_PATCH_ENABLED = "true"; });
  afterEach(() => { delete process.env.SELF_PATCH_ENABLED; });

  it("does NOTHING when the env switch is off (hard gate)", async () => {
    delete process.env.SELF_PATCH_ENABLED;
    const git = makeGit();
    const r = await runGatedSelfPatch(git, true, "t1");
    expect(r.ran).toBe(false);
    expect(r.reason).toContain("off");
    expect(git.audit).not.toHaveBeenCalled();
  });

  it("does NOTHING until the domain has earned safe-class auto-PR", async () => {
    const git = makeGit();
    const r = await runGatedSelfPatch(git, false, "t1");
    expect(r.ran).toBe(false);
    expect(r.reason).toContain("earned");
    expect(git.createBranch).not.toHaveBeenCalled();
  });

  it("opens a PR (never merges) for a clean patch-only dependency fix", async () => {
    const git = makeGit();
    const r = await runGatedSelfPatch(git, true, "t1");
    expect(r.ran).toBe(true);
    expect(r.prUrl).toContain("/pull/1");
    expect(git.openPr).toHaveBeenCalledOnce();
    // It branched + pushed but there is NO merge method to call — PR only.
    expect(git.createBranch).toHaveBeenCalledWith("autopilot/security-patch-t1");
    expect(git.push).toHaveBeenCalledOnce();
    expect("merge" in git).toBe(false);
  });

  it("ABANDONS the auto-PR when the REAL diff isn't safe (touched a source file)", async () => {
    const git = makeGit({
      runAuditFix: vi.fn().mockResolvedValue({ files: ["package.json", "server/routes-billing.ts"], depChanges: [{ name: "lodash", fromVersion: "4.17.20", toVersion: "4.17.21" }] }),
    });
    const r = await runGatedSelfPatch(git, true, "t1");
    expect(r.ran).toBe(false);
    expect(r.reason).toContain("witnessed");
    expect(r.witnessedCount).toBe(1);
    expect(git.push).not.toHaveBeenCalled(); // never pushed an unsafe change
    expect(git.openPr).not.toHaveBeenCalled();
  });

  it("ABANDONS when the real diff is a non-patch (minor/major) bump", async () => {
    const git = makeGit({
      runAuditFix: vi.fn().mockResolvedValue({ files: ["package.json", "package-lock.json"], depChanges: [{ name: "lodash", fromVersion: "4.17.20", toVersion: "4.18.0" }] }),
    });
    const r = await runGatedSelfPatch(git, true, "t1");
    expect(r.ran).toBe(false);
    expect(git.openPr).not.toHaveBeenCalled();
  });

  it("no-ops when there are no auto-fixable advisories", async () => {
    const git = makeGit({ audit: vi.fn().mockResolvedValue({ vulnerabilities: {} }) });
    const r = await runGatedSelfPatch(git, true, "t1");
    expect(r.ran).toBe(false);
    expect(r.reason).toContain("no non-major");
  });

  it("never throws past its boundary (a git failure is non-fatal)", async () => {
    const git = makeGit({ runAuditFix: vi.fn().mockRejectedValue(new Error("git boom")) });
    const r = await runGatedSelfPatch(git, true, "t1");
    expect(r.ran).toBe(false);
    expect(r.reason).toContain("git boom");
  });
});
