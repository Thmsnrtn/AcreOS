/**
 * Cross-build navigation (P1-9 / X-2).
 *
 * The customer and founder bundles are separate Vite outputs, and wouter cannot
 * navigate between them: a link or redirect into the OTHER build's path has to
 * become a full page load, and that hand-off must never become a reload loop.
 * client/src/lib/cross-build.ts decides and performs it; pages/not-found.tsx and
 * components/cross-build-redirect.tsx are its two call sites.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { crossesBuilds, buildOwning, handOffToOtherBuild } from "@/lib/cross-build";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");

describe("which build owns a path", () => {
  it("founder paths belong to the founder build, everything else to the customer's", () => {
    for (const p of ["/founder", "/founder/decisions", "/dunning", "/job-health", "/admin/safety-gates"]) {
      expect(buildOwning(p), p).toBe("founder");
    }
    for (const p of ["/", "/today", "/auth", "/commissions", "/founder-dashboard", "/admin/beta"]) {
      expect(buildOwning(p), p).toBe("customer");
    }
  });

  it("a navigation crosses builds exactly when the owner differs from the current build", () => {
    expect(crossesBuilds("/founder/decisions", "customer")).toBe(true);
    expect(crossesBuilds("/today", "customer")).toBe(false);
    expect(crossesBuilds("/today", "founder")).toBe(true);
    expect(crossesBuilds("/auth", "founder")).toBe(true);
    expect(crossesBuilds("/founder/decisions", "founder")).toBe(false);
    expect(crossesBuilds("/dunning", "founder")).toBe(false);
  });

  it("a non-app target (absolute URL, mailto) is not ours to hand off", () => {
    expect(crossesBuilds("https://example.com/founder", "customer")).toBe(false);
    expect(crossesBuilds("mailto:a@b.co", "founder")).toBe(false);
  });
});

describe("the hand-off is a full page load with a loop guard", () => {
  const replace = vi.fn();
  const store = new Map<string, string>();

  beforeEach(() => {
    replace.mockClear();
    store.clear();
    vi.stubGlobal("window", { location: { replace } });
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("replaces the current history entry (Back returns to the page the user came from)", () => {
    expect(handOffToOtherBuild("/founder/decisions")).toBe(true);
    expect(replace).toHaveBeenCalledExactlyOnceWith("/founder/decisions");
  });

  it("refuses to repeat the same hand-off within the window — a wrong-shell deploy must not reload forever", () => {
    expect(handOffToOtherBuild("/founder/decisions")).toBe(true);
    expect(handOffToOtherBuild("/founder/decisions")).toBe(false);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("a different target is a different hand-off", () => {
    expect(handOffToOtherBuild("/founder/decisions")).toBe(true);
    expect(handOffToOtherBuild("/founder/letter")).toBe(true);
    expect(replace).toHaveBeenCalledTimes(2);
  });

  it("still hands off once when sessionStorage is unavailable", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    expect(handOffToOtherBuild("/today")).toBe(true);
    expect(replace).toHaveBeenCalledWith("/today");
  });
});

describe("both builds wire the hand-off", () => {
  const code = (rel: string) => stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));

  it("the last route of BOTH route trees is NotFound, and NotFound hands off the other build's paths", () => {
    expect(code("client/src/App.tsx")).toContain("<Route component={NotFound} />");
    expect(code("client/src/founder-routes.tsx")).toContain("<Route component={NotFound} />");
    const nf = code("client/src/pages/not-found.tsx");
    expect(nf).toContain("crossesBuilds(location)");
    expect(nf).toContain("HardNavigate");
  });

  it("both route trees take Redirect from the cross-build module, not wouter", () => {
    for (const f of ["client/src/App.tsx", "client/src/founder-routes.tsx", "client/src/components/founder-protected-route.tsx"]) {
      const src = code(f);
      expect(src, `${f} imports Redirect from the cross-build module`).toMatch(
        /import \{ Redirect[^}]*\} from "@\/components\/cross-build-redirect"/,
      );
      expect(src, `${f} still takes Redirect from wouter — a founder redirect would stay in one bundle`).not.toMatch(
        /import \{[^}]*\bRedirect\b[^}]*\} from "wouter"/,
      );
    }
  });

  it("the build sets VITE_ACREOS_BUILD per output, so each bundle knows which one it is", () => {
    const vite = code("vite.config.ts");
    expect(vite).toContain('"import.meta.env.VITE_ACREOS_BUILD": JSON.stringify(output)');
    expect(code("vite.founder.config.ts")).toContain('buildConfig("founder")');
  });
});
