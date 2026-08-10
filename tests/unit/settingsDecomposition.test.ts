/**
 * Settings decomposition exit test + ratchet (Wave 1.5, master-handoff P2 §1).
 *
 * The 1,843-line settings.tsx tab monolith (7 tabs, 8 <TabsContent> blocks,
 * and the duplicate-TabsContent bug class it produced twice) was decomposed
 * into a five-group left rail with ROUTED sections. This suite pins the
 * properties that make the decomposition safe and keep it from regressing:
 *
 *   1. ONE source of truth — the section registry
 *      (client/src/lib/settings-sections.ts) drives the rail, the routes,
 *      and the ⌘K palette; none of the three may hardcode its own list.
 *   2. Every non-standalone section lazy-loads a real
 *      pages/settings/<id>-section.tsx file from the shell; every
 *      standalone section's path is a real <Route> in App.tsx registered
 *      BEFORE the /settings/:section catch-all (wouter Switch is
 *      first-match — a standalone page after the catch-all never renders).
 *   3. Every legacy tab/hash value — the 7-bucket era, the 17-tab era,
 *      the `?tab=` forms live links emit, the retired /settings/email +
 *      /settings/mail slugs, and the Stripe `?subscription=` return —
 *      resolves to a LIVE routed section. A derived sweep proves every
 *      `/settings?tab=` / `/settings#` literal in production source is
 *      resolvable, so a new legacy-form link cannot silently dead-end.
 *   4. The TabsContent ratchet — `<TabsContent` occurrences across
 *      settings.tsx + pages/settings/** are pinned at ZERO, and the
 *      settings tree may not import the Tabs kit at all. The monolith is
 *      retired: settings.tsx is a routing shell, and the
 *      duplicate-TabsContent bug class is impossible by construction
 *      (one file per section).
 *
 * Mirrors the founderFourDoors.test.ts / founderLegacyRedirects.test.ts
 * ratchet style: baselines only move DOWN, in the same change that earns it.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  settingsSectionPath,
  settingsSectionById,
  settingsSectionsInGroup,
  SETTINGS_LEGACY_REDIRECTS,
  resolveLegacySettingsTab,
  resolveLegacySettingsLocation,
} from "@/lib/settings-sections";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.resolve(ROOT, rel), "utf-8");

const APP = read("client/src/App.tsx");
const SHELL = read("client/src/pages/settings.tsx");
const PALETTE = read("client/src/components/command-palette.tsx");

/** The ratchet baseline. The monolith is fully retired — this may NEVER
 *  rise. (History: 8 <TabsContent> blocks / 20 TabsContent occurrences at
 *  the monolith's peak, plus two shipped duplicate-TabsContent bugs.) */
const SETTINGS_TABSCONTENT_BASELINE = 0;

// ── 1. Registry shape ─────────────────────────────────────────────────────

describe("settings section registry", () => {
  it("holds exactly the five canonical groups, in frequency order", () => {
    expect(SETTINGS_GROUPS.map((g) => g.id)).toEqual(["you", "workspace", "pax", "data", "money"]);
  });

  it("every section belongs to a real group, with a unique id and non-empty copy", () => {
    const groupIds = new Set(SETTINGS_GROUPS.map((g) => g.id));
    const seen = new Set<string>();
    for (const s of SETTINGS_SECTIONS) {
      expect(groupIds.has(s.group), `${s.id}: unknown group ${s.group}`).toBe(true);
      expect(seen.has(s.id), `${s.id}: duplicate section id`).toBe(false);
      seen.add(s.id);
      expect(s.label.length, `${s.id}: label required`).toBeGreaterThan(0);
      expect(s.description.length, `${s.id}: description required`).toBeGreaterThan(0);
      expect(s.keywords.trim().length, `${s.id}: QuickFind keywords required`).toBeGreaterThan(0);
    }
  });

  it("every group has at least one section (no empty rail groups)", () => {
    for (const g of SETTINGS_GROUPS) {
      expect(
        settingsSectionsInGroup(g.id).length,
        `group ${g.id} has no sections`,
      ).toBeGreaterThan(0);
    }
  });

  it("section paths all live under /settings/", () => {
    for (const s of SETTINGS_SECTIONS) {
      expect(settingsSectionPath(s)).toMatch(/^\/settings\/[a-z0-9-]+$/);
    }
  });
});

// ── 2. Registry drives rail + routes + palette (one source of truth) ──────

