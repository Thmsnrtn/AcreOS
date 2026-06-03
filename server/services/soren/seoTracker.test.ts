/**
 * Tests for Soren SEO ranking tracker — rank-change detection +
 * SERP-HTML parser.
 *
 * Pure-unit coverage — no live Google call. The parser is exercised
 * against a static fixture that mirrors the relevant shape of a Google
 * SERP result page.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock("../solene/dispatchQueue", () => ({
  enqueueDispatch: vi.fn(),
}));

import {
  buildSeoIterationPrompt,
  detectRankChange,
  maybeEnqueueSeoIterationDispatch,
  parseRankFromSerpHtml,
  type RankChange,
} from "./seoTracker";
import {
  SOREN_RANK_CHANGE_THRESHOLD,
  SOREN_SERP_MAX_RANK,
} from "@shared/schema/soren-seo";
import { logger } from "../../utils/logger";

describe("detectRankChange", () => {
  it("returns null when both observations are null (still unranked)", () => {
    expect(detectRankChange(null, null)).toBeNull();
  });

  it("returns 'entered' when prior null and latest non-null", () => {
    const r = detectRankChange(null, 50);
    expect(r).not.toBeNull();
    expect(r!.direction).toBe("entered");
  });

  it("returns 'exited' when prior non-null and latest null", () => {
    const r = detectRankChange(30, null);
    expect(r).not.toBeNull();
    expect(r!.direction).toBe("exited");
  });

  it("fires 'improved' when rank moves up by ≥ threshold", () => {
    // prior 40 → latest 20 = improved by 20 positions
    const r = detectRankChange(40, 20);
    expect(r).not.toBeNull();
    expect(r!.direction).toBe("improved");
    expect(r!.delta).toBe(20);
  });

  it("fires 'dropped' when rank moves down by ≥ threshold", () => {
    // prior 10 → latest 30 = dropped by 20 positions
    const r = detectRankChange(10, 30);
    expect(r).not.toBeNull();
    expect(r!.direction).toBe("dropped");
    expect(r!.delta).toBe(-20);
  });

  it("does NOT fire on movement under the threshold", () => {
    // 5-position drift — under the 10-position threshold
    expect(detectRankChange(15, 20)).toBeNull();
    expect(detectRankChange(20, 15)).toBeNull();
  });

  it("fires exactly at the threshold boundary", () => {
    // Math.abs(delta) >= SOREN_RANK_CHANGE_THRESHOLD — equality fires.
    const r = detectRankChange(20, 20 - SOREN_RANK_CHANGE_THRESHOLD);
    expect(r).not.toBeNull();
  });

  it("respects threshold constant import (defensive against future tuning)", () => {
    expect(SOREN_RANK_CHANGE_THRESHOLD).toBeGreaterThanOrEqual(5);
  });
});

describe("parseRankFromSerpHtml", () => {
  it("returns null on empty HTML", () => {
    expect(parseRankFromSerpHtml("", "acreos.io/learn/x")).toBeNull();
  });

  it("returns null on HTML too short to be a SERP page", () => {
    expect(
      parseRankFromSerpHtml("<html><body>too short</body></html>", "acreos.io/x"),
    ).toBeNull();
  });

  it("returns null when Google served a CAPTCHA-style interstitial", () => {
    const captcha =
      "<html><head><title>Our systems have detected unusual traffic from your computer network.</title></head><body>" +
      "x".repeat(2000) +
      "</body></html>";
    expect(parseRankFromSerpHtml(captcha, "acreos.io/x")).toBeNull();
  });

  it("finds rank=1 when target URL is the first organic result", () => {
    const html = buildSerpFixture([
      "https://acreos.io/learn/land-flipping/texas",
      "https://example.com/other",
      "https://another.com/page",
    ]);
    const r = parseRankFromSerpHtml(html, "acreos.io/learn/land-flipping/texas");
    expect(r).toBe(1);
  });

  it("finds the correct rank when target is buried in the list", () => {
    const html = buildSerpFixture([
      "https://wikipedia.org/a",
      "https://reddit.com/b",
      "https://medium.com/c",
      "https://acreos.io/learn/land-flipping/texas",
      "https://example.com/d",
    ]);
    const r = parseRankFromSerpHtml(html, "acreos.io/learn/land-flipping/texas");
    expect(r).toBe(4);
  });

  it("handles Google's /url?q= wrapped hrefs", () => {
    const wrapped = encodeURIComponent(
      "https://acreos.io/learn/note-investing/texas",
    );
    const html =
      "<html>" +
      "x".repeat(1500) +
      `<a href="/url?q=https://example.com/other&sa=U">other</a>` +
      `<a href="/url?q=${wrapped}&sa=U">our page</a>` +
      "</html>";
    const r = parseRankFromSerpHtml(
      html,
      "acreos.io/learn/note-investing/texas",
    );
    expect(r).toBe(2);
  });

  it("returns null when target URL is not present", () => {
    const html = buildSerpFixture([
      "https://wikipedia.org/a",
      "https://reddit.com/b",
      "https://example.com/c",
    ]);
    expect(parseRankFromSerpHtml(html, "acreos.io/learn/x/y")).toBeNull();
  });

  it("skips Google's own internal links when counting rank", () => {
    const html =
      "<html>" +
      "x".repeat(1500) +
      `<a href="/search?q=foo">internal</a>` +
      `<a href="https://www.google.com/maps">maps</a>` +
      `<a href="https://acreos.io/learn/land-flipping/florida">us</a>` +
      "</html>";
    // Despite being the 3rd anchor in the HTML, it's the 1st organic.
    const r = parseRankFromSerpHtml(
      html,
      "acreos.io/learn/land-flipping/florida",
    );
    expect(r).toBe(1);
  });

  it("dedupes the same result URL appearing twice (title + caret)", () => {
    const html =
      "<html>" +
      "x".repeat(1500) +
      `<a href="https://example.com/first">first</a>` +
      `<a href="https://acreos.io/learn/x">us</a>` +
      `<a href="https://acreos.io/learn/x">us-again</a>` +
      `<a href="https://example.com/third">third</a>` +
      "</html>";
    const r = parseRankFromSerpHtml(html, "acreos.io/learn/x");
    expect(r).toBe(2);
  });

  it("respects SOREN_SERP_MAX_RANK ceiling", () => {
    expect(SOREN_SERP_MAX_RANK).toBe(100);
  });
});

/**
 * Build a minimal SERP fixture with the given URLs as organic anchors.
 * Length-padded so the parser's length check doesn't reject it as
 * interstitial.
 */
