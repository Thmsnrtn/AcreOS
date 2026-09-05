/**
 * A failed chat read must never render as an empty conversation.
 *
 * The two reads behind the founder chat — the thread list and a thread's
 * message history — both used to end `if (!res.ok) return []`, with a
 * `catch { return [] }` behind that. So a 500, a dropped connection and a
 * founder who genuinely has no threads all produced the same value, and the
 * surfaces rendered the third one: a blank transcript, a thread count of zero,
 * and (on mobile) "Morning, Tom. Tap to start a thread." shown to someone with
 * months of history.
 *
 * Both hooks now use `okOrThrow`, so the queries land in their error state.
 * That is only half a fix. **A throw with nothing rendering it is the same
 * empty state by another route** — the lesson `fetchJsonArray` already cost —
 * so this test is about the OTHER half: that every surface reading these hooks
 * shows the failure.
 *
 * ── THE POPULATION IS THE POINT ─────────────────────────────────────────────
 * The obvious version of this test opens Dock.tsx, finds the failure branch and
 * passes. Dock is one of FOUR consumers. `BridgeAtlasPane`, `BridgeAtlasSheet`
 * and `ThreadSidebar` read the same two queries, and a failure message that
 * lives only in the Dock is a lie in the other three — which is exactly the
 * shape CLAUDE.md's third law describes: a rule installed on one file is a
 * claim about that file, not about the defect it names.
 *
 * So the consumer set is DERIVED, by scanning the client for imports of either
 * hook, and every member must render the shared `ChatUnavailable`. Adding a
 * fifth chat surface without a failure branch is what fails here — the thing a
 * hardcoded list of four could never catch.
 *
 * Two floors guard the derivation itself, because a scan that stops matching
 * reads exactly like a codebase that is clean:
 *   - a COUNT floor (the population may not silently empty), and
 *   - a PER-MEMBER vacuity assertion (each file must still contain the hook
 *     call the scan claims to have found it by).
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const CLIENT = path.join(ROOT, "client/src");

const HOOK_FILES = [
  "client/src/hooks/use-founder-chat.ts",
  "client/src/hooks/use-founder-chat-threads.ts",
];

/** What `useFounderChat` must hand a consumer so the failure is renderable. */
const HISTORY_FIELDS = ["historyUnavailable", "retryHistory", "historyRetrying"] as const;

/** The shared failure surface every consumer must render. */
const FAILURE_COMPONENT = "client/src/components/founder-chat/ChatUnavailable.tsx";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function read(rel: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

/**
 * Every file that CALLS either hook. Comments are stripped first: the hooks are
 * named in prose in several of these files (and in this repo a source predicate
 * reading its own documentation is a recorded failure mode), and a file that
 * merely mentions `useFounderChat` in a header comment is not a consumer.
 */
function deriveConsumers(): string[] {
  const consumers: string[] = [];
  for (const abs of walk(CLIENT)) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    if (HOOK_FILES.includes(rel)) continue;
    const src = stripComments(fs.readFileSync(abs, "utf8"));
    if (/\buseFounderChat(Threads)?\s*\(/.test(src)) consumers.push(rel);
  }
  return consumers.sort();
}

describe("founder chat: a failed read is visible, on every surface that reads it", () => {
  const consumers = deriveConsumers();

  it("finds the chat surfaces (population floor)", () => {
    // Measured 2026-09-05: Dock, BridgeAtlasPane, BridgeAtlasSheet, ThreadSidebar.
    // If a refactor genuinely removes surfaces, lower this in the same commit;
    // never let it pass by emptying.
    expect(consumers.length).toBeGreaterThanOrEqual(4);
  });

  it.each(HOOK_FILES)("%s throws on a failed read instead of returning []", (rel) => {
    const src = read(rel);
    expect(src).toMatch(/\bokOrThrow\s*\(/);
    // The defect itself, in either of its two spellings.
    expect(src).not.toMatch(/if\s*\(\s*!\s*res(?:ponse)?\.ok\s*\)\s*return\s+\[\]/);
    expect(src).not.toMatch(/catch[\s\S]{0,40}?\{\s*return\s+\[\]\s*;?\s*\}/);
  });

  it("exposes the history failure to consumers, not just to itself", () => {
    const src = read("client/src/hooks/use-founder-chat.ts");
    // The DECLARED result type, not merely the file — a field a consumer
    // cannot see on the hook's contract cannot be rendered, and the hook
    // mentions each of these several times internally.
    const iface = src.match(/interface UseFounderChatResult\s*\{([\s\S]*?)\n\}/);
    expect(iface, "UseFounderChatResult not found").toBeTruthy();
    const body = iface![1];
    for (const field of HISTORY_FIELDS) {
      // Word-bounded: `historyUnavailable_RENAMED` CONTAINS `historyUnavailable`,
      // and this repo has already shipped a gate that a `…_RENAMED` rename walked
      // straight through. Underscore is a word character, so \b rejects it.
      expect(body).toMatch(new RegExp(`\\b${field}\\b\\s*:`));
    }
    // And actually returned, not only declared.
    const ret = src.slice(src.lastIndexOf("return {"));
    for (const field of HISTORY_FIELDS) {
      expect(ret).toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  it("has one shared failure surface, saying which read failed", () => {
    const src = read(FAILURE_COMPONENT);
    expect(src).toContain('role="alert"');
    // Both readings, because they are different situations for the reader:
    // no thread list means no conversation at all; a failed history means the
    // conversation on screen is incomplete.
    expect(src).toContain("Couldn't load your conversations");
    expect(src).toContain("Couldn't load this conversation's history");
    // And a way out.
    expect(src).toContain("Try again");
  });

  describe.each(consumers)("%s", (rel) => {
    const src = read(rel);

    it("still calls the hook the scan matched it by (vacuity)", () => {
      expect(src).toMatch(/\buseFounderChat(Threads)?\s*\(/);
    });

    it("renders the shared failure surface", () => {
      expect(src).toContain("ChatUnavailable");
      // Imported AND used — an unused import satisfies a naive contains().
      expect(src).toMatch(/<ChatUnavailable\b/);
    });

    it("wires that surface to a real failure signal", () => {
      // Not merely present: reachable. Whichever of the two reads this surface
      // performs, it must branch on that read's error state.
      const readsThreads = /\buseFounderChatThreads\s*\(/.test(src);
      const readsHistory = /\buseFounderChat\s*\(/.test(src);
      const signals: RegExp[] = [];
      if (readsThreads) signals.push(/\bisError\s*:/);
      if (readsHistory) signals.push(/\bhistoryUnavailable\b/);
      for (const signal of signals) expect(src).toMatch(signal);
    });
  });
});
