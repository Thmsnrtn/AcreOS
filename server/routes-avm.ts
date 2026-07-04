import { Router, type Request, type Response } from 'express';
import { Errors } from './utils/errors';
import { acreOSValuation } from './services/acreOSValuation';
import { db } from './db';
import { properties } from '../shared/schema';
import { eq, and } from 'drizzle-orm';
import { cacheResponse } from './middleware/responseCache';
import { handleLandStatusError } from './utils/landStatus';
import { poolDebit, refundPoolDebit, poolRefusalDetails } from './services/creditPool';
import type { AuthenticatedRequest } from './types/request';

const router = Router();

// Lens 3 (Pricing Coherence): AVM runs an LLM-assisted valuation pipeline
// (county-comp pull → Sonnet synthesis). We bill it as one `ai_turn_avg`
// per run. The two POSTs below both fire one debit; cache hits on
// `getValuationHistory` are read-only and free.

// =====================
// GENERATE VALUATION
// =====================

router.post('/generate', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const org = req.organization;
    const debitKey = `avm:generate:${org.id}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    const debit = await poolDebit({
      organizationId: org.id,
      action: 'ai_turn_avg',
      units: 1,
      externalEventId: debitKey,
      notes: 'AVM valuation (custom request)',
      isFounder: req.isFounder,
    });

      // Tier 1I — pool refusals are surfaced, never swallowed.
      if (!debit.allowed) {
        return Errors.limitExceeded(res, poolRefusalDetails("ai_turn_avg", debit));
      }

    let valuation;
    try {
      valuation = await acreOSValuation.generateValuation(
        org.id.toString(),
        req.body
      );
    } catch (err) {
      if (debit.debitedCents > 0) {
        await refundPoolDebit({
          organizationId: org.id,
          originalEventId: debitKey,
          amountCents: debit.debitedCents,
          reason: 'AVM generation failed',
        });
      }
      throw err;
    }

    // W3.1 — an honest refusal is not a billable valuation.
    if (valuation.status === 'insufficient_data' && debit.debitedCents > 0) {
      await refundPoolDebit({
        organizationId: org.id,
        originalEventId: debitKey,
        amountCents: debit.debitedCents,
        reason: 'AVM refused — insufficient data',
      });
    }

    res.json({
      valuation,
      creditPool: {
        debitedCents: valuation.status === 'insufficient_data' ? 0 : debit.debitedCents,
        remaining: debit.remaining,
        poolMonthly: debit.poolMonthly,
      },
    });
  } catch (error: any) {
    if (handleLandStatusError(res, error)) return;
    Errors.badRequest(res, error.message);
  }
});

// Generate valuation by property ID (pulls property details from DB)
router.post('/property/:propertyId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const org = req.organization;
    const propertyId = parseInt(req.params.propertyId, 10);
    if (Number.isNaN(propertyId)) {
      return Errors.badRequest(res, 'Invalid property id');
    }
    const [property] = await db
      .select()
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, org.id)));

    if (!property) {
      return Errors.notFound(res, 'Property');
    }

    const enrichment = property.enrichmentData as
      | { hazards?: { floodZone?: string } | null }
      | null;
    const utilities = property.utilities
      ? Object.entries(property.utilities)
          .filter(([, v]) => v === true)
          .map(([k]) => k)
      : undefined;

    const request = {
      propertyId: property.id.toString(),
      acres: property.sizeAcres ? parseFloat(property.sizeAcres) : 0,
      location: {
        state: property.state || '',
        county: property.county || '',
        zipCode: property.zip || '',
        latitude: property.latitude ? parseFloat(property.latitude) : 0,
        longitude: property.longitude ? parseFloat(property.longitude) : 0,
      },
      characteristics: {
        zoning: property.zoning || undefined,
        waterRights: property.utilities?.water || undefined,
        utilities,
        roadAccess: property.roadAccess || undefined,
        topography: property.terrain || undefined,
        floodZone: enrichment?.hazards?.floodZone || undefined,
      },
    };

    const debitKey = `avm:property:${org.id}:${property.id}:${Date.now()}`;
    const debit = await poolDebit({
      organizationId: org.id,
      action: 'ai_turn_avg',
      units: 1,
      externalEventId: debitKey,
      notes: `AVM valuation for property ${property.id}`,
      isFounder: req.isFounder,
    });

      // Tier 1I — pool refusals are surfaced, never swallowed.
      if (!debit.allowed) {
        return Errors.limitExceeded(res, poolRefusalDetails("ai_turn_avg", debit));
      }

    let valuation;
    try {
      valuation = await acreOSValuation.generateValuation(org.id.toString(), request);
    } catch (err) {
      if (debit.debitedCents > 0) {
        await refundPoolDebit({
          organizationId: org.id,
          originalEventId: debitKey,
          amountCents: debit.debitedCents,
          reason: 'AVM generation failed',
        });
      }
      throw err;
    }

    // W3.1 — an honest refusal is not a billable valuation.
    if (valuation.status === 'insufficient_data' && debit.debitedCents > 0) {
      await refundPoolDebit({
        organizationId: org.id,
        originalEventId: debitKey,
        amountCents: debit.debitedCents,
        reason: 'AVM refused — insufficient data',
      });
    }

    res.json({
      valuation,
      property,
      creditPool: {
        debitedCents: valuation.status === 'insufficient_data' ? 0 : debit.debitedCents,
        remaining: debit.remaining,
        poolMonthly: debit.poolMonthly,
      },
    });
  } catch (error: any) {
    if (handleLandStatusError(res, error)) return;
    Errors.badRequest(res, error.message);
  }
});

// =====================
// VALUATION HISTORY
// =====================

// W3.1(b): honest labels for every stored model version. The client renders
// `methodology` verbatim — the AI-guess path must read as an AI estimate,
// and pre-honesty baseline rows must not masquerade as modeled values.
const METHODOLOGY_LABELS: Record<string, string> = {
  hybrid_comps_ml: 'AcreOS Valuation Model (comparable sales + market adjustments)',
  gbm_model: 'AcreOS trained model estimate (no local comparables)',
  ai_market_estimate: 'AI estimate (no local comparables) — an educated guess by a language model, not a comps-based value',
  regional_baseline: 'Legacy flat-rate estimate (recorded before the honesty patch — treat with caution)',
  baseline: 'Legacy flat-rate estimate (recorded before the honesty patch — treat with caution)',
};

router.get('/history/:propertyId', cacheResponse(300), async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const rows = await acreOSValuation.getValuationHistory(
      org.id.toString(),
      req.params.propertyId
    );

    // Raw valuation_predictions rows don't match the client's render shape
    // (predictedValue vs estimatedValue, valueRange vs confidenceInterval),
    // so the estimate card silently rendered blanks on reload. Map here,
    // computing price/acre from the property's recorded acreage.
    const propertyIdNum = parseInt(req.params.propertyId, 10);
    let acres: number | null = null;
    if (Number.isFinite(propertyIdNum)) {
      const [prop] = await db
        .select({ sizeAcres: properties.sizeAcres })
        .from(properties)
        .where(and(eq(properties.id, propertyIdNum), eq(properties.organizationId, org.id)));
      acres = prop?.sizeAcres ? parseFloat(prop.sizeAcres) : null;
    }

    const history = rows.map((r: any) => {
      const estimatedValue = Number(r.predictedValue) || 0;
      const valueRange = (r.valueRange ?? {}) as { low?: number; high?: number };
      return {
        ...r,
        estimatedValue,
        pricePerAcre: acres && acres > 0 ? Math.round(estimatedValue / acres) : 0,
        confidence: Number(r.confidenceScore) || 0,
        confidenceInterval: {
          low: valueRange.low ?? estimatedValue,
          high: valueRange.high ?? estimatedValue,
        },
        methodology: METHODOLOGY_LABELS[r.modelVersion] ?? r.modelVersion,
        comparables: [],
        marketAdjustments: [],
        comparableCount: r.comparableCount ?? 0,
      };
    });

    res.json({ history });
  } catch (error: any) {
    Errors.internal(res, error);
  }
});

// =====================
// MODEL STATISTICS
// =====================

router.get('/stats', cacheResponse(600), async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const stats = await acreOSValuation.getTrainingDataStats(org.id.toString());
    res.json({ stats });
  } catch (error: any) {
    Errors.internal(res, error);
  }
});

// =====================
// TRAINING DATA
// =====================

router.post('/record-transaction', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    await acreOSValuation.recordTransactionForTraining(org.id.toString(), req.body);
    res.json({ success: true });
  } catch (error: any) {
    Errors.badRequest(res, error.message);
  }
});

// =====================
// BULK VALUATIONS
// =====================

router.post('/bulk', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    await acreOSValuation.generateBulkValuations(org.id.toString());
    res.json({ success: true, message: 'Bulk valuation started for all owned properties' });
  } catch (error: any) {
    if (handleLandStatusError(res, error)) return;
    Errors.badRequest(res, error.message);
  }
});

export default router;
