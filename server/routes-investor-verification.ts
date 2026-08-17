/**
 * Investor verification (KYC) — a marketplace satellite, tenant-scoped.
 *
 * Every handler below resolves its subject WITHIN the caller's organization.
 * Before 2026-08-12 none of them did: the id came from the URL and went
 * straight to a service method that queried by primary key, so any
 * authenticated member of any org could read another org's KYC status and
 * audit trail, attach documents, advance the state machine, and — as an admin
 * of their own org — approve it, which writes `isVerified` onto the other
 * org's investor profile.
 *
 * `VerificationNotInOrgError` renders as **404, not 403**. A 403 confirms the
 * record exists; enumeration of another tenant's ids should return the same
 * answer as enumeration of ids that were never issued.
 */

import { Router, type Response } from 'express';
import {
  investorVerificationService,
  VerificationNotInOrgError,
} from './services/investorVerification';
import { Errors } from './utils/errors';
import type { AuthenticatedRequest } from './types/request';
import { getOrganizationId } from './types/request';
import { isAdminOrAbove } from './utils/permissions';

const router = Router();


function isAdmin(req: AuthenticatedRequest): boolean {
  const role = req.permissionContext?.role;
  return (!!role && isAdminOrAbove(role)) || req.isFounder === true;
}

/**
 * Cross-tenant refusals answer 404; everything else keeps the handler's own
 * error shape. Centralised so a new handler cannot accidentally leak the
 * distinction by forgetting the branch.
 */
function refuse(res: Response, error: unknown, fallback: (message: string) => void): void {
  if (error instanceof VerificationNotInOrgError) {
    Errors.notFound(res, 'Verification');
    return;
  }
  fallback(error instanceof Error ? error.message : 'Bad request');
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
      investorProfileId,
      getOrganizationId(req),
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
    const investorProfileId = parseInt(String(req.body.investorProfileId), 10);
    if (Number.isNaN(investorProfileId)) return Errors.badRequest(res, 'investorProfileId required');
    // Inline, like every other handler here — see the note on the "no service
    // call omits the org" assertion for why the uniform shape is load-bearing.
    const verification = await investorVerificationService.createVerificationRequest(
      investorProfileId,
      getOrganizationId(req),
    );
    res.status(201).json({ verification, success: true });
  } catch (error) {
    refuse(res, error, (m) => Errors.badRequest(res, m));
  }
});

// POST /verifications/:id/documents — upload verification document
router.post('/verifications/:id/documents', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const verificationId = parseInt(req.params.id, 10);
    if (Number.isNaN(verificationId)) return Errors.badRequest(res, 'Invalid verification id');
    const document = await investorVerificationService.uploadDocument(
      verificationId,
      getOrganizationId(req),
      req.body?.docType,
      req.body?.fileData,
    );
    res.status(201).json({ document, success: true });
  } catch (error) {
    refuse(res, error, (m) => Errors.badRequest(res, m));
  }
});

// PATCH /verifications/:id/submit — submit for review
router.patch('/verifications/:id/submit', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const verificationId = parseInt(req.params.id, 10);
    if (Number.isNaN(verificationId)) return Errors.badRequest(res, 'Invalid verification id');
    const verification = await investorVerificationService.submitForReview(
      verificationId,
      getOrganizationId(req),
    );
    res.json({ verification, success: true });
  } catch (error) {
    refuse(res, error, (m) => Errors.badRequest(res, m));
  }
});

// PATCH /verifications/:id/review — admin: approve/reject/request-more-info
router.patch('/verifications/:id/review', async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Admin OF THE CALLER'S OWN ORG. That was the whole check here, and it is
    // orthogonal to whose verification this is — hence the org argument below.
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
      getOrganizationId(req),
      Number.isNaN(adminId) ? 0 : adminId,
      decision,
      notes
    );
    res.json({ verification, success: true });
  } catch (error) {
    refuse(res, error, (m) => Errors.badRequest(res, m));
  }
});

// GET /verifications/:id/history — audit trail
router.get('/verifications/:id/history', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const investorProfileId = parseInt(req.params.id, 10);
    if (Number.isNaN(investorProfileId)) return Errors.badRequest(res, 'Invalid id');
    const history = await investorVerificationService.getVerificationHistory(
      investorProfileId,
      getOrganizationId(req),
    );
    res.json({ history });
  } catch (error) {
    Errors.internal(res, error);
  }
});

// GET /admin/verifications — this org's pending verifications (admin only)
router.get('/admin/verifications', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return Errors.forbidden(res, 'Admin access required');
    }
    // Was a hardcoded `{ verifications: [] }` behind a TODO reading "the
    // service exposes no listAllVerifications() — state lives in an in-memory
    // per-process store". Both halves of that note were stale: the DB-backing
    // wave moved state into `investor_verification_requests` AND added
    // `listVerifications(orgId)`, the one org-scoped method on the service,
    // which nothing then called. An empty array is not an honest answer to
    // "what is waiting for me to review".
    const verifications = await investorVerificationService.listVerifications(
      getOrganizationId(req),
    );
    res.json({ verifications });
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
      getOrganizationId(req),
      {
        netWorth: Number(req.body?.netWorth) || 0,
        annualIncome: Number(req.body?.annualIncome) || 0,
      },
    );
    res.status(201).json({ accreditation, success: true });
  } catch (error) {
    refuse(res, error, (m) => Errors.badRequest(res, m));
  }
});

export default router;
