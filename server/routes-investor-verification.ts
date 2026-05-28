import { Router, type Response } from 'express';
import { investorVerificationService } from './services/investorVerification';
import { Errors } from './utils/errors';
import type { AuthenticatedRequest } from './types/request';
import { isAdminOrAbove } from './utils/permissions';

const router = Router();


function isAdmin(req: AuthenticatedRequest): boolean {
  const role = req.permissionContext?.role;
  return (!!role && isAdminOrAbove(role)) || req.isFounder === true;
}

// =====================
// INVESTOR VERIFICATIONS
// =====================

// GET /verifications/:investorId — get verification status
router.get('/verifications/:investorId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const investorProfileId = parseInt(req.params.investorId, 10);
    if (Number.isNaN(investorProfileId)) return Errors.badRequest(res, 'Invalid investor id');
    const verification = await investorVerificationService.getVerificationStatus(
      investorProfileId
    );
    if (!verification) {
      return Errors.notFound(res, 'Verification');
    }
    res.json({ verification });
  } catch (error) {
    Errors.internal(res, error);
  }
});

// POST /verifications — create verification request
router.post('/verifications', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const org = req.organization;
    const investorProfileId = parseInt(String(req.body.investorProfileId), 10);
    if (Number.isNaN(investorProfileId)) return Errors.badRequest(res, 'investorProfileId required');
    const verification = await investorVerificationService.createVerificationRequest(
      investorProfileId,
      org.id,
    );
    res.status(201).json({ verification, success: true });
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
  }
});

// POST /verifications/:id/documents — upload verification document
router.post('/verifications/:id/documents', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const verificationId = parseInt(req.params.id, 10);
    if (Number.isNaN(verificationId)) return Errors.badRequest(res, 'Invalid verification id');
    const document = await investorVerificationService.uploadDocument(
      verificationId,
      req.body?.docType,
      req.body?.fileData,
    );
    res.status(201).json({ document, success: true });
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
  }
});

// PATCH /verifications/:id/submit — submit for review
router.patch('/verifications/:id/submit', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const verificationId = parseInt(req.params.id, 10);
    if (Number.isNaN(verificationId)) return Errors.badRequest(res, 'Invalid verification id');
    const verification = await investorVerificationService.submitForReview(verificationId);
    res.json({ verification, success: true });
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
  }
});

// PATCH /verifications/:id/review — admin: approve/reject/request-more-info
router.patch('/verifications/:id/review', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return Errors.forbidden(res, 'Admin access required');
    }
    const verificationId = parseInt(req.params.id, 10);
    if (Number.isNaN(verificationId)) return Errors.badRequest(res, 'Invalid verification id');
    const { decision, notes } = req.body;
    if (!['approved', 'rejected', 'more_info_needed'].includes(decision)) {
      return Errors.badRequest(res, 'Invalid decision. Must be approved, rejected, or more_info_needed');
    }
    const adminId = parseInt(String(req.user?.id), 10);
    const verification = await investorVerificationService.reviewVerification(
      verificationId,
      Number.isNaN(adminId) ? 0 : adminId,
      decision,
      notes
    );
    res.json({ verification, success: true });
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
  }
});

// GET /verifications/:id/history — audit trail
router.get('/verifications/:id/history', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const investorProfileId = parseInt(req.params.id, 10);
    if (Number.isNaN(investorProfileId)) return Errors.badRequest(res, 'Invalid id');
    const history = await investorVerificationService.getVerificationHistory(investorProfileId);
    res.json({ history });
  } catch (error) {
    Errors.internal(res, error);
  }
});

// GET /admin/verifications — list all pending verifications (admin only)
// TODO(tsc): InvestorVerificationService exposes no listAllVerifications()
// (state lives in an in-memory per-process store keyed by investor profile).
// Endpoint preserved but returns an empty set until a persistent listing API
// is added to the service.
router.get('/admin/verifications', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return Errors.forbidden(res, 'Admin access required');
    }
    res.json({ verifications: [] });
  } catch (error) {
    Errors.internal(res, error);
  }
});

// POST /verifications/:id/accreditation — submit accreditation attestation
router.post('/verifications/:id/accreditation', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const investorProfileId = parseInt(req.params.id, 10);
    if (Number.isNaN(investorProfileId)) return Errors.badRequest(res, 'Invalid id');
    const accreditation = await investorVerificationService.accreditationCheck(
      investorProfileId,
      {
        netWorth: Number(req.body?.netWorth) || 0,
        annualIncome: Number(req.body?.annualIncome) || 0,
      },
    );
    res.status(201).json({ accreditation, success: true });
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
  }
});

export default router;
