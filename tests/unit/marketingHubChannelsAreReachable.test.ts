/**
 * Every link into the Deals door's marketing hub opens the tab it names
 * (best-in-class audit 2026-10-20, §2).
 *
 * /buyer-blasts, /sequences and /direct-mail-campaigns redirect to
 * /campaigns?channel=…, and the sidebar links there too — but the hub read
 * only the URL hash, and had no buyer-blasts tab, so the buyer-blast list and
 * composer were unreachable. Population: every `/campaigns?channel=` and
 * `/campaigns#` literal in client/src must resolve to a tab, and each
 * non-default channel must open a tab other than the default.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "../helpers/stripComments";
import { CHANNEL_TABS, tabForLocation } from "../../client/src/lib/marketingHubTabs";

import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

function walk(d: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const links = walk("client/src").flatMap((f) =>
  [...stripComments(readFileSync(f, "utf8")).matchAll(/\/campaigns(\?channel=([a-z-]+)|#([a-z-]+))/g)].map((m) => ({
    f,
    search: m[2] ? `?channel=${m[2]}` : "",
    hash: m[3] ? `#${m[3]}` : "",
    value: m[2] ?? m[3],
  })),
);

describe("marketing hub channel links", () => {
  it("the population is non-vacuous (redirects + sidebar)", () => {
    expect(links.length).toBeGreaterThanOrEqual(6);
    expect(links.some((l) => l.value === "buyer-blasts")).toBe(true);
  });

  it("every linked channel is a known tab", () => {
    expect(links.filter((l) => !(l.value in CHANNEL_TABS))).toEqual([]);
  });

  it("buyer-blasts and sequences open their own tabs, not the default", () => {
    expect(tabForLocation("?channel=buyer-blasts", "")).toBe("buyer-blasts");
    expect(tabForLocation("?channel=sequences", "")).toBe("sequences");
    expect(tabForLocation("", "#ab-tests")).toBe("ab-tests");
    expect(tabForLocation("?channel=direct-mail", "")).toBe("campaigns");
    expect(tabForLocation("", "")).toBe("campaigns");
  });

  it("the hub mounts the buyer-blasts tab with the real panel", () => {
    const hub = stripComments(readFileSync("client/src/pages/campaigns.tsx", "utf8"));
    expect(hub).toMatch(/<TabsContent value="buyer-blasts"[\s\S]*?<BuyerBlastsPanel \/>/);
    expect(hub).toMatch(/tabForLocation\(window\.location\.search, window\.location\.hash\)/);
  });
});

describe("the buyer-blast page claims only what it does", () => {
  it("no automatic matching, automatic send, SMS or open tracking is claimed", () => {
    const src = stripComments(readFileSync("client/src/pages/buyer-blasts.tsx", "utf8"));
    // The send is email-only on the org's identity; opens are not tracked;
    // matching is not triggered by locking up a property.
    expect(src).not.toMatch(/tracks opens|fires the email|The moment you lock up|\bSMS\b/i);
  });
});