function buildSerpFixture(urls: string[]): string {
  const anchors = urls
    .map((u) => `<a href="${u}" data-ved="x">title for ${u}</a>`)
    .join("\n");
  const padding = "x".repeat(2000);
  return `<html><body>${padding}<div id="results">${anchors}</div></body></html>`;
}

// ============================================================================
// buildSeoIterationPrompt — pure-function content check
// ============================================================================

describe("buildSeoIterationPrompt", () => {
  it("includes all six load-bearing input fields in the prompt body", () => {
    const prompt = buildSeoIterationPrompt({
      pageSlug: "/learn/land-flipping/texas",
      keyword: "tax delinquent land texas",
      previousRank: 8,
      currentRank: 22,
      rankDropPositions: 14,
      serpSnapshot: "TOP3-SNAPSHOT-MARKER-XYZ",
    });
    // 1. pageSlug
    expect(prompt).toContain("/learn/land-flipping/texas");
    // 2. keyword
    expect(prompt).toContain("tax delinquent land texas");
    // 3. previousRank
    expect(prompt).toContain("#8");
    // 4. currentRank
    expect(prompt).toContain("#22");
    // 5. rankDropPositions
    expect(prompt).toContain("14");
    // 6. serpSnapshot
    expect(prompt).toContain("TOP3-SNAPSHOT-MARKER-XYZ");
  });

  it("renders null ranks as 'not-in-top-100' rather than '#null'", () => {
    const prompt = buildSeoIterationPrompt({
      pageSlug: "/learn/note-investing/ohio",
      keyword: "ohio mortgage note investing",
      previousRank: null,
      currentRank: null,
      rankDropPositions: 0,
      serpSnapshot: "snap",
    });
    expect(prompt).toContain("not-in-top-100");
    expect(prompt).not.toContain("#null");
  });

  it("mentions Maren CPO escalation for hypothesis-shifting changes", () => {
    const prompt = buildSeoIterationPrompt({
      pageSlug: "/learn/land-flipping/florida",
      keyword: "florida tax deed land",
      previousRank: 5,
      currentRank: 30,
      rankDropPositions: 25,
      serpSnapshot: "snap",
    });
    expect(prompt.toLowerCase()).toContain("maren");
  });
});

// ============================================================================
// maybeEnqueueSeoIterationDispatch — detector → live queue wire-in
// ============================================================================

