/**
 * jsPDF's html() and addSvgAsImage() are not bundled, and nothing calls them.
 *
 * jsPDF lazy-loads html2canvas (html()) and canvg + core-js (addSvgAsImage()).
 * vite.config.ts resolves those two to a stub that throws, which takes about
 * 360 KB off the total-JS budget, because AcreOS draws its PDFs with text and
 * lines only. That is safe only while it stays true, so:
 *
 *   1. every client/shared/package file that imports jsPDF, in any form, is
 *      found, and none of them calls html() or addSvgAsImage() — a new caller
 *      fails here instead of throwing in a customer's browser. Since BD-1
 *      (borrower PDFs render on the server) the found set must be EMPTY:
 *      jsPDF is a server-only dependency now, and any client import brings
 *      the 331 KB chunk back into the customer bundle;
 *   2. the stub covers exactly html2canvas and canvg, is registered, and only
 *      applies when jsPDF is the importer. dompurify, jsPDF's third optional
 *      dependency, is never stubbed: isomorphic-dompurify sanitizes mail and
 *      assignment HTML with it.
 *
 * The stub plugin stays in vite.config.ts as a tripwire even with zero
 * client consumers: if a client jsPDF import ever returns, the stubbed
 * optional deps keep its worst weight out while this pin fails the build.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.join(__dirname, "../..");
const SCAN_DIRS = ["client/src", "shared", "packages"];
const JSPDF_IMPORT = /\bfrom\s*["']jspdf["']|\bimport\(\s*["']jspdf["']\s*\)|\brequire\(\s*["']jspdf["']\s*\)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe("jsPDF's unbundled optional features are never called", () => {
  const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
  const consumers = files.filter((f) => JSPDF_IMPORT.test(stripComments(readFileSync(f, "utf8"))));

  it("finds no jsPDF consumers in the client bundle's sources (BD-1: jsPDF is server-only)", () => {
    expect(files.length).toBeGreaterThan(1000);
    expect(
      consumers.map((f) => path.relative(ROOT, f)),
      "a client/shared/packages file imports jsPDF — borrower PDFs render on the server (BD-1); a client import ships the 331 KB jspdf chunk to every customer again",
    ).toEqual([]);
  });

  it("no jsPDF consumer calls html(), addSvgAsImage() or addImage(), or enables compression", () => {
    const offenders = consumers.filter((f) => /\.html\s*\(|\baddSvgAsImage\s*\(|\baddImage\s*\(|compress(Pdf)?\s*:\s*true/.test(stripComments(readFileSync(f, "utf8"))));
    expect(
      offenders.map((f) => path.relative(ROOT, f)),
      "jsPDF html()/addSvgAsImage()/addImage()/compression load html2canvas/canvg/fast-png/fflate, which vite.config.ts stubs out — bundle them deliberately (and re-measure the budget) before calling them",
    ).toEqual([]);
  });
});

describe("the stub covers exactly html2canvas, canvg, fast-png and fflate, and only for jsPDF", () => {
  const config = stripComments(readFileSync(path.join(ROOT, "vite.config.ts"), "utf8"));

  it("names html2canvas and canvg, never dompurify", () => {
    const set = config.match(/JSPDF_UNUSED_OPTIONAL_DEPS\s*=\s*new Set\(\[([^\]]*)\]\)/);
    expect(set, "the stubbed-dependency set was not found").not.toBeNull();
    const names = [...set![1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]).sort();
    expect(names).toEqual(["canvg", "fast-png", "fflate", "html2canvas"]);
  });

  it("is registered as a plugin and keyed on jsPDF as the importer", () => {
    expect(config).toMatch(/plugins:\s*\[[^\]]*\bjspdfUnusedOptionalDepsPlugin\(\)/s);
    expect(config).toMatch(/node_modules\[\\\\\/\]jspdf\[\\\\\/\]/);
  });

  it("dompurify is still in use by the app, so stubbing it would break sanitizing", () => {
    const users = filesImporting("isomorphic-dompurify");
    expect(users.length).toBeGreaterThan(0);
  });
});

function filesImporting(pkg: string): string[] {
  const re = new RegExp(`from\\s*["']${pkg}["']`);
  return SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d))).filter((f) => re.test(stripComments(readFileSync(f, "utf8"))));
}
