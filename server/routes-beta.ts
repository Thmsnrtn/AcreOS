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
import { isAuthenticated } from "./auth";
import { betaProgramService } from "./services/betaProgram";
import { z } from "zod";

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
    if (err.errors) return res.status(400).json({ message: "Validation failed", errors: err.errors });
    res.status(500).json({ message: err.message });
  }
});

// ─── Public: Check Waitlist Status ───────────────────────────────────────────

router.get("/waitlist/status", async (req, res) => {
  try {
    const email = req.query.email as string;
    if (!email) return res.status(400).json({ message: "email is required" });

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
  } catch (err: any) {
    res.status(500).json({ message: err.message });
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
    const user = (req as any).user;
    const data = feedbackSchema.parse(req.body);
    const result = await betaProgramService.submitFeedback({ ...data, email: user.email });
    res.json(result);
  } catch (err: any) {
    if (err.errors) return res.status(400).json({ message: "Validation failed", errors: err.errors });
    res.status(500).json({ message: err.message });
  }
});

// ─── Admin: Full Waitlist ─────────────────────────────────────────────────────

function isFounder(req: any, res: any, next: any) {
  const user = req.user;
  const founderEmails = (process.env.FOUNDER_EMAILS || "").split(",").map((e: string) => e.trim().toLowerCase());
  if (!user || !founderEmails.includes(user.email?.toLowerCase())) {
    return res.status(403).json({ message: "Founder access required" });
  }
  next();
}

router.get("/admin/waitlist", isAuthenticated, isFounder, async (req, res) => {
  try {
    const page = parseInt((req.query.page as string) || "1", 10);
    const limit = parseInt((req.query.limit as string) || "50", 10);
    const status = req.query.status as string | undefined;
    const result = await betaProgramService.getWaitlist({ page, limit, status });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/admin/cohorts", isAuthenticated, isFounder, async (_req, res) => {
  res.json(betaProgramService.getCohorts());
});

router.post("/admin/invite", isAuthenticated, isFounder, async (req, res) => {
  try {
    const { email, cohortId } = req.body;
    if (!email) return res.status(400).json({ message: "email is required" });
    const result = await betaProgramService.inviteUser(email, cohortId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/admin/activate", isAuthenticated, isFounder, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "email is required" });
    const result = await betaProgramService.activateUser(email);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/admin/feedback", isAuthenticated, isFounder, async (req, res) => {
  const type = req.query.type as string | undefined;
  res.json(betaProgramService.getFeedback({ type }));
});

router.get("/admin/stats", isAuthenticated, isFounder, async (_req, res) => {
  res.json(betaProgramService.getStats());
});

export default router;