describe("one source of truth: shell, routes, palette all derive from the registry", () => {
  it("the shell imports the registry and renders the rail from it (no hardcoded section list)", () => {
    expect(SHELL).toContain('from "@/lib/settings-sections"');
    expect(SHELL).toContain("SETTINGS_GROUPS.map");
    expect(SHELL).toContain("settingsSectionsInGroup");
  });

  it("every non-standalone section lazy-loads pages/settings/<id>-section.tsx from the shell", () => {
    for (const s of SETTINGS_SECTIONS) {
      if (s.standalone) continue;
      const rel = `client/src/pages/settings/${s.id}-section.tsx`;
      expect(fs.existsSync(path.resolve(ROOT, rel)), `${rel} must exist`).toBe(true);
      expect(read(rel)).toMatch(/export default function/);
      expect(
        SHELL.includes(`import("@/pages/settings/${s.id}-section")`),
        `shell must lazy-load ${s.id} via import("@/pages/settings/${s.id}-section")`,
      ).toBe(true);
    }
  });

  it("the shell's lazy map has no entries the registry doesn't know (no orphan chunks)", () => {
    const lazyIds = [...SHELL.matchAll(/import\("@\/pages\/settings\/([a-z0-9-]+)-section"\)/g)].map(
      (m) => m[1],
    );
    for (const id of lazyIds) {
      const section = settingsSectionById(id);
      expect(section, `shell lazy-loads "${id}" but the registry has no such section`).not.toBeNull();
      expect(section?.standalone, `"${id}" is standalone — the shell must not mount it`).not.toBe(true);
    }
  });

  it("every standalone section's path is a real <Route> in App.tsx, registered BEFORE the /settings/:section catch-all", () => {
    const catchAllAt = APP.indexOf('path="/settings/:section"');
    expect(catchAllAt, "the /settings/:section shell route must be registered").toBeGreaterThan(-1);
    for (const s of SETTINGS_SECTIONS) {
      if (!s.standalone) continue;
      const routeAt = APP.indexOf(`path="${settingsSectionPath(s)}"`);
      expect(routeAt, `${settingsSectionPath(s)} must be a registered <Route>`).toBeGreaterThan(-1);
      expect(
        routeAt,
        `${settingsSectionPath(s)} is registered AFTER the /settings/:section catch-all — it will never render (Switch is first-match)`,
      ).toBeLessThan(catchAllAt);
    }
  });

  it("no literal /settings/* registration hides behind the catch-all", () => {
    const catchAllAt = APP.indexOf('path="/settings/:section"');
    const after = APP.slice(catchAllAt + 1);
    const shadowed = [...after.matchAll(/path="(\/settings\/[^":]+)"/g)].map((m) => m[1]);
    expect(
      shadowed,
      `literal settings route(s) registered after the /settings/:section catch-all would never match`,
    ).toEqual([]);
  });

  it("the ⌘K palette derives its settings destinations from the registry", () => {
    expect(PALETTE).toContain('from "@/lib/settings-sections"');
    expect(PALETTE).toContain("SETTINGS_SECTIONS.map");
    expect(PALETTE).toContain("settingsSectionPath(s)");
    // Flag parity: the palette applies the same feature flag the rail does.
    expect(PALETTE).toContain('useFlag("feature.autonomy-matrix")');
  });

  it("every registry section (flag-gated or not) is reachable from the palette derivation", () => {
    // The palette maps the WHOLE registry (gating is runtime, via the same
    // `flag` field the rail uses) — so palette coverage of the inventory is
    // exactly registry coverage, which section-file/route checks above
    // already prove is 100% live.
    expect(PALETTE).toContain("SETTINGS_PALETTE_PAGES");
    expect(PALETTE).toMatch(/flag:\s*s\.flag/);
  });
});

// ── 3. Legacy redirects ───────────────────────────────────────────────────

