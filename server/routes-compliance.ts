import { Router, type Request, type Response } from 'express';
import { complianceAI } from './services/complianceAI';

const router = Router();

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error('Organization not found');
  return org;
}

// GET /dashboard — full compliance dashboard for org
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const dashboard = await complianceAI.getComplianceDashboard(org.id);
    res.json({ dashboard });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /alerts — all compliance alerts for org
router.get('/alerts', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const alerts = await complianceAI.getAlertsForOrganization(org.id);
    res.json({ alerts });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /properties/:id/alerts — compliance alerts for a specific property
router.get('/properties/:id/alerts', async (req: Request, res: Response) => {
  try {
    const alerts = await complianceAI.getAlertsForProperty(parseInt(req.params.id));
    res.json({ alerts });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /properties/:id/check — full compliance check for a property
router.get('/properties/:id/check', async (req: Request, res: Response) => {
  try {
    const result = await complianceAI.checkPropertyCompliance(parseInt(req.params.id));
    res.json({ result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /alerts/:id/acknowledge
router.patch('/alerts/:id/acknowledge', async (req: Request, res: Response) => {
  try {
    await complianceAI.acknowledgeAlert(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /alerts/:id/resolve
router.patch('/alerts/:id/resolve', async (req: Request, res: Response) => {
  try {
    const { resolution } = req.body;
    await complianceAI.resolveAlert(parseInt(req.params.id), resolution);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /disclosures — generate a required disclosure document
router.post('/disclosures', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { propertyId, disclosureType } = req.body;
    const disclosure = await complianceAI.generateDisclosure(org.id, parseInt(propertyId), disclosureType);
    res.json({ disclosure });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /monitor — register a jurisdiction for ongoing compliance monitoring
router.post('/monitor', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { state, county } = req.body;
    await complianceAI.monitorJurisdiction(org.id, state, county);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
