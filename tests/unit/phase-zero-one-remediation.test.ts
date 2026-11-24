/**
 * Phase Zero-One remediation contract tests.
 *
 * These tests pin the source-level invariants introduced by the four Phase
 * Zero-One bug fixes. They run in `npm test` (vitest, node-only) so a
 * regression cannot reach `main` without flipping a clearly-named contract.
 *
 * Surfaces guarded:
 *   1. fb46d356 — non-founder users must never see Team / Background / AI Ops
 *      tabs on /ai (constitution: Customer AI = Pax only; internal codenames
 *      Sophie / Forge / Atlas / "Acquisitions VA" / "Collections VA" /
 *      "Executive VA" must not render for customers). Since the Pax controls
 *      program (2026-09-02, spec §3b) customers see NO tab strip at all —
 *      the conversation alone; the Tasks tab (a dead-letter queue with an
 *      invented price) is deleted for everyone.
 *   2. d3fd2b9b — the Pax overflow menu DropdownMenu → Sheet handoff must
 *      defer setView() inside requestAnimationFrame on every menu item that
 *      opens the Sheet (otherwise a blank frosted overlay races the slide-in).
 *   3. 8d5d3ca2 — three named touch buttons (Pax greeting dismiss, agent
 *      detail back, attachment remove) must use `active:` not `hover:` for
 *      their tap-feedback class, and the conversation delete button must
 *      include the `[@media(hover:none)]:opacity-60` escape hatch so it
 *      doesn't require a phantom hover on touch devices.
 *   4. 8d5d3ca2 — TeamTabContent's three-column layout (w-72 | flex-1 | w-80)
 *      must collapse correctly on mobile: the roster column responsively
 *      goes full-width, the middle column is hidden md+, and the detail
 *      panel is shown only when an agent is selected on mobile.
 *
 * Test method: read the source file, assert the literal class strings /
 * conditionals / handler shapes. Cheap, deterministic, no Postgres required.
 * The real rendered behavior is covered by the mobile E2E spec
 * (tests/e2e-mobile/pax-founder-gate.spec.ts) which runs in CI on every push.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { stripComments } from "../helpers/stripComments";

const CLIENT_SRC = path.resolve(__dirname, "../../client/src");
const COMMAND_CENTER = path.join(CLIENT_SRC, "pages/command-center.tsx");
/**
 * The founder-only agent console (VA roster, activity feed, agent detail, AI
 * Ops, background services) was extracted OUT of the customer's /ai door on
 * 2026-09-04 into client/src/components/founder/ai-console/*, where it is
 * still rendered behind the same isFounder guard. The invariants below —
 * touch targets use `active:` not `hover:`, the roster/feed/detail columns
 * are responsive, the AI Ops grid is 1→2→4 — did not stop mattering because
 * the markup moved, so the assertions FOLLOW it instead of being deleted.
 * The union is read as one string: any of these files may carry the markup,
 * and a member that stops existing fails the vacuity check below.
 */
const AI_CONSOLE_FILES = [
  path.join(CLIENT_SRC, "pages/command-center.tsx"),
  path.join(CLIENT_SRC, "components/founder/ai-console/VaTeamPanel.tsx"),
  path.join(CLIENT_SRC, "components/founder/ai-console/AiOperationsPanel.tsx"),
  path.join(CLIENT_SRC, "components/founder/ai-console/BackgroundServicesPanel.tsx"),
];
const PAX_PAGE = path.join(CLIENT_SRC, "pages/pax.tsx");
const PAX_OVERFLOW_MENU = path.join(CLIENT_SRC, "components/pax/pax-overflow-menu.tsx");

function read(p: string): string {
  return fs.readFileSync(p, "utf-8");
}

describe("the AI-console union is real (vacuity guard)", () => {
  it("every file the console assertions read exists and has content", () => {
    for (const f of AI_CONSOLE_FILES) {
      expect(fs.existsSync(f), `${f} — the console union names a file that is gone`).toBe(true);
      expect(read(f).length, `${f} is empty`).toBeGreaterThan(500);
    }
  });
});

// ─── 1. Founder-gate on /ai surface (fb46d356) ───────────────────────────────