describe("legacy settings values all land on live routed sections", () => {
  it("every map entry points at a section that exists in the registry", () => {
    for (const [legacy, sectionId] of Object.entries(SETTINGS_LEGACY_REDIRECTS)) {
      const section = settingsSectionById(sectionId);
      expect(section, `${legacy} → ${sectionId}: not a registry section`).not.toBeNull();
      expect(resolveLegacySettingsTab(legacy), `${legacy}: must resolve`).toBe(
        settingsSectionPath(section!),
      );
    }
  });

  it("covers every value the settings surface has ever answered to", () => {
    // 7-bucket era (VALID_TABS) + 17-tab era (LEGACY_TO_CANONICAL) + the
    // `?tab=` values live links emit + the retired path slugs. Removing a
    // key here means a live bookmark/email link dead-ends — don't.
    const REQUIRED = [
      "account", "security", "organization", "billing", "tax-compliance",
      "notifications", "integrations",
      "general", "privacy", "referral", "appearance", "autonomy", "goals",
      "communications", "team", "payments", "data", "automations",
      "developer", "ai", "ai-tasks",
      "org", "providers", "email", "mail",
    ];
    for (const value of REQUIRED) {
      expect(
        SETTINGS_LEGACY_REDIRECTS[value],
        `legacy value "${value}" lost its redirect`,
      ).toBeTruthy();
    }
  });

  it("resolves the three live legacy grammars (?tab=, #hash, #hash?pseudo-query)", () => {
    expect(resolveLegacySettingsLocation("?tab=tax-compliance", "")).toBe("/settings/compliance");
    expect(resolveLegacySettingsLocation("?tab=billing", "")).toBe("/settings/billing");
    expect(resolveLegacySettingsLocation("", "#billing")).toBe("/settings/billing");
    // The upgrade-toast/dunning link: tier rides INSIDE the hash and must be
    // promoted to a real query param for the billing section to read.
    expect(resolveLegacySettingsLocation("", "#billing?tier=pro")).toBe("/settings/billing?tier=pro");
    // Stripe checkout returns to /settings?subscription=… (server literal in
    // routes-billing.ts) — a billing intent, param preserved.
    expect(resolveLegacySettingsLocation("?subscription=success", "")).toBe(
      "/settings/billing?subscription=success",
    );
    // Hash wins over ?tab= (the monolith only ever read the hash); the
    // consumed tab param does not leak into the target query.
    expect(resolveLegacySettingsLocation("?tab=team", "#billing")).toBe("/settings/billing");
    // Nothing legacy → null (stay on the overview / anchors untouched).
    expect(resolveLegacySettingsLocation("", "")).toBeNull();
    expect(resolveLegacySettingsLocation("", "#quiet-hours")).toBeNull();
  });

  it("derived sweep: every /settings?tab= and /settings# literal in production source resolves", () => {
    const SWEEP_DIRS = ["client/src", "server", "shared"];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.resolve(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules") continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) continue;
        const src = fs.readFileSync(full, "utf-8");
        const rel = path.relative(ROOT, full).split(path.sep).join("/");
        for (const m of src.matchAll(/\/settings(?:\?tab=|#)([A-Za-z0-9-]+)/g)) {
          if (!resolveLegacySettingsTab(m[1])) {
            offenders.push(`${rel} → "${m[1]}"`);
          }
        }
      }
    };
    for (const d of SWEEP_DIRS) walk(path.resolve(ROOT, d));
    expect(
      offenders,
      "legacy-form settings link(s) with an unresolvable value — add the value to " +
        "SETTINGS_LEGACY_REDIRECTS (client/src/lib/settings-sections.ts) or link the routed path",
    ).toEqual([]);
  });
});

// ── 4. TabsContent ratchet — the monolith stays retired ───────────────────

describe("no-new-TabsContent ratchet (settings tree)", () => {
  const settingsDir = path.resolve(ROOT, "client/src/pages/settings");
  const settingsFiles = [
    "client/src/pages/settings.tsx",
    ...fs
      .readdirSync(settingsDir)
      .filter((f) => /\.tsx?$/.test(f))
      .map((f) => `client/src/pages/settings/${f}`),
  ];

  it(`<TabsContent> count across the settings tree stays at ${SETTINGS_TABSCONTENT_BASELINE} (down-only; it is zero — one file per section makes the duplicate-tab bug class impossible)`, () => {
    let count = 0;
    const perFile: string[] = [];
    for (const rel of settingsFiles) {
      const n = (read(rel).match(/<TabsContent/g) ?? []).length;
      if (n > 0) perFile.push(`${rel}: ${n}`);
      count += n;
    }
    expect(
      count,
      `settings tree grew <TabsContent> usage (${perFile.join(", ")}). Sections are ROUTED ` +
        `(one file per section, registered in lib/settings-sections.ts) — never tabs.`,
    ).toBeLessThanOrEqual(SETTINGS_TABSCONTENT_BASELINE);
  });

  it("the settings tree does not import the Tabs kit at all", () => {
    for (const rel of settingsFiles) {
      expect(
        read(rel).includes("@/components/ui/tabs"),
        `${rel} imports the Tabs kit — settings sections are routed, not tabbed`,
      ).toBe(false);
    }
  });

  it("settings.tsx is a routing shell, not a content monolith", () => {
    // The monolith carried every tab's queries and mutations inline. The
    // shell routes + renders the overview only: no direct mutation wiring.
    expect(SHELL).not.toContain("useMutation(");
    // And it stays an order of magnitude smaller than the 1,843-line
    // monolith — content belongs in section files.
    const lines = SHELL.split("\n").length;
    expect(lines, `settings.tsx has grown to ${lines} lines — move content into section files`).toBeLessThan(500);
  });
});

// ─── Fleet-8 verifier catches — each fix pinned so it cannot regress ────────
//
// This lane's builder died mid-flight, so its adversarial audit was the only
// completeness record. It found the decomposition itself sound (no dropped
// controls, exact gating parity, complete redirect coverage) but caught two
// blocking defects and three should-fixes. These pins are the repairs' memory.

describe("fleet-8 catch — status rows state the ORG's truth, never the platform's", () => {
  it("the overview reads org-scoped integration health only", () => {
    const shell = read("client/src/pages/settings.tsx");
    // /api/settings/integrations/status is isAuthenticated + getOrCreateOrg.
    expect(shell).toContain('queryKey: ["/api/settings/integrations/status"]');
    // The platform-level feeds must NOT be status sources here: an org with
    // nothing connected was told "Email ready" because ACREOS had keys.
    expect(shell).not.toContain('"/api/integrations/status"');
    expect(shell).not.toContain("useProviderStatus");
    // …and the row can now distinguish erroring from never-connected.
    expect(shell).toContain("erroring");
  });

  it("no section claims an AI status lane while org AI health does not exist", () => {
    const registry = read("client/src/lib/settings-sections.ts");
    // The type itself forbids it, so a future "ai" lane fails typecheck
    // rather than silently reintroducing the platform-key conflation.
    expect(registry).toContain('statusLane?: "comms";');
    expect(registry).not.toMatch(/statusLane:\s*"ai"/);
  });
});

describe("fleet-8 catch — QuickFind rows land on the section that holds the control", () => {
  const quickFind = () => read("client/src/components/settings/SettingsQuickFind.tsx");

  it("every catalog row targets a REAL registry section id", () => {
    const ids = new Set(SETTINGS_SECTIONS.map((s) => s.id));
    const targets = [...quickFind().matchAll(/section: "([^"]+)"/g)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(20); // the catalog is finer-grained than the registry, on purpose
    for (const target of targets) {
      expect(ids.has(target), `QuickFind targets unknown section "${target}"`).toBe(true);
    }
    // The retired tab vocabulary is gone: routing jumps through the
    // legacy-tab map sent "API keys" to Mailbox and "Appearance" to Profile.
    expect(quickFind()).not.toMatch(/tab: "(account|organization|integrations|tax-compliance)"/);
  });

  it("the shell navigates by section path, not through the legacy map", () => {
    const shell = read("client/src/pages/settings.tsx");
    expect(shell).toMatch(/onJump=\{\(sectionId\) =>/);
    expect(shell).toContain("navigate(settingsSectionPath(target))");
  });

  it("picking a row does not write a retired tab token into the URL", () => {
    expect(quickFind()).not.toMatch(/window\.location\.hash = entry/);
  });
});

describe("fleet-8 catch — legacy grammar resolves at the settings ROOT only", () => {
  it("a routed section's own fragments are left alone", () => {
    const shell = read("client/src/pages/settings.tsx");
    const effect = shell.slice(shell.indexOf("const applyLegacyHash"));
    // Without the root guard, an in-page anchor like #team or #billing on
    // /settings/appearance teleported the reader to another section — and
    // blocked the setting-level anchors P2 §1.4 asks for.
    expect(shell).toMatch(/if \(slug\) return;[\s\S]{0,200}const applyLegacyHash/);
    expect(effect.length).toBeGreaterThan(0);
  });
});

describe("fleet-8 catch — QuickFind stops swallowing the global palette key", () => {
  it("does not hijack Cmd/Ctrl+K on any of its ~18 mount points", () => {
    const quickFind = read("client/src/components/settings/SettingsQuickFind.tsx");
    expect(quickFind).not.toMatch(/metaKey \|\| e\.ctrlKey\) && e\.key\.toLowerCase\(\) === "k"/);
    // The visible hint matches the key it actually owns.
    expect(quickFind).not.toContain("Cmd+K");
  });

  it("'/' cannot fire while the user is typing in a section control", () => {
    const quickFind = read("client/src/components/settings/SettingsQuickFind.tsx");
    // tagName alone missed contentEditable and ARIA text widgets.
    expect(quickFind).toContain("isContentEditable");
    expect(quickFind).toContain('role === "combobox"');
    expect(quickFind).toContain('role === "textbox"');
  });
});

describe("fleet-8 catch — the registry's own claims are true", () => {
  it("the unrouted, unimported settings orphan is gone", () => {
    expect(fs.existsSync(path.resolve(ROOT, "client/src/pages/settings/api-keys.tsx"))).toBe(false);
  });

  it("the docstring claims only what the suite proves", () => {
    const registry = read("client/src/lib/settings-sections.ts");
    // "100% of the inventory" was an overclaim while a stray settings page
    // existed outside the registry.
    expect(registry).not.toContain("reach 100% of the inventory");
    expect(registry).toContain("every REGISTERED section");
  });
});
