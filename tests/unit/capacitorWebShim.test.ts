/**
 * The web builds ship a shim for @capacitor/core instead of the runtime
 * (bundle offset BD-4, ridden in-PR by the notes decision desk, Step 0
 * N3+N4), and a native build still links the real core.
 *
 * The premise is read from the code, not assumed:
 *   - exactly two client modules statically import @capacitor/core —
 *     lib/platform.ts and lib/haptics.ts — and between them they call
 *     exactly two members: isNativePlatform() and getPlatform();
 *   - on web the real core's answers are constants (no native bridge):
 *     isNativePlatform() === false, getPlatform() === "web". The shim
 *     returns exactly those, so web behaviour cannot change;
 *   - every @capacitor PLUGIN is dynamically imported (behind the isNative
 *     gate in the hooks/haptics layer), so no plugin module is statically
 *     bound to the shim.
 *
 * The fence: ACREOS_NATIVE_BUILD=1 removes the vite alias, and every
 * mobile:* script sets it — a native shell that reported itself as "web"
 * would be a silent platform-detection break, so both halves are pinned.
 * Mutation: drop the env prefix from a mobile script, or the conditional
 * in buildConfig → red.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stripComments } from "../helpers/stripComments";
import { buildConfig } from "../../vite.config";
import * as shim from "../../client/src/lib/capacitor-web-shim";

const { Capacitor } = shim;

const ROOT = path.join(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

const aliasOf = (cfg: ReturnType<typeof buildConfig>) => {
  const alias = cfg.resolve?.alias as Record<string, string> | undefined;
  return alias?.["@capacitor/core"];
};

afterEach(() => {
  delete process.env.ACREOS_NATIVE_BUILD;
});

describe("the alias and its native fence", () => {
  it("web builds (customer + founder) alias @capacitor/core to the shim", () => {
    expect(aliasOf(buildConfig("customer"))).toMatch(/capacitor-web-shim\.ts$/);
    expect(aliasOf(buildConfig("founder"))).toMatch(/capacitor-web-shim\.ts$/);
  });

  it("ACREOS_NATIVE_BUILD=1 removes the alias — the real core links", () => {
    process.env.ACREOS_NATIVE_BUILD = "1";
    expect(aliasOf(buildConfig("customer"))).toBeUndefined();
    expect(aliasOf(buildConfig("founder"))).toBeUndefined();
  });

  it("every mobile:* script sets ACREOS_NATIVE_BUILD=1 for its build", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    const mobile = Object.entries(pkg.scripts).filter(([k]) => k.startsWith("mobile:"));
    expect(mobile.length).toBeGreaterThan(0);
    for (const [name, cmd] of mobile) {
      expect(cmd, `${name} must build native`).toMatch(/^ACREOS_NATIVE_BUILD=1 npm run build/);
    }
  });
});

describe("the shim's answers are the web constants", () => {
  it("isNativePlatform() is false and getPlatform() is 'web'", () => {
    expect(Capacitor.isNativePlatform()).toBe(false);
    expect(Capacitor.getPlatform()).toBe("web");
  });

  it("carries the plugin-facing build surface — as stubs that throw, never silently work", () => {
    // The installed plugins' dist/esm modules import exactly these four
    // names from @capacitor/core (registerPlugin in every plugin index;
    // WebPlugin / CapacitorException / buildRequestInit in the web
    // implementations). Rollup needs the bindings to build the plugin
    // chunks; on web those chunks never evaluate (every load is
    // isNative-gated), so the stubs only have to fail loudly if reached.
    expect(typeof shim.registerPlugin).toBe("function");
    expect(typeof shim.WebPlugin).toBe("function");
    expect(typeof shim.CapacitorException).toBe("function");
    expect(typeof shim.buildRequestInit).toBe("function");
    expect(() => shim.registerPlugin()).toThrow(/shimmed in web builds/);
    expect(() => new shim.WebPlugin()).toThrow(/shimmed in web builds/);
    expect(() => shim.buildRequestInit()).toThrow(/shimmed in web builds/);
  });
});

describe("the premise — the used static surface is exactly those two members", () => {
  const files = walk(path.join(ROOT, "client/src"));

  it("only lib/platform.ts and lib/haptics.ts statically import @capacitor/core", () => {
    const importers = files
      .filter((f) => /^\s*import\s[^;]*from\s*["']@capacitor\/core["']/m.test(stripComments(readFileSync(f, "utf8"))))
      .map((f) => path.relative(ROOT, f))
      .sort();
    expect(importers).toEqual(["client/src/lib/haptics.ts", "client/src/lib/platform.ts"]);
  });

  it("the members they touch are exactly isNativePlatform and getPlatform", () => {
    const used = new Set<string>();
    for (const rel of ["client/src/lib/haptics.ts", "client/src/lib/platform.ts"]) {
      const src = stripComments(readFileSync(path.join(ROOT, rel), "utf8"));
      for (const m of src.matchAll(/Capacitor\.(\w+)/g)) used.add(m[1]);
    }
    expect([...used].sort()).toEqual(["getPlatform", "isNativePlatform"]);
  });

  it("no @capacitor plugin is statically imported anywhere in client/src", () => {
    const offenders = files
      .filter((f) => /^\s*import\s[^;]*from\s*["']@capacitor\/(?!core["'])/m.test(stripComments(readFileSync(f, "utf8"))))
      .map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
