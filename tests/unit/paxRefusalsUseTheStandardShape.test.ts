/**
 * Pax chat refusals: a clear 503 when no AI provider is configured, and the
 * standard `{ error, message, details?, statusCode }` shape for 402.
 *
 * Measured before the change (2026-10-07):
 *   - No provider configured → 500. selectProviderAndModel throws the typed
 *     NoAIProviderError, which Errors.internal maps to 503 — but executive.ts
 *     caught it and re-threw `new Error("AI service not available…")`, so the
 *     shape detection never saw it. The usage counter was bumped and the
 *     user's message stored before it failed. On /stream the failure came
 *     after the SSE headers: a 200 with an error event.
 *   - 402 was `{ error: "Insufficient credits", required, balance }` — no
 *     message, no statusCode. The provider-out-of-credits case was also a 402,
 *     which the client renders as "Insufficient credits." to a customer whose
 *     balance is fine; it is now a 503 (AcreOS's provider, not the customer).
 *
 * Population: both Pax chat routes — POST /api/ai/chat and /api/ai/chat/stream.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const h = vi.hoisted(() => ({
  hasCredits: true,
  processChat: vi.fn(),
  processChatStream: vi.fn(),
  trackUsage: vi.fn(async () => undefined),
}));

const pass = (_q: unknown, _s: unknown, n: () => void) => n();
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: { user?: unknown }, _s: unknown, n: () => void) => {
    req.user = { id: "u1" };
    n();
  },
  requireFounder: pass,
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: { organization?: unknown }, _s: unknown, n: () => void) => {
    req.organization = { id: 7, subscriptionTier: "pro" };
    n();
  },
}));
vi.mock("../../server/middleware/rateLimit", () => ({ aiLimiter: pass }));
vi.mock("../../server/middleware/expensiveEndpointGuard", () => ({ paxChatGuard: pass }));
vi.mock("../../server/middleware/requirePaxDisclosure", () => ({ requirePaxDisclosure: pass }));
vi.mock("../../server/middleware/usageLimitGate", () => ({ usageLimitGate: () => pass, aiByokThresholdGate: () => pass }));
vi.mock("../../server/services/usageLimits", () => ({
  checkUsageLimit: async () => ({ allowed: true, current: 0, limit: null, resourceType: "ai_requests", tier: "pro" }),
}));
vi.mock("../../server/services/credits", () => ({
  usageMeteringService: { calculateCost: async () => 2, recordUsage: async () => undefined },
  creditService: {
    hasEnoughCredits: async () => h.hasCredits,
    // The chat routes read the decision WITH its lane (#335).
    evaluateCredits: async () => ({ allowed: h.hasCredits, lane: "balance" }),
    getBalance: async () => 0,
  },
}));
vi.mock("../../server/storage", () => ({ storage: { trackUsage: h.trackUsage }, db: {} }));
vi.mock("../../server/services/solene/preCallConstitutionalChecker", () => ({
  checkPromptAgainstConstitution: async () => ({ allowed: true }),
}));
vi.mock("../../server/ai/executive", async (orig) => ({
  ...(await orig<typeof import("../../server/ai/executive")>()),
  processChat: h.processChat,
  processChatStream: h.processChatStream,
}));

const KEYS = ["AI_INTEGRATIONS_OPENROUTER_API_KEY", "AI_INTEGRATIONS_OPENAI_API_KEY"] as const;

async function app() {
  const a = express();
  a.use(express.json());
  const { registerAIRoutes } = await import("../../server/routes-ai");
  registerAIRoutes(a);
  return a;
}

beforeEach(() => {
  h.hasCredits = true;
  h.processChat.mockReset();
  h.processChatStream.mockReset();
  h.trackUsage.mockClear();
});

const ROUTES = ["/api/ai/chat", "/api/ai/chat/stream"];

describe("no AI provider configured", () => {
  for (const route of ROUTES) {
    it(`${route} → 503 SERVICE_UNAVAILABLE in the standard shape, before any side effect`, async () => {
      for (const k of KEYS) delete process.env[k];
      const res = await request(await app()).post(route).send({ message: "hello" });
      expect(res.status).toBe(503);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(res.body).toMatchObject({ error: "SERVICE_UNAVAILABLE", statusCode: 503 });
      expect(res.body.message).toMatch(/no AI provider is configured/);
      expect(h.processChat).not.toHaveBeenCalled();
      expect(h.processChatStream).not.toHaveBeenCalled();
      expect(h.trackUsage).not.toHaveBeenCalled();
    });
  }

  it("the pre-flight agrees with the router: isAiProviderConfigured() is false exactly when selection throws NoAIProviderError", async () => {
    for (const k of KEYS) delete process.env[k];
    const { isAiProviderConfigured, selectProviderAndModel, TaskComplexity, NoAIProviderError } = await import("../../server/services/aiRouter");
    expect(isAiProviderConfigured()).toBe(false);
    expect(() => selectProviderAndModel(TaskComplexity.COMPLEX)).toThrow(NoAIProviderError);
  });
});

describe("with a provider configured", () => {
  beforeEach(() => {
    process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY = "test-key";
  });

  for (const route of ROUTES) {
    it(`${route}: insufficient credits → 402 PAYMENT_REQUIRED with message, details and statusCode`, async () => {
      h.hasCredits = false;
      const res = await request(await app()).post(route).send({ message: "hello" });
      // Merged with #335: the chat routes answer through refusePaxCredits —
      // the same standard shape, with the remedy named in details.nextStep.
      expect(res.status).toBe(402);
      expect(res.body).toMatchObject({
        error: "PAX_CREDITS_REQUIRED",
        statusCode: 402,
        details: { reason: "pax_credits_required", requiredCents: 2, balanceCents: 0, nextStep: expect.any(Object) },
      });
      expect(res.body.message).toMatch(/Add credits|credit/);
      expect(h.processChat).not.toHaveBeenCalled();
    });
  }

  it("the provider out of credits is OUR dependency: 503, not a customer 402", async () => {
    const { ProviderCreditError } = await import("../../server/ai/executive");
    h.processChat.mockRejectedValue(new ProviderCreditError(100, "402 from provider"));
    const res = await request(await app()).post("/api/ai/chat").send({ message: "hello" });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: "SERVICE_UNAVAILABLE", statusCode: 503 });
  });

  it("no route in routes-ai.ts writes a hand-rolled 402", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { stripComments } = await import("../helpers/stripComments");
    const src = stripComments(readFileSync(resolve(__dirname, "../../server/routes-ai.ts"), "utf8"));
    expect(src).not.toMatch(/status\(402\)/);
  });
});
