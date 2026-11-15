/**
 * 2026-11-05 bundle trim: the i18next bootstrap (client/src/lib/i18n/config.ts)
 * is no longer side-effect-imported from main.tsx, because nothing called it —
 * it shipped ~50 KB for no caller. The danger of removing an init is a later
 * caller that silently renders raw keys instead of English. So this pins the
 * pair together: EITHER main.tsx imports the init, OR no client code calls
 * useT() / useTranslation() / i18n. Adopting useT() without restoring the
 * import fails here.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.join(__dirname, "../..");
const CLIENT = path.join(ROOT, "client/src");
const I18N_DIR = path.join(CLIENT, "lib/i18n");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("i18n init is shipped only when something uses it", () => {
  const mainImportsInit = /import\s+["']@\/lib\/i18n\/config["']/.test(stripComments(readFileSync(path.join(CLIENT, "main.tsx"), "utf8")));
  const files = walk(CLIENT).filter((f) => !f.startsWith(I18N_DIR + path.sep));

  it("reads the client population (vacuity floor)", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("no client code calls useT / useTranslation / i18next unless main.tsx imports the init", () => {
    if (mainImportsInit) return;
    const USE = /\buseT\s*\(|\buseTranslation\s*\(|from\s+["'](?:i18next|react-i18next)["']|from\s+["']@\/lib\/i18n(?:\/(?:config|useT))?["']/;
    const callers = files.filter((f) => USE.test(stripComments(readFileSync(f, "utf8")))).map((f) => path.relative(ROOT, f));
    expect(callers).toEqual([]);
  });
});
