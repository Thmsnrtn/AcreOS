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
 *      "Executive VA" must not render for customers).
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

const CLIENT_SRC = path.resolve(__dirname, "../../client/src");
const COMMAND_CENTER = path.join(CLIENT_SRC, "pages/command-center.tsx");
const PAX_PAGE = path.join(CLIENT_SRC, "pages/pax.tsx");
const PAX_OVERFLOW_MENU = path.join(CLIENT_SRC, "components/pax/pax-overflow-menu.tsx");

function read(p: string): string {
  return fs.readFileSync(p, "utf-8");
}

// ─── 1. Founder-gate on /ai surface (fb46d356) ───────────────────────────────

describe("fb46d356 — /ai tabs founder-gate (constitution: Customer AI = Pax only)", () => {
  const src = read(COMMAND_CENTER);

  it("imports the useAuth hook (source of isFounder)", () => {
    expect(src).toMatch(/import\s+\{\s*useAuth\s*\}\s+from\s+["']@\/hooks\/use-auth["']/);
  });

  it("destructures isFounder from useAuth() inside CommandCenterPage", () => {
    expect(src).toMatch(/const\s+\{\s*isFounder\s*\}\s*=\s*useAuth\(\)/);
  });

  it("declares the FOUNDER_ONLY_TABS allowlist (team, agents, ai-ops)", () => {
    // The mount-time bouncer reads this list. Drift here = the bouncer no
    // longer covers a tab. Pin exactly.
    expect(src).toMatch(
      /const\s+FOUNDER_ONLY_TABS\s*=\s*\["team",\s*"agents",\s*"ai-ops"\]\s+as\s+const/,
    );
  });

  it("redirects non-founders off any FOUNDER_ONLY_TABS via useEffect", () => {
    // The bouncer must reset mainTab to "chat" when isFounder is false and
    // the active tab is founder-only (saved URL / hash deep-link case).
    expect(src).toMatch(/!isFounder\s*&&\s*FOUNDER_ONLY_TABS\.includes\(/);
    expect(src).toMatch(/setMainTab\("chat"\)/);
  });

  it("wraps each TabsTrigger for team/agents/ai-ops with {isFounder && …}", () => {
    // The trigger only renders on founder sessions. Three sites, all gated.
    const teamTrigger = /\{isFounder\s*&&\s*\([\s\S]{0,200}data-testid="tab-team"/;
    const agentsTrigger = /\{isFounder\s*&&\s*\([\s\S]{0,200}data-testid="tab-agents"/;
    const aiOpsTrigger = /\{isFounder\s*&&\s*\([\s\S]{0,200}data-testid="tab-ai-ops"/;
    expect(src, "Team trigger must be founder-gated").toMatch(teamTrigger);
    expect(src, "Agents trigger must be founder-gated").toMatch(agentsTrigger);
    expect(src, "AI Ops trigger must be founder-gated").toMatch(aiOpsTrigger);
  });

  it("guards the TabsContent for team/agents/ai-ops with && isFounder", () => {
    // Defense in depth: even if mainTab were forced to a founder tab value,
    // the content blocks must not render for non-founders.
    expect(src).toMatch(/mainTab\s*===\s*"team"\s*&&\s*isFounder/);
    expect(src).toMatch(/mainTab\s*===\s*"agents"\s*&&\s*isFounder/);
    expect(src).toMatch(/mainTab\s*===\s*"ai-ops"\s*&&\s*isFounder/);
  });

  it("leaves Chat (assistant) and Tasks ungated — every authed user sees them", () => {
    // The two non-founder-visible tabs must NOT be wrapped in {isFounder && …}.
    // A regression here would hide Chat/Tasks from customers.
    const chatLine = src.match(/data-testid="tab-chat"[\s\S]{0,200}/)?.[0] || "";
    const tasksLine = src.match(/data-testid="tab-tasks"[\s\S]{0,200}/)?.[0] || "";
    // The 200 chars BEFORE the trigger must not include `{isFounder && (`
    const chatPrefix = src.slice(
      Math.max(0, src.indexOf('data-testid="tab-chat"') - 200),
      src.indexOf('data-testid="tab-chat"'),
    );
    const tasksPrefix = src.slice(
      Math.max(0, src.indexOf('data-testid="tab-tasks"') - 200),
      src.indexOf('data-testid="tab-tasks"'),
    );
    expect(chatLine.length).toBeGreaterThan(0);
    expect(tasksLine.length).toBeGreaterThan(0);
    expect(chatPrefix, "Chat tab must not be founder-gated").not.toMatch(
      /\{isFounder\s*&&\s*\(\s*$/,
    );
    expect(tasksPrefix, "Tasks tab must not be founder-gated").not.toMatch(
      /\{isFounder\s*&&\s*\(\s*$/,
    );
  });
});

// ─── 2. DropdownMenu → Sheet rAF deferral (d3fd2b9b) ─────────────────────────

describe("d3fd2b9b — Pax overflow menu defers setView via requestAnimationFrame", () => {
  const src = read(PAX_OVERFLOW_MENU);

  it("every DropdownMenuItem that opens the Sheet calls preventDefault + rAF", () => {
    // Three handlers: insights, activity, agents. Each must defer setView so
    // the dropdown finishes closing before the Sheet overlay mounts.
    for (const view of ["insights", "activity", "agents"] as const) {
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
    const src = read(COMMAND_CENTER);
    // The className sits BEFORE the aria-label in the JSX. Capture both halves.
    const idx = src.indexOf('aria-label="Back to agent roster"');
    expect(idx, "agent-detail back button not found").toBeGreaterThan(-1);
    const block = src.slice(Math.max(0, idx - 400), idx + 200);
    expect(block).toMatch(/md:hidden/);
    expect(block).toMatch(/active:text-foreground/);
    expect(block).not.toMatch(/hover:text-foreground/);
  });

  it("attachment remove button uses active:bg-muted", () => {
    const src = read(COMMAND_CENTER);
    const block = src.match(
      /aria-label={`Remove attachment[\s\S]{0,500}/,
    )?.[0];
    expect(block, "attachment-remove button not found").toBeTruthy();
    expect(block).toMatch(/active:bg-muted/);
    // The duplicate `.rounded` class that the commit removed must stay removed.
    expect(block).not.toMatch(/hover:bg-muted/);
  });

  it("conversation delete button has [@media(hover:none)] escape for touch", () => {
    const src = read(COMMAND_CENTER);
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
  const src = read(COMMAND_CENTER);

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
