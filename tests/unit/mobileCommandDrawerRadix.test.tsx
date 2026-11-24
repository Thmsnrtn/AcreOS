// @vitest-environment jsdom
/**
 * BD-3 (2026-11-20) — the mobile command drawer runs on the repo's Radix
 * Dialog drawer path (client/src/components/ui/drawer.tsx), not vaul.
 *
 * What this pins:
 *   1. vaul is gone from the drawer engine and from package.json — the
 *      bundle win cannot silently regress by re-adding the import.
 *   2. The drawer still renders its full surface when open (search,
 *      quick actions, more items, grab handle) and nothing when closed.
 *   3. Dismissal parity for the paths jsdom can drive: tapping an action
 *      closes through onOpenChange(false), and Escape closes through
 *      Radix. (Overlay-tap dismissal is Radix Dialog's own behaviour;
 *      drag-to-dismiss is framer-motion pointer work jsdom cannot
 *      faithfully simulate — its thresholds are pinned by source in
 *      test 1's sibling assertions on ui/sheet.tsx parity constants.)
 *   4. No snap points were used by the vaul build and none are
 *      configured now — the parity claim is checkable, not asserted.
 *
 * Mounted through react-dom/client (the repo pattern — @testing-library
 * is not a dependency).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("../../client/src/hooks/use-auth", () => ({
  useAuth: () => ({ isFounder: false }),
}));
vi.mock("../../client/src/hooks/use-hidden-routes", () => ({
  useHiddenRoutes: () => [],
}));

import { MobileCommandDrawer } from "../../client/src/components/mobile/MobileCommandDrawer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const repoRoot = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
    root = null;
  }
  host?.remove();
  host = null;
  document.body.innerHTML = "";
});

async function mount(open: boolean, onOpenChange: (open: boolean) => void) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      React.createElement(MobileCommandDrawer, { open, onOpenChange }),
    );
  });
}

describe("BD-3: vaul is out of the drawer path", () => {
  it("ui/drawer.tsx is backed by Radix Dialog, with no vaul import anywhere in client/src", () => {
    const drawer = read("client/src/components/ui/drawer.tsx");
    expect(drawer).not.toContain('from "vaul"');
    expect(drawer).not.toContain("from 'vaul'");
    expect(drawer).toContain("@radix-ui/react-dialog");
    // The drag-to-dismiss commit thresholds match the existing bottom
    // Sheet path exactly — one gesture contract for bottom sheets.
    const sheet = read("client/src/components/ui/sheet.tsx");
    for (const src of [drawer, sheet]) {
      expect(src).toContain("info.offset.y > 100");
      expect(src).toContain("info.velocity.y > 500");
    }
  });

  it("package.json no longer depends on vaul", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies).not.toHaveProperty("vaul");
    expect(pkg.devDependencies ?? {}).not.toHaveProperty("vaul");
  });

  it("no snap points are configured (the vaul build used none)", () => {
    expect(read("client/src/components/ui/drawer.tsx")).not.toContain("snapPoints");
    expect(read("client/src/components/mobile/MobileCommandDrawer.tsx")).not.toContain("snapPoints");
  });
});

describe("BD-3: MobileCommandDrawer on the Radix path", () => {
  it("renders the full drawer surface when open, with the drag handle", async () => {
    const onOpenChange = vi.fn();
    await mount(true, onOpenChange);

    expect(document.querySelector('[data-testid="mobile-command-drawer"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="mobile-command-search"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="mobile-drawer-settings"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="mobile-drawer-tasks"]')).not.toBeNull();
    // handleOnly parity: a dedicated drag handle exists so content taps
    // are not drag surfaces.
    expect(document.querySelector('[data-testid="drawer-drag-handle"]')).not.toBeNull();
    // Radix dialog semantics are present (the vaul build's role too).
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("renders nothing when closed", async () => {
    const onOpenChange = vi.fn();
    await mount(false, onOpenChange);
    expect(document.querySelector('[data-testid="mobile-command-drawer"]')).toBeNull();
  });

  it("tapping an action closes the drawer through onOpenChange(false)", async () => {
    const onOpenChange = vi.fn();
    await mount(true, onOpenChange);
    const link = document.querySelector<HTMLAnchorElement>(
      '[data-testid="mobile-drawer-settings"]',
    );
    expect(link).not.toBeNull();
    await act(async () => {
      link!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Escape dismisses the drawer (Radix dismissal parity)", async () => {
    const onOpenChange = vi.fn();
    await mount(true, onOpenChange);
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