describe("fb46d356 — /ai founder console is out of the customer's door (constitution: Customer AI = Pax only)", () => {
  // THE INVARIANT IS UNCHANGED — a customer never sees Team / Background / AI Ops
  // and never receives the founder's agent codenames on /ai. The MECHANISM got
  // stronger (P1-9 / X-2, the founder/customer build split): the console used
  // to be tabs on this customer page behind `FOUNDER_ONLY_TABS` + `isFounder`,
  // which put ≈30 KB of founder code in the customer bundle. It now renders
  // only in the founder build, as tabs on /founder/agent-queue, so a customer
  // session cannot render it by any state at all — the code is not in their
  // bundle. These assertions follow it there instead of being deleted.
  const src = read(COMMAND_CENTER);
  const AGENT_QUEUE = path.join(CLIENT_SRC, "pages/founder/agent-queue.tsx");

  it("imports the useAuth hook (source of isFounder)", () => {
    expect(src).toMatch(/import\s+\{\s*useAuth\s*\}\s+from\s+["']@\/hooks\/use-auth["']/);
  });

  it("destructures isFounder from useAuth() inside CommandCenterPage", () => {
    expect(src).toMatch(/const\s+\{\s*isFounder\s*\}\s*=\s*useAuth\(\)/);
  });

  it("the customer page no longer contains, imports or renders any founder console panel", () => {
    // Read the code, not the prose (the file explains the move in comments).
    const code = stripComments(src);
    expect(code, "command-center imports the founder AI console again").not.toMatch(
      /components\/founder(?:\/|-)/,
    );
    for (const panel of ["VaTeamPanel", "BackgroundServicesPanel", "AiOperationsPanel"]) {
      expect(code, `${panel} is back in the customer's /ai page`).not.toContain(panel);
    }
    for (const testid of ["tab-team", "tab-agents", "tab-ai-ops"]) {
      expect(code, `the ${testid} trigger is back on the customer's /ai page`).not.toContain(testid);
    }
    expect(code).not.toContain("FOUNDER_ONLY_TABS");
  });

  it("the only founder affordance is a door, shown only when isFounder, that is a full-page link", () => {
    const code = stripComments(src);
    const at = code.indexOf('data-testid="link-founder-agent-console"');
    expect(at, "the founder door is gone from command-center").toBeGreaterThan(-1);
    // The unit is the whole `{isFounder ? (…) : …}` arm, not the tail after the testid.
    const gate = code.lastIndexOf("{isFounder ?", at);
    expect(gate, "the founder door is not behind an isFounder gate").toBeGreaterThan(-1);
    expect(at - gate, "the isFounder gate is not the one enclosing the door").toBeLessThan(600);
    const anchor = code.slice(code.lastIndexOf("<a ", at), code.indexOf("</a>", at));
    // A plain <a href>, not wouter's <Link>: the founder build is a separate
    // bundle, and a client-side navigation to /founder would land on NotFound.
    expect(anchor).toContain('href="/founder/agent-queue"');
  });

  it("the console lives on an already-routed founder page, as tabs, behind FounderProtectedRoute", () => {
    const queue = read(AGENT_QUEUE);
    expect(queue).toMatch(/from\s+["']@\/components\/founder\/ai-console["']/);
    for (const [testid, panel] of [
      ["tab-team", "VaTeamPanel"],
      ["tab-agents", "BackgroundServicesPanel"],
      ["tab-ai-ops", "AiOperationsPanel"],
    ] as const) {
      expect(queue, `${testid} trigger is not on /founder/agent-queue`).toContain(`data-testid="${testid}"`);
      expect(queue, `${panel} is not rendered on /founder/agent-queue`).toContain(`<${panel} />`);
    }
    // Reachable only through the founder route tree, behind the founder guard.
    const routes = read(path.join(CLIENT_SRC, "founder-routes.tsx"));
    expect(routes).toMatch(
      /<Route path="\/founder\/agent-queue">\s*\{\(\) => <FounderProtectedRoute component=\{FounderAgentQueuePage\} \/>\}/,
    );
  });

  it("the Tasks tab is gone for everyone and customers get the conversation alone", () => {
    // Pax controls program (spec §3b, §3d): the customer Tasks tab — a
    // dead-letter queue with an invented "$0.02 per task" price — is deleted,
    // not gated. Customers see no tab strip.
    expect(src, "the Tasks tab trigger must not exist").not.toContain('data-testid="tab-tasks"');
    expect(src).not.toContain("TasksTabContent");
    expect(src).not.toContain("$0.02");
    expect(src).not.toContain("Deploy Agent");
    // The gear is a link to the ONE Pax control surface, not an in-place dialog.
    expect(src).toContain('data-testid="button-pax-settings"');
    expect(src).not.toContain("AISettings");
  });
});

// ─── 2. DropdownMenu → Sheet rAF deferral (d3fd2b9b) ─────────────────────────

describe("d3fd2b9b — Pax overflow menu defers setView via requestAnimationFrame", () => {
  const src = read(PAX_OVERFLOW_MENU);

  it("every DropdownMenuItem that opens the Sheet calls preventDefault + rAF", () => {
    // Three handlers: activity ("What Pax did"), appeals, agents. Each must
    // defer setView so the dropdown finishes closing before the Sheet
    // overlay mounts. ("Insights" left the customer menu in the Pax controls
    // program — a banned menu label with fabricated dollar badges.)
    for (const view of ["activity", "appeals", "agents"] as const) {
      const pattern = new RegExp(
        `onSelect=\\{\\(e\\)\\s*=>\\s*\\{[\\s\\S]*?e\\.preventDefault\\(\\)[\\s\\S]*?requestAnimationFrame\\(\\(\\)\\s*=>\\s*setView\\("${view}"\\)\\)`,
      );
      expect(src, `${view} handler must preventDefault + rAF`).toMatch(pattern);
    }
  });

  it("the comment explaining the iOS race condition is preserved", () => {
    // Future maintainers must see WHY this is deferred — otherwise the next
    // refactor will collapse it back to synchronous setView.
    expect(src).toMatch(/iOS[\s\S]{0,200}DropdownMenu close[\s\S]{0,200}Sheet open/);
    expect(src).toMatch(/blank frosted/i);
  });
});

// ─── 3. Touch-feedback hover→active swap (8d5d3ca2) ──────────────────────────

describe("8d5d3ca2 — touch buttons use active: instead of hover: (iOS double-tap fix)", () => {
  it("Pax greeting dismiss button uses active:text-acr-brand (not hover:)", () => {
    const src = read(PAX_PAGE);
    // The dismiss X-button in GreetingBanner. The aria-label is the anchor.
    const block = src.match(
      /aria-label="Dismiss greeting from Pax"[\s\S]{0,300}/,
    )?.[0];
    expect(block, "GreetingBanner dismiss button not found").toBeTruthy();
    expect(block, "dismiss button must use active: not hover:").toMatch(
      /active:text-acr-brand/,
    );
    expect(block).not.toMatch(/hover:text-acr-brand(?!-)/);
  });

  it("agent detail back button (md:hidden) uses active:text-foreground", () => {
    const src = AI_CONSOLE_FILES.map(read).join("\n");
    // The className sits BEFORE the aria-label in the JSX. Capture both halves.
    const idx = src.indexOf('aria-label="Back to agent roster"');
    expect(idx, "agent-detail back button not found").toBeGreaterThan(-1);
    const block = src.slice(Math.max(0, idx - 400), idx + 200);
    expect(block).toMatch(/md:hidden/);
    expect(block).toMatch(/active:text-foreground/);
    expect(block).not.toMatch(/hover:text-foreground/);
  });

  it("attachment remove button uses active:bg-muted", () => {
    const src = AI_CONSOLE_FILES.map(read).join("\n");
    const block = src.match(
      /aria-label={`Remove attachment[\s\S]{0,500}/,
    )?.[0];
    expect(block, "attachment-remove button not found").toBeTruthy();
    expect(block).toMatch(/active:bg-muted/);
    // The duplicate `.rounded` class that the commit removed must stay removed.
    expect(block).not.toMatch(/hover:bg-muted/);
  });

  it("conversation delete button has [@media(hover:none)] escape for touch", () => {
    const src = AI_CONSOLE_FILES.map(read).join("\n");
    // The aria-label is templated: `Delete conversation ${...}`. Anchor on it.
    const idx = src.indexOf("Delete conversation");
    expect(idx, "delete-conversation button not found").toBeGreaterThan(-1);
    const block = src.slice(Math.max(0, idx - 400), idx + 200);
    expect(
      block,
      "delete-conversation must have [@media(hover:none)]:opacity-60 escape",
    ).toMatch(/\[@media\(hover:none\)\]:opacity-60/);
    expect(block).toMatch(/group-focus-within:opacity-100/);
  });
});

// ─── 4. TeamTabContent 3-column responsive collapse (8d5d3ca2) ───────────────

describe("8d5d3ca2 — TeamTabContent 3-column layout collapses for mobile (390px)", () => {
  const src = AI_CONSOLE_FILES.map(read).join("\n");

  it("roster column is full-width on mobile, w-72 on md+", () => {
    // The fixed `w-72` was clipping at 390px iPhone width. New layout:
    // roster goes w-full on mobile, md:w-72; hidden when an agent is selected
    // so the detail panel can take the screen.
    expect(src).toMatch(
      /selectedAgentId\s*\?\s*"hidden md:flex"\s*:\s*"flex"[\s\S]{0,200}w-full md:w-72/,
    );
  });

  it("middle activity feed is hidden below md (mobile-hidden)", () => {
    expect(src).toMatch(
      /\{\/\*\s*Activity feed:\s*hidden on mobile[\s\S]{0,200}\*\/\}\s*<div className="hidden md:flex flex-1 flex-col/,
    );
  });

  it("detail panel is shown on mobile only when an agent is selected", () => {
    expect(src).toMatch(
      /selectedAgentId\s*\?\s*"flex"\s*:\s*"hidden md:flex"[\s\S]{0,200}w-full md:w-80/,
    );
  });

  it("AI Ops quick-action grid uses 1→2→4 responsive cols (no 2-col forced at 390px)", () => {
    // Previously `grid-cols-2 md:grid-cols-4` cramped 2 columns at 390px.
    // Now starts at 1 col, expands at sm:, then md:.
    expect(src).toMatch(/grid-cols-1 sm:grid-cols-2 md:grid-cols-4/);
  });
});
