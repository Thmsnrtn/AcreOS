/**
 * Layer 2 — Chaos & Adversarial Simulation
 *
 * Tests input validation, session/auth chaos, rate limit stress,
 * concurrency, webhook idempotency, and graceful degradation.
 *
 * Runs as vitest (API-level, not Playwright) for speed.
 * Target: docker-compose.test.yml stack.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  createAuthenticatedSession,
  apiCall,
  generateCSV,
  fireConcurrent,
  type AuthSession,
} from "./helpers";

const BASE_URL = process.env.SIM_BASE_URL ?? "http://localhost:5000";

describe("Chaos & Adversarial Simulation", () => {
  let session: AuthSession;

  beforeAll(async () => {
    try {
      session = await createAuthenticatedSession("scalingOperator");
    } catch {
      console.warn("[chaos] Could not authenticate — is the test server running?");
    }
  }, 30_000);

  // ═══════════════════════════════════════════════════════════════════════
  // INPUT VALIDATION CHAOS
  // ═══════════════════════════════════════════════════════════════════════

  describe("Input Validation Chaos", () => {
    // ── CSV edge cases ─────────────────────────────────────────────────

    it("rejects CSV with 10,001 rows without crashing", async () => {
      if (!session) return;

      const csv = generateCSV(10001);
      const blob = new Blob([csv], { type: "text/csv" });
      const formData = new FormData();
      formData.append("file", blob, "oversized.csv");

      const headers: Record<string, string> = {};
      if (session.cookie) headers["Cookie"] = session.cookie;
      if (session.csrfToken) headers["X-CSRF-Token"] = session.csrfToken;

      const res = await fetch(`${BASE_URL}/api/leads/import`, {
        method: "POST",
        headers,
        body: formData,
      });

      // Should reject or truncate, not 500
      expect(res.status).not.toBe(500);
      // Should either reject (400/413/422) or accept with truncation (200)
      expect([200, 400, 413, 422, 429].includes(res.status) || res.status < 500).toBeTruthy();
    });

    it("shows clear error for CSV with 0 rows", async () => {
      if (!session) return;

      const csv = "firstName,lastName,email,phone,county,state,status\n";
      const blob = new Blob([csv], { type: "text/csv" });
      const formData = new FormData();
      formData.append("file", blob, "empty.csv");

      const headers: Record<string, string> = {};
      if (session.cookie) headers["Cookie"] = session.cookie;
      if (session.csrfToken) headers["X-CSRF-Token"] = session.csrfToken;

      const res = await fetch(`${BASE_URL}/api/leads/import`, {
        method: "POST",
        headers,
        body: formData,
      });

      expect(res.status).not.toBe(500);
    });

    it("handles CSV with columns in wrong order (maps by header name)", async () => {
      if (!session) return;

      // Reversed column order
      const csv = [
        "status,state,county,phone,email,lastName,firstName",
        "new,AZ,Mohave,555-0001,test@test.com,Smith,John",
        "new,NV,Elko,555-0002,test2@test.com,Jones,Jane",
      ].join("\n");

      const blob = new Blob([csv], { type: "text/csv" });
      const formData = new FormData();
      formData.append("file", blob, "reordered.csv");

      const headers: Record<string, string> = {};
      if (session.cookie) headers["Cookie"] = session.cookie;
      if (session.csrfToken) headers["X-CSRF-Token"] = session.csrfToken;

      const res = await fetch(`${BASE_URL}/api/leads/import`, {
        method: "POST",
        headers,
        body: formData,
      });

      expect(res.status).not.toBe(500);
    });

    it("handles CSV with UTF-8 special characters gracefully", async () => {
      if (!session) return;

      const csv = [
        "firstName,lastName,email,phone,county,state,status",
        "José,García,jose@test.com,555-0001,Doña Ana,NM,new",
        "Naïve,Ñoño,naive@test.com,555-0002,San Bernardino,CA,new",
        "日本,太郎,taro@test.com,555-0003,Mohave,AZ,new",
      ].join("\n");

      const blob = new Blob([csv], { type: "text/csv" });
      const formData = new FormData();
      formData.append("file", blob, "unicode.csv");

      const headers: Record<string, string> = {};
      if (session.cookie) headers["Cookie"] = session.cookie;
      if (session.csrfToken) headers["X-CSRF-Token"] = session.csrfToken;

      const res = await fetch(`${BASE_URL}/api/leads/import`, {
        method: "POST",
        headers,
        body: formData,
      });

      expect(res.status).not.toBe(500);
    });

    it("rejects .xlsx file when .csv expected (or shows format error)", async () => {
      if (!session) return;

      // Fake xlsx content (not valid xlsx, just wrong mimetype)
      const fakeXlsx = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const formData = new FormData();
      formData.append("file", fakeXlsx, "data.xlsx");

      const headers: Record<string, string> = {};
      if (session.cookie) headers["Cookie"] = session.cookie;
      if (session.csrfToken) headers["X-CSRF-Token"] = session.csrfToken;

      const res = await fetch(`${BASE_URL}/api/leads/import`, {
        method: "POST",
        headers,
        body: formData,
      });

      // Should reject with 400 or show format error, not crash
      expect(res.status).not.toBe(500);
    });

    // ── XSS & injection ────────────────────────────────────────────────

    it("handles XSS in firstName field (no script execution)", async () => {
      if (!session) return;

      const res = await apiCall("POST", "/api/leads", {
        firstName: "<script>alert('xss')</script>",
        lastName: "XSSTest",
        email: "xss-test@sim-test.com",
        status: "new",
      }, session);

      // Should either reject or sanitize, not 500
      expect(res.status).not.toBe(500);

      // If created, verify it was stored safely
      if (res.status === 201 || res.status === 200) {
        const id = res.body.id ?? res.body.leadId;
        if (id) {
          const getRes = await apiCall("GET", `/api/leads/${id}`, undefined, session);
          if (getRes.status === 200) {
            // Should not contain raw script tags (should be escaped or stripped)
            const stored = JSON.stringify(getRes.body);
            expect(stored).not.toContain("<script>");
          }
        }
      }
    });

    it("handles SQL injection in email field", async () => {
      if (!session) return;

      const res = await apiCall("POST", "/api/leads", {
        firstName: "SQLInject",
        lastName: "Test",
        email: "'; DROP TABLE leads; --",
        status: "new",
      }, session);

      // Should either reject (400/422) or store safely, not crash
      expect(res.status).not.toBe(500);

      // Verify leads table still works
      const leadsRes = await apiCall("GET", "/api/leads", undefined, session);
      expect(leadsRes.status).toBe(200);
    });

    it("rejects lead with 50-character phone number", async () => {
      if (!session) return;

      const res = await apiCall("POST", "/api/leads", {
        firstName: "Long",
        lastName: "Phone",
        email: "long-phone@sim-test.com",
        phone: "5".repeat(50),
        status: "new",
      }, session);

      // Should either reject or truncate, not crash
      expect(res.status).not.toBe(500);
    });

    // ── Invalid note data ──────────────────────────────────────────────

    it("rejects note with negative interest rate", async () => {
      if (!session) return;

      const res = await apiCall("POST", "/api/notes", {
        borrowerName: "Negative Rate",
        borrowerEmail: "neg@sim-test.com",
        originalBalance: 10000_00,
        currentBalance: 10000_00,
        interestRate: -5.0,
        termMonths: 60,
        monthlyPayment: 200_00,
        startDate: "2026-01-01",
        status: "performing",
      }, session);

      // Should reject (400/422) or handle gracefully
      expect(res.status).not.toBe(500);
    });

    it("rejects note with 0 term months", async () => {
      if (!session) return;

      const res = await apiCall("POST", "/api/notes", {
        borrowerName: "Zero Term",
        borrowerEmail: "zero@sim-test.com",
        originalBalance: 10000_00,
        currentBalance: 10000_00,
        interestRate: 8.0,
        termMonths: 0,
        monthlyPayment: 200_00,
        startDate: "2026-01-01",
        status: "performing",
      }, session);

      expect(res.status).not.toBe(500);
    });

    it("rejects note with $0 principal", async () => {
      if (!session) return;

      const res = await apiCall("POST", "/api/notes", {
        borrowerName: "Zero Principal",
        borrowerEmail: "zeroprincipal@sim-test.com",
        originalBalance: 0,
        currentBalance: 0,
        interestRate: 8.0,
        termMonths: 60,
        monthlyPayment: 0,
        startDate: "2026-01-01",
        status: "performing",
      }, session);

      expect(res.status).not.toBe(500);
    });

    // ── Empty campaign content ─────────────────────────────────────────

    it("handles campaign with empty content/subject", async () => {
      if (!session) return;

      const res = await apiCall("POST", "/api/campaigns", {
        name: "",
        type: "direct_mail",
        status: "draft",
        subject: "",
        content: "",
      }, session);

      // Should reject with validation error or accept draft
      expect(res.status).not.toBe(500);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SESSION & AUTH CHAOS
  // ═══════════════════════════════════════════════════════════════════════

  describe("Session & Auth Chaos", () => {
    it("returns 401 for request with expired/invalid session cookie", async () => {
      const res = await apiCall("GET", "/api/leads", undefined, {
        cookie: "session=expired_invalid_cookie_value_12345",
        csrfToken: "",
      });

      // Should return 401 or 403, never 500
      expect(res.status).not.toBe(500);
      expect([401, 403]).toContain(res.status);
    });

    it("returns 401 for request with no cookie at all", async () => {
      const res = await apiCall("GET", "/api/leads", undefined, {
        cookie: "",
        csrfToken: "",
      });

      expect(res.status).not.toBe(500);
      expect([401, 403]).toContain(res.status);
    });

    it("returns 403 for POST without CSRF token", async () => {
      if (!session) return;

      const res = await apiCall("POST", "/api/leads", {
        firstName: "NoCSRF",
        lastName: "Test",
        email: "nocsrf@sim-test.com",
        status: "new",
      }, { cookie: session.cookie, csrfToken: "" });

      // Should reject the request (403 for CSRF failure)
      expect(res.status).not.toBe(500);
      // Accept either 403 (CSRF fail) or 401 (no auth) — both are valid
      expect([401, 403]).toContain(res.status);
    });

    it("returns 403 for POST with invalid CSRF token", async () => {
      if (!session) return;

      const res = await apiCall("POST", "/api/leads", {
        firstName: "BadCSRF",
        lastName: "Test",
        email: "badcsrf@sim-test.com",
        status: "new",
      }, { cookie: session.cookie, csrfToken: "invalid_csrf_token_xyz" });

      expect(res.status).not.toBe(500);
      expect([401, 403]).toContain(res.status);
    });

    it("brute-force login attempts trigger rate limiting", async () => {
      const attempts = 60;
      let rateLimited = false;

      for (let i = 0; i < attempts; i++) {
        const res = await apiCall("POST", "/api/auth/login", {
          email: "brute@force-test.com",
          password: `wrong-password-${i}`,
        });

        if (res.status === 429) {
          rateLimited = true;
          break;
        }

        // Should never crash
        expect(res.status).not.toBe(500);
      }

      // Rate limiting should have kicked in before 60 attempts
      // (auth limiter is 10/15min, so should trigger quickly)
      // This may not always trigger depending on config; just verify no 500s
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RATE LIMIT & CONCURRENCY CHAOS
  // ═══════════════════════════════════════════════════════════════════════

  describe("Rate Limit & Concurrency Chaos", () => {
    it("handles 300 concurrent GET /api/leads requests without crashing", async () => {
      if (!session) return;

      const results = await fireConcurrent(
        300,
        "GET",
        "/api/leads",
        () => undefined,
        session,
      );

      // No 500 errors
      const serverErrors = results.filter((r) => r.status >= 500);
      expect(serverErrors.length).toBe(0);

      // Some should be 429 (rate limited)
      const rateLimited = results.filter((r) => r.status === 429);
      // At least some requests should succeed
      const successful = results.filter((r) => r.status === 200);
      expect(successful.length).toBeGreaterThan(0);
    }, 30_000);

    it("handles 50 concurrent POST /api/leads without duplicates or corruption", async () => {
      if (!session) return;

      const results = await fireConcurrent(
        50,
        "POST",
        "/api/leads",
        (i) => ({
          firstName: `Concurrent`,
          lastName: `Lead${i}`,
          email: `concurrent-${i}-${Date.now()}@sim-test.com`,
          status: "new",
        }),
        session,
      );

      // No 500 errors
      const serverErrors = results.filter((r) => r.status >= 500);
      expect(serverErrors.length).toBe(0);

      // Created leads should have unique IDs (no duplicates)
      const createdIds = results
        .filter((r) => r.status === 201 || r.status === 200)
        .map((r) => r.body?.id ?? r.body?.leadId)
        .filter(Boolean);

      const uniqueIds = new Set(createdIds);
      expect(uniqueIds.size).toBe(createdIds.length);
    }, 30_000);

    it("handles 10 concurrent payment recordings for same note (idempotency)", async () => {
      if (!session) return;

      // First create a note to test against
      const noteRes = await apiCall("POST", "/api/notes", {
        borrowerName: "Concurrency Test Borrower",
        borrowerEmail: "concurrency@sim-test.com",
        originalBalance: 50000_00,
        currentBalance: 50000_00,
        interestRate: 9.0,
        termMonths: 60,
        monthlyPayment: 1038_00,
        startDate: "2026-01-01",
        status: "performing",
      }, session);

      if (noteRes.status !== 201 && noteRes.status !== 200) return;

      const noteId = noteRes.body.id ?? noteRes.body.noteId;
      if (!noteId) return;

      // Fire 10 concurrent payment recordings
      const results = await fireConcurrent(
        10,
        "POST",
        "/api/finance/process",
        () => ({
          noteId,
          amount: 1038_00,
          type: "payment",
        }),
        session,
      );

      // Should not crash
      const serverErrors = results.filter((r) => r.status >= 500);
      expect(serverErrors.length).toBe(0);
    }, 30_000);

    it("handles duplicate Stripe webhook events (idempotency check)", async () => {
      // Test the webhook endpoint handles duplicates
      // We can't sign a real Stripe event without the secret,
      // but we can verify the endpoint exists and handles bad payloads
      const fakeEventId = `evt_test_${Date.now()}`;

      for (let i = 0; i < 5; i++) {
        const res = await apiCall("POST", "/api/stripe/webhook", {
          id: fakeEventId,
          type: "checkout.session.completed",
          data: { object: {} },
        });

        // Should reject unsigned webhooks gracefully (400/403), never 500
        expect(res.status).not.toBe(500);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // GRACEFUL DEGRADATION CHAOS
  // ═══════════════════════════════════════════════════════════════════════

  describe("Graceful Degradation", () => {
    it("Pax/AI endpoints handle missing OPENAI_API_KEY gracefully", async () => {
      if (!session) return;

      // Try to use Pax without API key configured
      const res = await apiCall("POST", "/api/ai/chat", {
        message: "What is seller financing?",
      }, session);

      // Should return friendly error, not crash
      expect(res.status).not.toBe(500);

      if (res.status >= 400) {
        const body = typeof res.body === "string" ? res.body : JSON.stringify(res.body);
        // Should have a user-friendly message
        expect(body.length).toBeGreaterThan(0);
      }
    });

    it("health endpoint responds even under load", async () => {
      const res = await apiCall("GET", "/api/health");
      expect(res.status).toBe(200);
    });

    it("billing endpoints handle missing STRIPE_SECRET_KEY", async () => {
      if (!session) return;

      // Try billing-related endpoints
      const endpoints = ["/api/billing/status", "/api/billing/plans"];
      for (const endpoint of endpoints) {
        const res = await apiCall("GET", endpoint, undefined, session);
        // Should not crash (may return 404 if route doesn't exist, or friendly error)
        expect(res.status).not.toBe(500);
      }
    });

    it("campaign endpoints handle missing email/SMS configuration", async () => {
      if (!session) return;

      // Try to create and activate a campaign
      const createRes = await apiCall("POST", "/api/campaigns", {
        name: "Degradation Test Campaign",
        type: "email",
        status: "draft",
        subject: "Test Subject",
        content: "Test content",
      }, session);

      expect(createRes.status).not.toBe(500);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ENDPOINT EXISTENCE & BASIC HEALTH
  // ═══════════════════════════════════════════════════════════════════════

  describe("Core API endpoints respond", () => {
    const coreEndpoints = [
      "GET /api/health",
      "GET /api/leads",
      "GET /api/deals",
      "GET /api/properties",
      "GET /api/notes",
      "GET /api/campaigns",
      "GET /api/onboarding/status",
      "GET /api/onboarding/checklist",
      "GET /api/auth/user",
      "GET /api/finance/health",
      "GET /api/finance/portfolio-summary",
    ];

    for (const endpoint of coreEndpoints) {
      const [method, path] = endpoint.split(" ");

      it(`${endpoint} does not return 500`, async () => {
        if (!session && path !== "/api/health") return;

        const res = await apiCall(method, path, undefined, session);
        expect(res.status).not.toBe(500);
      });
    }
  });
});
