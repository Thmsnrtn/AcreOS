import { Router, type Request, type Response } from 'express';
import { investorVerificationService } from './services/investorVerification';

const router = Router();

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error('Organization not found');
  return org;
}

function isAdmin(req: Request): boolean {
  const user = (req as any).user;
  return user?.role === 'admin' || user?.role === 'super_admin';
}

// =====================
// INVESTOR VERIFICATIONS
// =====================

// GET /verifications/:investorId — get verification status
router.get('/verifications/:investorId', async (req: Request, res: Response) => {
  try {
    const verification = await investorVerificationService.getVerificationStatus(
      req.params.investorId
    );
    if (!verification) {
      return res.status(404).json({ error: 'Verification not found' });
    }
    res.json({ verification });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /verifications — create verification request
router.post('/verifications', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const verification = await investorVerificationService.createVerification({
      ...req.body,
      organizationId: org.id,
    });
    res.status(201).json({ verification, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// POST /verifications/:id/documents — upload verification document
router.post('/verifications/:id/documents', async (req: Request, res: Response) => {
  try {
    const document = await investorVerificationService.uploadDocument(
      req.params.id,
      req.body
    );
    res.status(201).json({ document, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// PATCH /verifications/:id/submit — submit for review
router.patch('/verifications/:id/submit', async (req: Request, res: Response) => {
  try {
    const verification = await investorVerificationService.submitForReview(req.params.id);
    res.json({ verification, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// PATCH /verifications/:id/review — admin: approve/reject/request-more-info
router.patch('/verifications/:id/review', async (req: Request, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const { decision, notes } = req.body;
    if (!['approved', 'rejected', 'request_more_info'].includes(decision)) {
      return res.status(400).json({ error: 'Invalid decision. Must be approved, rejected, or request_more_info' });
    }
    const verification = await investorVerificationService.reviewVerification(
      req.params.id,
      decision,
      notes
    );
    res.json({ verification, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// GET /verifications/:id/history — audit trail
router.get('/verifications/:id/history', async (req: Request, res: Response) => {
  try {
    const history = await investorVerificationService.getAuditTrail(req.params.id);
    res.json({ history });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /admin/verifications — list all pending verifications (admin only)
router.get('/admin/verifications', async (req: Request, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const { status, limit, offset } = req.query;
    const verifications = await investorVerificationService.listAllVerifications({
      status: status as string | undefined,
      limit: limit ? parseInt(limit as string) : 50,
      offset: offset ? parseInt(offset as string) : 0,
    });
    res.json({ verifications });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /verifications/:id/accreditation — submit accreditation attestation
router.post('/verifications/:id/accreditation', async (req: Request, res: Response) => {
  try {
    const accreditation = await investorVerificationService.submitAccreditationAttestation(
      req.params.id,
      req.body
    );
    res.status(201).json({ accreditation, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
