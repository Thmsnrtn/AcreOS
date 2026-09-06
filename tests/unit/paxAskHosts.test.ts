/**
 * Every ask is answerable where it appears — the CLIENT half (the Pax
 * controls spec, docs/autonomous/AUTONOMY_SPEC.md §4.5 and §7; the server
 * half is tests/unit/paxAsksAreReachable.test.ts).
 *
 * The property: there is ONE ask card, `client/src/components/pax/PaxAskCard
 * .tsx`, and exactly four hosts render it — the chat message where Pax
 * proposed the ask (the desktop rail AND the /ai stream handler), the pinned
 * "Waiting for your tap" strip on /ai (how a phone answers — the rail returns
 * null on mobile), Today's decision queue (source "pax-ask"), and the support
 * chat (support-origin asks). Every one of them reads the server-formatted
 * ask through `usePaxNeedsYou`; none of them formats the ask itself, and no
 * other file offers an Approve / Reject for a pending action.
 *
 * Why a gate: the pre-program rail rendered its own `formatApprovalArgs`
 * wording and the /ai stream handler DROPPED the `pending_action` event the
 * server already yielded (server/ai/executive.ts) — an ask proposed on a
 * phone was invisible until the customer found the desktop rail. Four hosts
 * that drift are four wordings; a host that is missing is an ask nobody can
 * answer.
 *
 * Population (enumerated below, per-member vacuity):
 *   HOSTS         — the four files that must import and render PaxAskCard
 *   BADGE_HOSTS   — the two doors that must show the kernel's count
 *   client/src/** — the population scanned for a second approve path
 *
 * Mutation probes (each must go RED):
 *   1. delete the `data.type === "pending_action"` branch in
 *      client/src/pages/command-center.tsx → "the /ai stream handler …" fails
 *   2. remove `import PaxAskCard …` from any HOSTS member → that member fails
 *   3. add a `fetch("/api/pax/pending-actions/1/approve")` to any other
 *      client file → "no second approve path" fails
 *   4. add a ``data-testid={`pax-ask-approve-${id}`}`` to any other client
 *      file → "no second approve path" fails; turning DecisionQueue's
 *      selector into a rendered attribute fails the same assertion, while
 *      deleting the selector fails the reference half of it
 *
 * idempotent: true — pure source reads, no DB.
 */

import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


const ROOT = path.resolve(__dirname, "../..");
const CLIENT = path.join(ROOT, "client/src");
const CARD = "client/src/components/pax/PaxAskCard.tsx";
const HOOK = "client/src/hooks/usePaxNeedsYou.ts";
const CARD_IMPORT = "@/components/pax/PaxAskCard";
const HOOK_IMPORT = "@/hooks/usePaxNeedsYou";

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf-8");

/**
 * THE POPULATION. Exactly four hosts (spec §4.5). Adding a fifth surface
 * that renders the card without adding it here is the thing that fails
 * ("exactly four" below), and removing one is the thing that fails per
 * member.
 */
const HOSTS = [
  {
    id: "chat-rail",
    file: "client/src/components/pax-copilot-rail.tsx",
    surface: "the chat message where Pax proposed it — the desktop rail",
  },
  {
    id: "chat-ai-stream",
    file: "client/src/pages/command-center.tsx",
    surface: "the chat message where Pax proposed it — the /ai stream handler — and the pinned strip",
  },
  {
    id: "today-queue",
    file: "client/src/components/today/DecisionQueue.tsx",
    surface: "Today's decision queue, source \"pax-ask\"",
  },
  {
    id: "support-chat",
    file: "client/src/components/help/HelpPanel.tsx",
    surface: "the support chat, for support-origin asks",
  },
] as const;

/** The two doors that carry the count (spec §3c). */
const BADGE_HOSTS = [
  { id: "desktop-sidebar", file: "client/src/components/layout-sidebar.tsx", testid: "badge-pax-needs-you" },
  { id: "mobile-bottom-nav", file: "client/src/components/mobile/MobileBottomNav.tsx", testid: "badge-pax-needs-you-mobile" },
] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const CLIENT_FILES = walk(CLIENT).map((f) => path.relative(ROOT, f));

