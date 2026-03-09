/**
 * T175 — GDPR/Privacy Routes
 *
 * POST /api/privacy/export   — export all personal data for current user
 * POST /api/privacy/delete   — request anonymization of personal data
 * GET  /api/privacy/status   — check if user has active deletion
 */

import { Router, type Request, type Response } from "express";
import { isAuthenticated } from "./auth";
import { exportUserData, anonymizeUser, isUserDeleted } from "./services/gdprService";

const router = Router();

function getUser(req: Request) {
  return (req as any).user;
}

// Export personal data (GDPR Article 15)
router.post("/export", async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const data = await exportUserData(user.id);

    // Return as JSON file download
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="acreOS-data-export-${new Date().toISOString().split("T")[0]}.json"`
    );
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Request account anonymization (GDPR Article 17)
router.post("/delete", async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const { confirm } = req.body;

    if (confirm !== "DELETE MY DATA") {
      return res.status(400).json({
        error: "Confirmation required. Send { confirm: 'DELETE MY DATA' } to proceed.",
      });
    }

    // Check if already deleted
    if (await isUserDeleted(user.id)) {
      return res.status(409).json({ error: "Data deletion already completed for this account." });
    }

    const report = await anonymizeUser(user.id);
    res.json({
      message: "Your personal data has been anonymized. Business records required for legal compliance are retained in anonymized form.",
      report,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Check deletion status
router.get("/status", async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const deleted = await isUserDeleted(user.id);
    res.json({ deleted, userId: user.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
