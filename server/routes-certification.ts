/**
 * T146 — Certification Service Routes
 *
 * POST /api/certification/check/:userId/:courseId — check and award certificate
 * GET  /api/certification/certificate/:userId/:courseId — get certificate
 * GET  /api/certification/achievements/:userId    — get user achievements
 * GET  /api/certification/stats/:userId           — learning stats
 * GET  /api/certification/my                      — current user certificates/achievements
 */

import { Router, type Request, type Response } from "express";
import { isAuthenticated } from "./auth";
import { certificationService } from "./services/certification";

const router = Router();

function getUser(req: Request) {
  return (req as any).user;
}

// Check and award certificate for course completion
router.post("/check/:userId/:courseId", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId);
    const courseId = parseInt(req.params.courseId);
    if (isNaN(userId) || isNaN(courseId)) {
      return res.status(400).json({ error: "Invalid userId or courseId" });
    }
    const result = await certificationService.checkAndAward(userId, courseId);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Get certificate for a user/course
router.get("/certificate/:userId/:courseId", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId);
    const courseId = parseInt(req.params.courseId);
    if (isNaN(userId) || isNaN(courseId)) {
      return res.status(400).json({ error: "Invalid userId or courseId" });
    }
    const certificate = await certificationService.issueCertificate(userId, courseId);
    res.json({ certificate });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Get achievements for a user
router.get("/achievements/:userId", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) return res.status(400).json({ error: "Invalid user ID" });
    const achievements = await certificationService.checkAchievements(userId);
    res.json({ achievements });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Learning stats for a user
router.get("/stats/:userId", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) return res.status(400).json({ error: "Invalid user ID" });
    const stats = await certificationService.getLearningStats(userId);
    res.json({ stats });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Current user's certificates, achievements, and stats
router.get("/my", isAuthenticated, async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const [achievements, stats] = await Promise.all([
      certificationService.checkAchievements(user.id),
      certificationService.getLearningStats(user.id),
    ]);
    res.json({ achievements, stats });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