/** Does the file import the default export of PaxAskCard from the one module? */
function importsCard(src: string): boolean {
  return /import\s+PaxAskCard\s+from\s+["']@\/components\/pax\/PaxAskCard["']/.test(src);
}

/**
 * Parse a TSX file and return the text of every `if` condition that mentions
 * a `.type === "<literal>"` comparison — the SSE branch shape both chat hosts
 * use. A regex over raw text would be fooled by a comment; the AST is not.
 */
function ifConditionsMentioning(rel: string, literal: string): string[] {
  const src = read(rel);
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIfStatement(node)) {
      const cond = node.expression.getText(sf);
      if (cond.includes(`"${literal}"`) || cond.includes(`'${literal}'`)) hits.push(cond);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/**
 * The files that RENDER an approve/reject tap — a `data-testid` JSX attribute
 * whose value is one of the card's tap ids.
 *
 * This is an AST walk and not a substring test because the two things that
 * mention a tap id are opposites. A second file that renders
 * ``data-testid={`pax-ask-approve-${id}`}`` has grown its own answer control:
 * that is the defect this gate exists for. A file that REFERENCES the card's
 * tap by selector — Today's queue moves keyboard focus onto it so Enter lands
 * on the button instead of sending an email — is delegating to the one card,
 * which is the behaviour the gate wants. Forbidding the string outright would
 * have told the next author to duplicate the button rather than focus it.
 */
function filesRenderingTap(): string[] {
  const TAP = /^pax-ask-(approve|reject)-/;
  return CLIENT_FILES.filter((rel) => {
    const src = read(rel);
    if (!/pax-ask-(approve|reject)-/.test(src)) return false;
    const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let renders = false;
    const visit = (node: ts.Node) => {
      if (ts.isJsxAttribute(node) && node.name.getText(sf) === "data-testid" && node.initializer) {
        // `{`pax-ask-approve-${ask.id}`}` and `"pax-ask-approve-1"` both
        // normalise to the id text; a selector string is never a JSX
        // attribute value and so is never reached here at all.
        const value = node.initializer.getText(sf).replace(/^[{"'`\s]+/, "");
        if (TAP.test(value)) renders = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return renders;
  });
}

describe("PaxAskCard — the one card and its four hosts (spec §4.5)", () => {
  it("the card and the hook exist, and the card is the only file that renders the taps", () => {
    const card = read(CARD);
    expect(card).toContain("export default function PaxAskCard(");
    // The three taps, and only here.
    expect(card).toContain('data-testid={`pax-ask-approve-${ask.id}`}');
    expect(card).toContain('data-testid={`pax-ask-reject-${ask.id}`}');
    expect(card).toContain('data-testid={`pax-ask-edit-${ask.id}`}');
    // The card never formats the ask: it renders ask.verb / ask.text / ask.why.
    expect(card).toContain("{ask.verb}");
    expect(card).toContain("{ask.text}");
    expect(card).toContain("{ask.why}");
    // Expired asks get the glossary line and the one-tap draft-again link.
    expect(card).toContain("PAX_LABELS.expiredAsk");
    expect(card).toContain("/ai?prefill=");
    // While paused, the card says approving still sends (glossary words).
    expect(card).toContain("PAX_PAUSE_COPY.stillWorks");

    const hook = read(HOOK);
    for (const name of ["usePaxNeedsYou", "usePaxNeedsYouCount", "usePaxAskById", "usePaxAskActions"]) {
      expect(hook, `${HOOK} must export ${name}`).toContain(`export function ${name}(`);
    }
    // Live + poll fallback (spec §3c): the org channel event and the 5-minute poll.
    expect(hook).toContain('"pax.needs_you"');
    expect(hook).toContain("5 * 60 * 1000");
    expect(hook).toContain("useWebSocketChannel(");
  });

  it("enumerates exactly four hosts", () => {
    expect(HOSTS).toHaveLength(4);
    expect(new Set(HOSTS.map((h) => h.file)).size).toBe(4);
  });

  for (const host of HOSTS) {
    it(`host ${host.id} (${host.surface}) imports PaxAskCard and renders it`, () => {
      expect(fs.existsSync(path.join(ROOT, host.file)), `${host.file} must exist`).toBe(true);
      const src = read(host.file);
      // Vacuity: the file is not empty and actually renders the card.
      expect(src.length).toBeGreaterThan(200);
      expect(importsCard(src), `${host.file} must import PaxAskCard from ${CARD_IMPORT}`).toBe(true);
      expect(src.includes("<PaxAskCard"), `${host.file} must render <PaxAskCard`).toBe(true);
      // The host reads the server-formatted ask through the one hook.
      expect(src, `${host.file} must read asks through ${HOOK_IMPORT}`).toContain(`from "${HOOK_IMPORT}"`);
      // Every host wires all three taps through the card's props.
      for (const prop of ["onApprove=", "onReject=", "onRevise="]) {
        expect(src, `${host.file} must wire ${prop} on PaxAskCard`).toContain(prop);
      }
    });
  }

  it("no fifth file renders the card (exactly the four hosts)", () => {
    const renderers = CLIENT_FILES.filter((rel) => rel !== CARD && read(rel).includes("<PaxAskCard"));
    expect(renderers.sort()).toEqual([...HOSTS.map((h) => h.file)].sort());
  });

  it("the /ai stream handler has the pending_action branch (the server already yields it)", () => {
    const conditions = ifConditionsMentioning("client/src/pages/command-center.tsx", "pending_action");
    expect(
      conditions,
      "command-center.tsx must branch on data.type === \"pending_action\" inside its SSE reader",
    ).not.toHaveLength(0);
    // The condition must START with the type check, not merely CONTAIN it.
    // A substring assertion passes a branch that has been switched off:
    // prefixing `false && ` leaves `data.type === "pending_action"` in the
    // source and in this condition's text while the body can never run. That
    // is the same failure CLAUDE.md records for pinning a trigger by name —
    // the gate matched the mention, not the behaviour, and stayed green
    // through the probe that was supposed to kill it (2026-09-04).
    const live = conditions.filter((c) =>
      /^\(*\s*data\.type\s*===\s*["']pending_action["']/.test(c.replace(/\s+/g, " ").trim()),
    );
    expect(
      live,
      "the pending_action branch must be reached on its own type check — a " +
        "condition that only MENTIONS pending_action can be permanently false",
    ).not.toHaveLength(0);
    // And no condition guarding this branch may be short-circuited off.
    for (const c of conditions) {
      expect(
        /(^|[^\w.])false\s*&&/.test(c),
        `the pending_action branch is disabled by a constant: ${c}`,
      ).toBe(false);
    }
    // The branch stores the id and refreshes the queue read — it does not format the ask.
    const src = read("client/src/pages/command-center.tsx");
    const branchAt = src.indexOf('data.type === "pending_action"');
    const branch = src.slice(branchAt, branchAt + 900);
    expect(branch).toContain("pendingActionId");
    expect(branch).toContain("setConversationAsks");
    expect(branch).toContain("NEEDS_YOU_KEY");
    // And the server does yield it — the client branch is not decoration.
    expect(read("server/ai/executive.ts")).toContain('yield { type: "pending_action"');
  });

  it("the desktop rail has the same branch and no client-side formatter", () => {
    const conditions = ifConditionsMentioning("client/src/components/pax-copilot-rail.tsx", "pending_action");
    expect(conditions.some((c) => /data\.type\s*===\s*["']pending_action["']/.test(c))).toBe(true);
    const rail = read("client/src/components/pax-copilot-rail.tsx");
    expect(rail).not.toContain("formatApprovalArgs");
    // The rail is desktop-only; the strip below is how a phone answers.
    expect(rail).toContain("if (isMobileViewport) return null;");
  });

  it("the pinned strip lives on /ai above the composer, reads the queue, and expands to cards", () => {
    const src = read("client/src/pages/command-center.tsx");
    expect(src).toContain('data-testid="pax-needs-you-strip"');
    expect(src).toContain('data-testid="pax-needs-you-toggle"');
    expect(src).toContain("function PaxNeedsYouStrip()");
    expect(src).toContain("usePaxNeedsYou()");
    // The strip label is the glossary's one queue name with the live count.
    expect(src).toContain("`${PAX_LABELS.queue} (${count})`");
    // It renders BEFORE the composer's file input inside the composer block.
    const strip = src.indexOf("<PaxNeedsYouStrip />");
    const composer = src.indexOf('data-testid="input-message"');
    expect(strip).toBeGreaterThan(-1);
    expect(composer).toBeGreaterThan(strip);
  });

  it("Today's queue carries source \"pax-ask\" fed from the one queue read", () => {
    const queue = read("client/src/components/today/DecisionQueue.tsx");
    expect(queue).toContain('| "pax-ask"');
    expect(queue).toContain('item.source === "pax-ask" && item.ask');
    const today = read("client/src/pages/today.tsx");
    expect(today).toContain("usePaxNeedsYou()");
    expect(today).toContain('source: "pax-ask"');
    // The fabricated confidence treatment is gone from both files.
    for (const word of ["autoThreshold", "Pax would handle", "Override", "confidenceHistory", "ConfidenceBar", "/api/me/autonomy"]) {
      expect(queue, `DecisionQueue.tsx must not mention ${word}`).not.toContain(word);
      expect(today, `today.tsx must not mention ${word}`).not.toContain(word);
    }
  });

  it("the support chat renders the card for support-origin asks from the persisted artifact", () => {
    const src = read("client/src/components/help/HelpPanel.tsx");
    expect(src).toContain("pendingApproval === true");
    expect(src).toContain("function SupportAsk(");
  });

  for (const badge of BADGE_HOSTS) {
    it(`door badge ${badge.id} shows the server count through usePaxNeedsYouCount`, () => {
      const src = read(badge.file);
      expect(src.length).toBeGreaterThan(200);
      expect(src).toContain("usePaxNeedsYouCount");
      expect(src).toContain(`data-testid="${badge.testid}"`);
      // Never an invented zero: the badge renders only for a real positive count.
      expect(src).toMatch(/paxAskCount\s*(?:!=\s*null\s*&&\s*paxAskCount\s*)?>\s*0/);
    });
  }

  it("no second approve/reject path: only the hook posts to the pending-actions routes", () => {
    const posters = CLIENT_FILES.filter((rel) => read(rel).includes("/api/pax/pending-actions/"));
    expect(posters).toEqual([HOOK]);
    // Vacuity: the hook really does post all three.
    const hook = read(HOOK);
    for (const tail of ["/approve", "/reject", "/revise"]) {
      expect(hook).toContain(`/api/pax/pending-actions/\${pendingActionId}${tail}`);
    }
    // And no file other than the card RENDERS the taps.
    expect(filesRenderingTap()).toEqual([CARD]);

    // Both directions of that distinction are exercised by real files, so a
    // walk that quietly stopped matching JSX attributes cannot read as
    // "clean": the card must still come back as the one renderer (above),
    // and Today's queue must still mention a tap id WITHOUT rendering one.
    // Without this second half, deleting the card's `data-testid` and
    // deleting the walk's ability to see it look identical.
    const QUEUE = "client/src/components/today/DecisionQueue.tsx";
    expect(CLIENT_FILES).toContain(QUEUE);
    expect(
      /pax-ask-approve-/.test(read(QUEUE)),
      "DecisionQueue must still reach the card's Approve control by selector — " +
        "if that focus move is gone, Enter on a pax-ask row does nothing, and " +
        "this gate no longer distinguishes a reference from a render",
    ).toBe(true);
  });
});
