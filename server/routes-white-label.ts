import { Router, type Request, type Response } from 'express';
import { whiteLabelService } from './services/whiteLabelService';

const router = Router();

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error('Organization not found');
  return org;
}

/**
 * GET /white-label/config
 * Returns the white-label config for the current org (if it's a tenant).
 */
router.get('/config', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const config = await whiteLabelService.getConfig(org.id);
    res.json({ config });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /white-label/tenants
 * Create a new white-label tenant under this organization (reseller flow).
 * Body: { tenantOrganizationId, brandName, primaryColor, ... }
 */
router.post('/tenants', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { tenantOrganizationId, ...configData } = req.body;

    if (!tenantOrganizationId) {
      return res.status(400).json({ error: 'tenantOrganizationId is required' });
    }

    const config = await whiteLabelService.createTenant(
      org.id,
      parseInt(tenantOrganizationId),
      configData
    );

    res.json({ config, success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /white-label/tenants
 * List all tenants managed by this organization.
 */
router.get('/tenants', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const tenants = await whiteLabelService.listTenants(org.id);
    res.json({ tenants });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /white-label/config
 * Update white-label config for current org.
 */
router.patch('/config', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const updated = await whiteLabelService.updateConfig(org.id, req.body);
    res.json({ config: updated, success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /white-label/tenants/:id/suspend
 * Suspend a tenant.
 */
router.post('/tenants/:id/suspend', async (req: Request, res: Response) => {
  try {
    await whiteLabelService.suspendTenant(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /white-label/report
 * Reseller report: tenant count, status breakdown, revenue.
 */
router.get('/report', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const report = await whiteLabelService.getResellerReport(org.id);
    res.json({ report });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /white-label/features/:feature
 * Check if a specific feature is enabled for this org.
 */
router.get('/features/:feature', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const feature = req.params.feature as any;
    const enabled = await whiteLabelService.isFeatureEnabled(org.id, feature);
    res.json({ feature, enabled });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
