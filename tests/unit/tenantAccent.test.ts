/**
 * A company accent never ships an unreadable button or an invisible focus
 * ring, and it lands in BOTH token families.
 *
 * Before the Fieldstone redesign the tenant overlay pasted the org hex into
 * --primary/--ring/--accent as-is: a dark navy brand became a dark-on-dark
 * button in dark mode, --primary-foreground was never adjusted, the raw
 * --acr-brand family kept the personal colour (so half the app ignored the
 * brand), and the hover tint (--accent) turned saturated.
 *
 * Mutation probes: return `fill = base` unconditionally in deriveTenantAccent
 * (label/ring checks go red); drop "--acr-brand" from TENANT_ACCENT_VARS.
 */

import { describe, expect, it } from "vitest";
import { contrastRatio, deriveTenantAccent, TENANT_ACCENT_VARS } from "../../client/src/lib/tenant-accent";
import { COLORWAYS } from "../../shared/appearance";

const rgb = (h: string): [number, number, number] => {
  const m = /#?([0-9a-f]{6})/i.exec(h)!;
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as [number, number, number];
};
const parseRgba = (s: string) => s.match(/\d+(\.\d+)?/g)!.map(Number);

// The real surfaces of every colorway × mode (from the shared contract).
const SURFACES = COLORWAYS.flatMap((c) =>
  (["light", "dark"] as const).map((mode) => ({
    label: `${c.id} ${mode}`,
    mode,
    bg: c[mode].page,
    surface: c[mode].surface,
    ink: mode === "dark" ? "#F2F3EB" : "#192C28",
  })),
);

// Brand colours chosen to break a naive overlay in one mode or the other.
const ACCENTS = ["#1E3A5F", "#F5D90A", "#2563EB", "#000000", "#FFFFFF", "#C2531C", "#10B981"];

describe("deriveTenantAccent", () => {
  for (const s of SURFACES) {
    for (const accent of ACCENTS) {
      it(`${accent} on ${s.label}: AA label, visible ring, both families`, () => {
        const v = deriveTenantAccent(accent, s);
        expect(v, "a usable accent must produce overrides").not.toBeNull();
        const fill = rgb(v!["--acr-brand"]);
        const label = rgb(v!["--acr-brand-ink"]);
        expect(contrastRatio(label, fill), "button label").toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(fill, rgb(s.bg)), "ring vs page").toBeGreaterThanOrEqual(3);
        expect(contrastRatio(fill, rgb(s.surface)), "ring vs surface").toBeGreaterThanOrEqual(3);
        // Soft-ink clears AA on the wash composited over the page.
        const [r, g, b, a] = parseRgba(v!["--acr-brand-soft"]);
        const bg = rgb(s.bg);
        const wash = [r, g, b].map((c, i) => Math.round(c * a + bg[i] * (1 - a))) as [number, number, number];
        expect(contrastRatio(rgb(v!["--acr-brand-soft-ink"]), wash), "soft ink on wash").toBeGreaterThanOrEqual(4.5);
        // Both families, and never the hover tint.
        for (const k of TENANT_ACCENT_VARS) expect(v![k], k).toBeTruthy();
        expect(Object.keys(v!)).not.toContain("--accent");
      });
    }
  }

  it("refuses unusable input rather than guessing", () => {
    expect(deriveTenantAccent("blue", SURFACES[0])).toBeNull();
    expect(deriveTenantAccent("#12345", SURFACES[0])).toBeNull();
    expect(deriveTenantAccent("#123456", { ...SURFACES[0], bg: "" })).toBeNull();
  });

  it("writes the raw and the HSL family together", () => {
    expect(TENANT_ACCENT_VARS).toEqual(expect.arrayContaining(["--primary", "--primary-foreground", "--ring", "--acr-brand", "--acr-brand-ink", "--acr-brand-soft", "--acr-brand-soft-ink", "--acr-ring"]));
  });
});
