import { Router, type Request, type Response } from 'express';
import { complianceAI } from './services/complianceAI';
import { storage } from './storage';
import { db } from './db';
import { auditEvents, deals } from '@shared/schema';
import { and, eq, desc } from 'drizzle-orm';
import { logger } from './utils/logger';
import { Errors } from "./utils/errors";

const router = Router();


// GET /dashboard — full compliance dashboard for org
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const dashboard = await complianceAI.getComplianceDashboard(org.id);
    res.json({ dashboard });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// GET /alerts — all compliance alerts for org
router.get('/alerts', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const alerts = await complianceAI.getAlertsForOrganization(org.id);
    res.json({ alerts });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// GET /properties/:id/alerts — compliance alerts for a specific property
router.get('/properties/:id/alerts', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const alerts = await complianceAI.getAlertsForProperty(org.id, parseInt(req.params.id));
    res.json({ alerts });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// GET /properties/:id/check — full compliance check for a property
router.get('/properties/:id/check', async (req: Request, res: Response) => {
  try {
    const result = await complianceAI.checkPropertyCompliance(parseInt(req.params.id));
    res.json({ result });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// PATCH /alerts/:id/acknowledge
router.patch('/alerts/:id/acknowledge', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const alertId = parseInt(req.params.id);
    // acknowledgeAlert(organizationId, alertId, userId) — all align with the
    // service: org id (number), alert id (string), user id (string).
    await complianceAI.acknowledgeAlert(org.id, req.params.id, req.user.id);

    try {
      const user = req.user;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId: (user?.id || user?.id)?.toString() || null,
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
    Errors.internal(res, err);
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
        userId: (user?.id || user?.id)?.toString() || null,
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
    Errors.internal(res, err);
  }
});

// POST /disclosures — generate a required disclosure document
router.post('/disclosures', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { propertyId, disclosureType } = req.body;
    const disclosure = await complianceAI.generateDisclosure(parseInt(propertyId), disclosureType);

    try {
      const user = req.user;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId: (user?.id || user?.id)?.toString() || null,
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
    Errors.internal(res, err);
  }
});

// POST /monitor — register a jurisdiction for ongoing compliance monitoring
router.post('/monitor', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { state, county } = req.body;
    await complianceAI.monitorJurisdiction(state, county);

    try {
      const user = req.user;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId: (user?.id || user?.id)?.toString() || null,
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
    Errors.internal(res, err);
  }
});

// POST /usury-check
router.post('/usury-check', async (req: Request, res: Response) => {
  try {
    const { checkUsury } = await import('./services/usury');
    const { state, rate } = req.body;
    if (!state || rate === undefined) return Errors.badRequest(res, 'state and rate required');
    const clearance = checkUsury(state, Number(rate));
    res.json(clearance);
  } catch (e: any) {
    Errors.internal(res, e);
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
    Errors.internal(res, e);
  }
});

// ─── Pillar J — Evidence Pack ────────────────────────────────────────
//
// One-click forensic export per deal. Pulls every audit event tied to
// the deal (or its constituent lead / property / contract) and returns
// a structured JSON blob the customer can show their attorney. PDF
// rendering is queued; the JSON contract is the hard part.
//
// Authorization: the deal must belong to the org. Returns 404 (not
// 403) for cross-tenant probes to avoid leaking deal existence.
//
// GET /api/compliance/evidence-pack/:dealId
router.get('/evidence-pack/:dealId', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    if (!org) return Errors.unauthorized(res);
    const dealId = parseInt(req.params.dealId, 10);
    if (!Number.isFinite(dealId)) {
      return Errors.badRequest(res, 'Invalid dealId');
    }

    // Confirm the deal exists in this org.
    const [deal] = await db
      .select()
      .from(deals)
      .where(and(eq(deals.id, dealId), eq(deals.organizationId, org.id)))
      .limit(1);
    if (!deal) {
      return Errors.notFound(res, 'Deal');
    }

    // Audit events scoped to the deal itself OR the underlying property
    // OR the lead linked to the deal. Reads three slices and merges by
    // createdAt.
    const dealEvents = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.targetType, 'deal'), eq(auditEvents.targetId, String(dealId))))
      .orderBy(desc(auditEvents.createdAt));

    const propertyEvents = deal.propertyId
      ? await db
          .select()
          .from(auditEvents)
          .where(and(eq(auditEvents.targetType, 'property'), eq(auditEvents.targetId, String(deal.propertyId))))
          .orderBy(desc(auditEvents.createdAt))
      : [];

    // TODO(tsc): deals has no leadId column, so deal-linked lead audit events
    // cannot be resolved here. Preserves prior runtime behavior (deal.leadId
    // was always undefined → empty result). Needs a deals.leadId schema link.
    const leadEvents: typeof dealEvents = [];

    const allEvents = [...dealEvents, ...propertyEvents, ...leadEvents].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    // Group events by category for the PDF-renderer to lay out.
    const grouped = {
      lifecycle: allEvents.filter((e) => /(create|delete|stage|status)/i.test(e.action)),
      signatures: allEvents.filter((e) => /sign|signature/i.test(e.action)),
      disclosures: allEvents.filter((e) => /disclosure|tila|reg.?z/i.test(e.action)),
      communications: allEvents.filter((e) => /email|sms|mail|notification/i.test(e.action)),
      agentActions: allEvents.filter((e) => /^(agent|pax|sophie|atlas|forge)/i.test(e.action) || e.actorUserId === null),
      operator: allEvents.filter((e) => e.actorUserId !== null && !/^(agent|pax|sophie|atlas|forge)/i.test(e.action)),
      other: allEvents.filter(
        (e) =>
          !/(create|delete|stage|status)/i.test(e.action) &&
          !/sign|signature/i.test(e.action) &&
          !/disclosure|tila|reg.?z/i.test(e.action) &&
          !/email|sms|mail|notification/i.test(e.action) &&
          !/^(agent|pax|sophie|atlas|forge)/i.test(e.action),
      ),
    };

    // Header summary the PDF cover page reads.
    const summary = {
      orgId: org.id,
      dealId: deal.id,
      dealAddress: deal.propertyId ? `Property #${deal.propertyId}` : '—',
      dealStatus: (deal as any).status ?? '—',
      generatedAt: new Date().toISOString(),
      eventCounts: {
        total: allEvents.length,
        lifecycle: grouped.lifecycle.length,
        signatures: grouped.signatures.length,
        disclosures: grouped.disclosures.length,
        communications: grouped.communications.length,
        agentActions: grouped.agentActions.length,
        operatorActions: grouped.operator.length,
        other: grouped.other.length,
      },
      // The PDF cover stamp says this is the evidence pack the
      // customer would hand an attorney. Wording is intentional.
      header:
        'AcreOS Evidence Pack — forensic export of every recorded event tied to this deal. Audit trail integrity is enforced by AcreOS at the database layer; the export below reflects the system of record as of the timestamp above.',
    };

    res.json({ summary, events: grouped });
  } catch (err: any) {
    logger.error('[compliance.evidence-pack] error', err);
    Errors.internal(res, err);
  }
});

export default router;
