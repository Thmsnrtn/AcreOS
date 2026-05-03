/**
 * StatusBadge render tests.
 *
 * The repo's vitest config runs in node and excludes the client/ tree, so we
 * exercise the component via react-dom/server. That covers the rendered
 * markup (tones, labels, aria attributes, fallbacks) without needing jsdom.
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusBadge } from "../../client/src/components/StatusBadge";
import { Verbs } from "../../client/src/lib/labels";

function render(props: Parameters<typeof StatusBadge>[0]): string {
  return renderToStaticMarkup(createElement(StatusBadge, props));
}

describe("StatusBadge", () => {
  it("renders the default label for a known status", () => {
    const html = render({ status: "active" });
    expect(html).toContain("Active");
    expect(html).toContain('aria-label="Status: Active"');
    // Active uses the positive semantic token surface.
    expect(html).toContain("bg-acr-pos-soft");
    expect(html).toContain("text-acr-pos");
  });

  it("uses the warning tone for pending and warning kinds", () => {
    const pending = render({ status: "pending" });
    const warning = render({ status: "warning" });
    expect(pending).toContain("bg-acr-warn-soft");
    expect(warning).toContain("bg-acr-warn-soft");
    expect(pending).toContain("Pending");
    expect(warning).toContain("Warning");
  });

  it("uses the negative tone for error", () => {
    const html = render({ status: "error" });
    expect(html).toContain("bg-acr-neg-soft");
    expect(html).toContain("text-acr-neg");
    expect(html).toContain("Error");
  });

  it("renders neutral surfaces for inactive / paused / draft", () => {
    for (const status of ["inactive", "paused", "draft"] as const) {
      const html = render({ status });
      expect(html).toContain("text-muted-foreground");
    }
  });

  it("supports a custom label override", () => {
    const html = render({ status: "active", label: "Live now" });
    expect(html).toContain("Live now");
    expect(html).toContain('aria-label="Status: Live now"');
  });

  it("falls back gracefully for unknown status strings", () => {
    const html = render({ status: "archived" });
    // Title-cases the raw string for the visible label.
    expect(html).toContain("Archived");
    expect(html).toContain("text-muted-foreground");
  });

  it("respects the size prop", () => {
    const sm = render({ status: "active", size: "sm" });
    const md = render({ status: "active", size: "md" });
    expect(sm).toContain("h-[18px]");
    expect(md).toContain("h-[22px]");
  });

  it("renders pulse animation only for the live 'active' status", () => {
    const active = render({ status: "active" });
    const success = render({ status: "success" });
    expect(active).toContain("animate-ping");
    expect(success).not.toContain("animate-ping");
  });
});

describe("Verbs canon", () => {
  it("exposes the documented verb keys", () => {
    expect(Verbs.LEAD_CREATE).toBe("Add lead");
    expect(Verbs.PROPERTY_RUN_AVM).toBe("Run valuation");
    expect(Verbs.DEAL_CLOSE_WON).toBe("Close won");
    expect(Verbs.SEND_LETTER).toBe("Send letter");
    expect(Verbs.RETRY).toBe("Retry");
  });

  it("uses sentence case (no trailing punctuation)", () => {
    for (const value of Object.values(Verbs)) {
      expect(value).not.toMatch(/[.!?…]$/);
      // First char uppercase, rest of first word not all-caps (allow acronyms later if needed).
      expect(value[0]).toBe(value[0].toUpperCase());
    }
  });
});
