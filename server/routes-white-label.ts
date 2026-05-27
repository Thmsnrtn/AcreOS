import { Router, type Request, type Response } from 'express';
import { whiteLabelService } from './services/whiteLabelService';
import { Errors } from './utils/errors';

const router = Router();


/**
 * GET /white-label/config
 * Returns the white-label config for the current org (if it's a tenant).
 */
router.get('/config', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const config = await whiteLabelService.getConfig(org.id);
    res.json({ config });
  } catch (err) {
    Errors.internal(res, err);
  }
});

/**
 * POST /white-label/tenants
 * Create a new white-label tenant under this organization (reseller flow).
 * Body: { tenantOrganizationId, brandName, primaryColor, ... }
 */
router.post('/tenants', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { tenantOrganizationId, ...configData } = req.body;

    if (!tenantOrganizationId) {
      return Errors.badRequest(res, 'tenantOrganizationId is required');
    }

    const config = await whiteLabelService.createTenant(
      org.id,
      parseInt(tenantOrganizationId),
      configData
    );

    res.json({ config, success: true });
  } catch (err) {
    Errors.badRequest(res, err instanceof Error ? err.message : 'Bad request');
  }
});

/**
 * GET /white-label/tenants
 * List all tenants managed by this organization.
 */
router.get('/tenants', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const tenants = await whiteLabelService.listTenants(org.id);
    res.json({ tenants });
  } catch (err) {
    Errors.internal(res, err);
  }
});

/**
 * PATCH /white-label/config
 * Update white-label config for current org.
 */
router.patch('/config', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const updated = await whiteLabelService.updateConfig(org.id, req.body);
    res.json({ config: updated, success: true });
  } catch (err) {
    Errors.badRequest(res, err instanceof Error ? err.message : 'Bad request');
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
  } catch (err) {
    Errors.badRequest(res, err instanceof Error ? err.message : 'Bad request');
  }
});

/**
 * GET /white-label/report
 * Reseller report: tenant count, status breakdown, revenue.
 */
router.get('/report', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const report = await whiteLabelService.getResellerReport(org.id);
    res.json({ report });
  } catch (err) {
    Errors.internal(res, err);
  }
});

/**
 * GET /white-label/analytics
 * Reseller analytics card data. Shape matches the ResellerDashboard
 * client contract: { analytics: { totalTenants, activeTenants,
 * trialTenants, totalUsers, totalRevenue, mrr, totalAiCreditsUsed } }.
 */
router.get('/analytics', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const tenants = await whiteLabelService.listTenants(org.id);
    const totalTenants = tenants.length;
    const activeTenants = tenants.filter((t: any) => t.status === 'active').length;
    const trialTenants = tenants.filter((t: any) => t.status === 'trial').length;
    // These roll-ups require per-tenant aggregation; default to 0 when
    // the service hasn't populated them (Stripe Connect not live yet).
    const report = await whiteLabelService.getResellerReport(org.id).catch(() => null);
    res.json({
      analytics: {
        totalTenants,
        activeTenants,
        trialTenants,
        totalUsers: (report as any)?.totalUsers ?? 0,
        totalRevenue: (report as any)?.totalRevenue ?? 0,
        mrr: (report as any)?.mrr ?? 0,
        totalAiCreditsUsed: (report as any)?.totalAiCreditsUsed ?? 0,
      },
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

/**
 * GET /white-label/revenue-trend
 * 12-month revenue + new-tenant-count trend. Returns an empty series
 * when Stripe Connect isn't populated — the chart renders "no data"
 * rather than crashing the page.
 */
router.get('/revenue-trend', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const report = await whiteLabelService.getResellerReport(org.id).catch(() => null);
    const trend = (report as any)?.revenueTrend ?? [];
    res.json({ trend });
  } catch (err) {
    Errors.internal(res, err);
  }
});

/**
 * GET /white-label/features/:feature
 * Check if a specific feature is enabled for this org.
 */
router.get('/features/:feature', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const feature = req.params.feature as any;
    const enabled = await whiteLabelService.isFeatureEnabled(org.id, feature);
    res.json({ feature, enabled });
  } catch (err) {
    Errors.internal(res, err);
  }
});

export default router;
