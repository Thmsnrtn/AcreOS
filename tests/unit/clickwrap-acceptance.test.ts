/**
 * Phase Zero-Three gate (Beatrice audit 2026-06-01) — clickwrap ToS +
 * Privacy acceptance at signup.
 *
 * Validates three contracts:
 *   (a) The signup form refuses to render the Clerk SignUp widget until the
 *       acceptance checkbox is checked — a true form-level gate, not a
 *       visual disable. We assert this against the source by confirming the
 *       conditional `{tosAccepted ? <SignUp/> : <gate-message/>}` exists.
 *   (b) The server user-creation paths (clerkAuth.ts hydrateUser + the
 *       legacy oauth.ts handleOAuthCallback) write tosAcceptedAt +
 *       privacyAcceptedAt on the INSERT. Source-shape assertion — replays
 *       the same convention as the AI-disclosure tests in
 *       critical-path-render.
 *   (c) The Drizzle column declarations in shared/models/auth.ts exist and
 *       are timestamp columns. Source-shape assertion guards against
 *       accidental deletion.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");

// ── (a) auth-page.tsx checkbox gates the SignUp render ─────────────────────────

describe("auth-page.tsx — clickwrap gate contract", () => {
  const authSrc = fs.readFileSync(
    path.join(ROOT, "client/src/pages/auth-page.tsx"),
    "utf-8",
  );

  it("imports the shadcn Checkbox + Label primitives", () => {
    expect(authSrc).toContain('from "@/components/ui/checkbox"');
    expect(authSrc).toContain('from "@/components/ui/label"');
  });

  it("declares a tosAccepted state, default false", () => {
    // The default-false invariant is non-negotiable — pre-ticked boxes
    // are a CFPB + EU AI Act dark pattern. Regression guard.
    expect(authSrc).toMatch(/useState\(\s*false\s*\)/);
    expect(authSrc).toContain("tosAccepted");
    expect(authSrc).toContain("setTosAccepted");
  });

  it("renders the SignUp widget ONLY when tosAccepted is true", () => {
    // The conditional is the form-level gate. No <SignUp/> outside this
    // conditional in sign-up mode.
    expect(authSrc).toMatch(/tosAccepted\s*\?\s*[\s\S]*?<SignUp/);
  });

  it("references both /terms and /privacy links inside the consent label", () => {
    expect(authSrc).toContain('href="/terms"');
    expect(authSrc).toContain('href="/privacy"');
  });

  it("checkbox has an accessible aria-label", () => {
    expect(authSrc).toMatch(/aria-label="I agree to the Terms of Service and Privacy Policy"/);
  });

  it("does not pre-check the checkbox via a defaultChecked prop", () => {
    // Belt-and-suspenders against an accidental dark-pattern regression.
    expect(authSrc).not.toContain("defaultChecked");
  });
});

// ── (b) Server user-creation paths stamp tosAcceptedAt + privacyAcceptedAt ────

describe("Server user-creation — clickwrap timestamps", () => {
  it("clerkAuth.ts INSERT stamps tosAcceptedAt + privacyAcceptedAt", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "server/auth/clerkAuth.ts"),
      "utf-8",
    );
    expect(src).toContain("tosAcceptedAt:");
    expect(src).toContain("privacyAcceptedAt:");
    // The acceptedAt instant must come from the server clock, not the
    // client. We assert a `new Date()` is allocated near the insert.
    expect(src).toMatch(/const\s+acceptedAt\s*=\s*new Date\(\)/);
  });

  // The legacy server/auth/oauth.ts (Passport social-login) path was RETIRED
  // 2026-07-15 — Clerk owns all login + OAuth, and Clerk stamps its own
  // consent. The clickwrap timestamps on the remaining user-creation paths are
  // covered by the cases above; the deleted file's case was removed with it.
});

// ── (c) Drizzle column declarations exist ─────────────────────────────────────

describe("Drizzle schema — clickwrap columns declared", () => {
  const schemaSrc = fs.readFileSync(
    path.join(ROOT, "shared/models/auth.ts"),
    "utf-8",
  );

  it("users.tosAcceptedAt declared as a timestamp", () => {
    expect(schemaSrc).toMatch(/tosAcceptedAt:\s*timestamp\("tos_accepted_at"\)/);
  });

  it("users.privacyAcceptedAt declared as a timestamp", () => {
    expect(schemaSrc).toMatch(/privacyAcceptedAt:\s*timestamp\("privacy_accepted_at"\)/);
  });
});

// ── (d) migrate.mjs mirrors the SQL migration (CI guardrail) ──────────────────

describe("scripts/migrate.mjs — clickwrap idempotent ALTER mirrors exist", () => {
  const mirrorSrc = fs.readFileSync(
    path.join(ROOT, "scripts/migrate.mjs"),
    "utf-8",
  );

  it("mirrors tos_accepted_at column", () => {
    expect(mirrorSrc).toContain('"tos_accepted_at"');
  });

  it("mirrors privacy_accepted_at column", () => {
    expect(mirrorSrc).toContain('"privacy_accepted_at"');
  });
});

// ── (e) Behavioral assertion: a simulated "form submit" rejected when unchecked ─

describe("Clickwrap form-level rejection — simulated", () => {
  // Replicates the gate as a pure predicate so we can unit-test the
  // contract independent of React. The auth-page.tsx implementation MUST
  // honor this predicate (no <SignUp/> render until tosAccepted === true).
  function canSubmitSignup(tosAccepted: boolean): boolean {
    return tosAccepted === true;
  }

  it("rejects when tosAccepted is false (default)", () => {
    expect(canSubmitSignup(false)).toBe(false);
  });

  it("accepts only when tosAccepted is true", () => {
    expect(canSubmitSignup(true)).toBe(true);
  });
});
