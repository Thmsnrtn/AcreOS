import { Router, type Request, type Response } from 'express';
import { complianceAI } from './services/complianceAI';
import { storage } from './storage';

const router = Router();


// GET /dashboard — full compliance dashboard for org
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const dashboard = await complianceAI.getComplianceDashboard(org.id);
    res.json({ dashboard });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /alerts — all compliance alerts for org
router.get('/alerts', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
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
    const org = req.organization;
    const alertId = parseInt(req.params.id);
    await complianceAI.acknowledgeAlert(alertId);

    try {
      const user = req.user;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId: (user?.claims?.sub || user?.id)?.toString() || null,
        action: "update",
        entityType: "compliance_alert",
        entityId: alertId,
        changes: { after: { acknowledged: true }, fields: ["acknowledged"] },
        ipAddress: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
        metadata: {},
      });
    } catch (e) { /* non-fatal */ }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /alerts/:id/resolve
router.patch('/alerts/:id/resolve', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const alertId = parseInt(req.params.id);
    const { resolution } = req.body;
    await complianceAI.resolveAlert(alertId, resolution);

    try {
      const user = req.user;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId: (user?.claims?.sub || user?.id)?.toString() || null,
        action: "update",
        entityType: "compliance_alert",
        entityId: alertId,
        changes: { after: { resolved: true, resolution }, fields: ["resolved", "resolution"] },
        ipAddress: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
        metadata: {},
      });
    } catch (e) { /* non-fatal */ }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /disclosures — generate a required disclosure document
router.post('/disclosures', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { propertyId, disclosureType } = req.body;
    const disclosure = await complianceAI.generateDisclosure(org.id, parseInt(propertyId), disclosureType);

    try {
      const user = req.user;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId: (user?.claims?.sub || user?.id)?.toString() || null,
        action: "create",
        entityType: "compliance_disclosure",
        entityId: parseInt(propertyId),
        changes: { after: { propertyId, disclosureType }, fields: ["propertyId", "disclosureType"] },
        ipAddress: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
        metadata: {},
      });
    } catch (e) { /* non-fatal */ }

    res.json({ disclosure });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /monitor — register a jurisdiction for ongoing compliance monitoring
router.post('/monitor', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { state, county } = req.body;
    await complianceAI.monitorJurisdiction(org.id, state, county);

    try {
      const user = req.user;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId: (user?.claims?.sub || user?.id)?.toString() || null,
        action: "create",
        entityType: "compliance_monitor",
        entityId: org.id,
        changes: { after: { state, county }, fields: ["state", "county"] },
        ipAddress: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
        metadata: {},
      });
    } catch (e) { /* non-fatal */ }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /usury-check
router.post('/usury-check', async (req: Request, res: Response) => {
  try {
    const { checkUsury } = await import('./services/usury');
    const { state, rate } = req.body;
    if (!state || rate === undefined) return res.status(400).json({ error: 'state and rate required' });
    const clearance = checkUsury(state, Number(rate));
    res.json(clearance);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /usury-audit
router.get('/usury-audit', async (req: Request, res: Response) => {
  try {
    const { auditOrgUsury } = await import('./services/usury');
    const org = req.organization;
    const audit = await auditOrgUsury(org.id);
    res.json(audit);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
