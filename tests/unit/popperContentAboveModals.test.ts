/**
 * Popper content paints above the dialogs and sheets it opens from.
 *
 * Dialogs and sheets moved to `z-modal` (60) so the mobile bottom nav could
 * not paint over their scrims; the popper primitives — select lists, menus,
 * popovers, tooltips — stayed at `z-floating` (50). Radix portals them to
 * <body>, so a Select opened inside a sheet rendered UNDER the sheet's
 * scrim, which intercepted every tap: no option inside any dialog or sheet
 * could be chosen. The W10.3 wedge E2E found it on the list builder's state
 * picker ("command-backdrop intercepts pointer events").
 *
 * The property, measured on resolved values rather than names: every z token
 * a portalled popper primitive uses resolves (through tailwind.config.ts) to
 * a number above every z token the modal surfaces use.
 *
 * Population: every client/src/components/ui primitive that imports a Radix
 * popper package AND renders a Portal. A popper rendered in-flow (the
 * navigation menu) is not portalled and so cannot be covered by a scrim.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");
const UI = path.join(ROOT, "client/src/components/ui");
const POPPER_PKG = /@radix-ui\/react-(select|popover|dropdown-menu|tooltip|context-menu|hover-card|menubar|navigation-menu)\b/;
const MODAL_SURFACES = ["dialog.tsx", "sheet.tsx"];

/**
 * The z-index scale, read from tailwind.config.ts's `zIndex` block as text —
 * importing the config would pull it (and its plugin types) into the test
 * type-check program.
 */
const scale: Record<string, string> = (() => {
  const cfg = stripComments(fs.readFileSync(path.join(ROOT, "tailwind.config.ts"), "utf8"));
  const block = cfg.match(/zIndex:\s*\{([^}]*)\}/);
  if (!block) throw new Error("tailwind.config.ts has no zIndex block — update this reader");
  return Object.fromEntries(
    [...block[1].matchAll(/["']?([a-z][a-z0-9-]*)["']?\s*:\s*["'](\d+)["']/g)].map((m) => [m[1], m[2]]),
  );
})();

/** The z tokens a source uses, resolved to numbers; throws on a token the scale does not define. */
function zValues(src: string): Array<{ token: string; value: number }> {
  return [...src.matchAll(/(?<![\w-])z-([a-z][a-z0-9-]*)\b/g)].map((m) => {
    const raw = scale[m[1]];
    if (raw === undefined) throw new Error(`z-${m[1]} is not on the z-index scale`);
    return { token: `z-${m[1]}`, value: Number(raw) };
  });
}

const read = (f: string) => stripComments(fs.readFileSync(path.join(UI, f), "utf8"));

const portalledPoppers = fs
  .readdirSync(UI)
  .filter((f) => f.endsWith(".tsx"))
  .filter((f) => {
    const src = read(f);
    return POPPER_PKG.test(src) && /\.Portal\b/.test(src);
  });

describe("popper content sits above modal surfaces", () => {
  it("vacuity: the population is the portalled popper primitives, and the modals have a z", () => {
    for (const f of ["select.tsx", "popover.tsx", "dropdown-menu.tsx", "context-menu.tsx"]) {
      expect(portalledPoppers, f).toContain(f);
    }
    expect(portalledPoppers.length).toBeGreaterThanOrEqual(5);
    for (const f of MODAL_SURFACES) expect(zValues(read(f)).length, f).toBeGreaterThan(0);
  });

  it("every z a portalled popper uses is above every z a dialog or sheet uses", () => {
    const modalTop = Math.max(...MODAL_SURFACES.flatMap((f) => zValues(read(f)).map((z) => z.value)));
    const offenders = portalledPoppers.flatMap((f) =>
      zValues(read(f))
        .filter((z) => z.value <= modalTop)
        .map((z) => `${f}: ${z.token} (${z.value}) is not above the modal layer (${modalTop})`),
    );
    expect(offenders).toEqual([]);
  });

  it("vacuity: the scale was read, with the layers this rule compares", () => {
    for (const k of ["floating", "modal", "popover", "toast"]) expect(scale[k], k).toMatch(/^\d+$/);
    expect(Object.keys(scale).length).toBeGreaterThanOrEqual(10);
  });

  it("canary: the resolver reads values, not names", () => {
    expect(zValues('"z-floating w-72"')).toEqual([{ token: "z-floating", value: 50 }]);
    expect(zValues('"z-popover"')[0].value).toBeGreaterThan(zValues('"z-modal"')[0].value);
    expect(() => zValues('"z-imaginary"')).toThrow();
  });
});
