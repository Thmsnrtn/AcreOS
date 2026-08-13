/**
 * T95 — Beta Program Routes
 *
 * Public endpoints:
 *   POST /api/beta/waitlist          — join waitlist (no auth required)
 *   GET  /api/beta/waitlist/status   — check your waitlist status
 *   POST /api/beta/feedback          — submit feedback (authenticated)
 *
 * Admin endpoints (founder-only):
 *   GET  /api/beta/admin/waitlist    — full waitlist
 *   GET  /api/beta/admin/cohorts     — cohort stats
 *   POST /api/beta/admin/invite      — invite user to beta
 *   POST /api/beta/admin/activate    — activate user
 *   GET  /api/beta/admin/feedback    — all feedback
 *   GET  /api/beta/admin/stats       — summary stats
 */

import { Router } from "express";
import { isAuthenticated, requireFounder } from "./auth";
import { betaProgramService } from "./services/betaProgram";
import { z } from "zod";
import { Errors } from "./utils/errors";

const router = Router();

// ─── Public: Join Waitlist ────────────────────────────────────────────────────

const joinSchema = z.object({
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  company: z.string().optional(),
  useCase: z.string().max(500).optional(),
  referralCode: z.string().optional(),
});

router.post("/waitlist", async (req, res) => {
  try {
    const data = joinSchema.parse(req.body);

    // Validate referral code if provided
    let referredBy: string | undefined;
    if (data.referralCode) {
      const result = betaProgramService.validateReferralCode(data.referralCode);
      if (result.valid) {
        referredBy = result.referrer;
      }
    }

    const result = await betaProgramService.joinWaitlist({ ...data, referredBy });
    res.json(result);
  } catch (err: any) {
    if (err.issues) return Errors.validationFailed(res, err.issues);
    Errors.internal(res, err);
  }
});

// ─── Public: Check Waitlist Status ───────────────────────────────────────────

router.get("/waitlist/status", async (req, res) => {
  try {
    const email = req.query.email as string;
    if (!email) return Errors.badRequest(res, "email is required");

    const { entries } = await betaProgramService.getWaitlist();
    const entry = entries.find(e => e.email.toLowerCase() === email.toLowerCase());
    if (!entry) return res.json({ found: false });

    res.json({
      found: true,
      position: entry.position,
      status: entry.status,
      cohort: entry.cohort,
      referralCode: `ACRE-${entry.id.toString().padStart(5, "0")}`,
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// ─── Authenticated: Submit Feedback ──────────────────────────────────────────

const feedbackSchema = z.object({
  type: z.enum(["bug", "feature_request", "general", "nps"]),
  rating: z.number().min(1).max(10).optional(),
  message: z.string().min(1).max(2000),
  feature: z.string().optional(),
});

router.post("/feedback", isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    const data = feedbackSchema.parse(req.body);
    const result = await betaProgramService.submitFeedback({ ...data, email: user.email ?? "" });
    res.json(result);
  } catch (err: any) {
    if (err.issues) return Errors.validationFailed(res, err.issues);
    Errors.internal(res, err);
  }
});

// ─── Admin: Full Waitlist ─────────────────────────────────────────────────────
//
// These six endpoints used a LOCAL founder shim that diverged from the
// canonical `requireFounder` in two ways, both of them wrong:
//
//   1. It answered **403 "Founder access required"**. Everywhere else in this
//      repo the rule is stated and followed — `routes-admin.ts` repeats it five
//      times: *"Hide existence of founder-only surfaces from non-founders (404,
//      not 403)"*. A 403 confirms the endpoint exists and that it is a founder
//      surface, which is the one thing the 404 convention exists to withhold.
//   2. It read `process.env.FOUNDER_EMAILS` only. Founder identity is
//      `FOUNDER_EMAIL` (singular) **or** `FOUNDER_EMAILS` **or**
//      `FOUNDER_USER_IDS` (Clerk id) — see `services/founder.ts`. A founder
//      configured by user id, or by the singular variable, was refused by their
//      own admin console. Fail-closed, but still broken.
//
// This was the only place in `server/` computing founder identity for an
// AUTHORIZATION decision outside the canonical helper. (The jobs that read
// FOUNDER_EMAIL build recipient lists — who to email, not who may act.)

router.get("/admin/waitlist", isAuthenticated, requireFounder, async (req, res) => {
  try {
    const page = parseInt((req.query.page as string) || "1", 10);
    const limit = Math.min(100, parseInt((req.query.limit as string) || "50", 10));
    const status = req.query.status as string | undefined;
    const result = await betaProgramService.getWaitlist({ page, limit, status });
    res.json(result);
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.get("/admin/cohorts", isAuthenticated, requireFounder, async (_req, res) => {
  res.json(betaProgramService.getCohorts());
});

router.post("/admin/invite", isAuthenticated, requireFounder, async (req, res) => {
  try {
    const { email, cohortId } = req.body;
    if (!email) return Errors.badRequest(res, "email is required");
    const result = await betaProgramService.inviteUser(email, cohortId);
    res.json(result);
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.post("/admin/activate", isAuthenticated, requireFounder, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return Errors.badRequest(res, "email is required");
    const result = await betaProgramService.activateUser(email);
    res.json(result);
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.get("/admin/feedback", isAuthenticated, requireFounder, async (req, res) => {
  const type = req.query.type as string | undefined;
  res.json(betaProgramService.getFeedback({ type }));
});

router.get("/admin/stats", isAuthenticated, requireFounder, async (_req, res) => {
  res.json(betaProgramService.getStats());
});

export default router;