describe("maybeEnqueueSeoIterationDispatch", () => {
  const baseArgs = {
    pagePath: "/learn/land-flipping/texas",
    keyword: "tax delinquent land texas",
    priorRank: 8,
    latestRank: 20,
    change: { delta: -12, direction: "dropped" } as RankChange,
    trackerRunId: "1717459200000",
  };

  beforeEach(() => {
    (logger.info as ReturnType<typeof vi.fn>).mockClear();
    (logger.warn as ReturnType<typeof vi.fn>).mockClear();
  });

  it("rank drop 12 positions on /learn page → enqueueDispatch called with expected shape", async () => {
    const enqueueMock = vi.fn().mockResolvedValue(4242);
    const existsMock = vi.fn().mockResolvedValue(false);

    const result = await maybeEnqueueSeoIterationDispatch(baseArgs, {
      enqueueDispatchImpl: enqueueMock as never,
      existingDispatchCheckImpl: existsMock,
    });

    expect(result.enqueued).toBe(true);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const call = enqueueMock.mock.calls[0][0];
    expect(call.sourceType).toBe("detector");
    expect(call.agentRole).toBe("soren");
    expect(call.priority).toBe(1.2);
    expect(call.maxCostUsd).toBe(15);
    expect(call.timeoutMs).toBe(8 * 60 * 1000);
    expect(call.enqueuedBy).toBe("soren-seo-tracker");
    expect(call.sourceId).toContain(baseArgs.pagePath);
    expect(call.sourceId).toContain(baseArgs.keyword);
    expect(call.sourceId).toContain(baseArgs.trackerRunId);
    expect(call.promptText).toContain(baseArgs.pagePath);
    expect(call.promptText).toContain(baseArgs.keyword);
  });

  it("rank drop 7 positions → does NOT enqueue (under threshold)", async () => {
    const enqueueMock = vi.fn();
    const existsMock = vi.fn().mockResolvedValue(false);

    const result = await maybeEnqueueSeoIterationDispatch(
      {
        ...baseArgs,
        priorRank: 10,
        latestRank: 17,
        change: { delta: -7, direction: "dropped" } as RankChange,
      },
      {
        enqueueDispatchImpl: enqueueMock as never,
        existingDispatchCheckImpl: existsMock,
      },
    );

    expect(result.enqueued).toBe(false);
    expect(result.reason).toBe("under_threshold");
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("already-queued same (pagePath, keyword) tuple → skip", async () => {
    const enqueueMock = vi.fn();
    const existsMock = vi.fn().mockResolvedValue(true);

    const result = await maybeEnqueueSeoIterationDispatch(baseArgs, {
      enqueueDispatchImpl: enqueueMock as never,
      existingDispatchCheckImpl: existsMock,
    });

    expect(result.enqueued).toBe(false);
    expect(result.reason).toBe("already_queued");
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(existsMock).toHaveBeenCalledWith(
      baseArgs.pagePath,
      baseArgs.keyword,
    );
  });

  it("enqueueDispatch throws → caught + logged, never propagates", async () => {
    const enqueueMock = vi
      .fn()
      .mockRejectedValue(new Error("queue insert failed"));
    const existsMock = vi.fn().mockResolvedValue(false);

    const result = await maybeEnqueueSeoIterationDispatch(baseArgs, {
      enqueueDispatchImpl: enqueueMock as never,
      existingDispatchCheckImpl: existsMock,
    });

    expect(result.enqueued).toBe(false);
    expect(result.reason).toBe("enqueue_failed");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("non-/learn page → does NOT enqueue (out of scope)", async () => {
    const enqueueMock = vi.fn();
    const existsMock = vi.fn().mockResolvedValue(false);

    const result = await maybeEnqueueSeoIterationDispatch(
      { ...baseArgs, pagePath: "/marketing/home" },
      {
        enqueueDispatchImpl: enqueueMock as never,
        existingDispatchCheckImpl: existsMock,
      },
    );

    expect(result.enqueued).toBe(false);
    expect(result.reason).toBe("not_learn_page");
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("'improved' direction → does NOT enqueue even if magnitude ≥ threshold", async () => {
    const enqueueMock = vi.fn();
    const existsMock = vi.fn().mockResolvedValue(false);

    const result = await maybeEnqueueSeoIterationDispatch(
      {
        ...baseArgs,
        change: { delta: 20, direction: "improved" } as RankChange,
      },
      {
        enqueueDispatchImpl: enqueueMock as never,
        existingDispatchCheckImpl: existsMock,
      },
    );

    expect(result.enqueued).toBe(false);
    expect(result.reason).toBe("not_dropped");
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("idempotency check itself throws → fail-closed, no enqueue", async () => {
    const enqueueMock = vi.fn();
    const existsMock = vi
      .fn()
      .mockRejectedValue(new Error("db connection lost"));

    const result = await maybeEnqueueSeoIterationDispatch(baseArgs, {
      enqueueDispatchImpl: enqueueMock as never,
      existingDispatchCheckImpl: existsMock,
    });

    expect(result.enqueued).toBe(false);
    expect(result.reason).toBe("idempotency_check_failed");
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});
