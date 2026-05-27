import { Router, type Request, type Response } from 'express';
import { acreOSValuation } from './services/acreOSValuation';
import { db } from './db';
import { properties } from '../shared/schema';
import { eq, and } from 'drizzle-orm';
import { cacheResponse } from './middleware/responseCache';
import { handleLandStatusError } from './utils/landStatus';
import { poolDebit, refundPoolDebit } from './services/creditPool';
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

    res.json({
      valuation,
      creditPool: {
        debitedCents: debit.debitedCents,
        remaining: debit.remaining,
        poolMonthly: debit.poolMonthly,
      },
    });
  } catch (error: any) {
    if (handleLandStatusError(res, error)) return;
    res.status(400).json({ error: error.message });
  }
});

// Generate valuation by property ID (pulls property details from DB)
router.post('/property/:propertyId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const org = req.organization;
    const [property] = await db
      .select()
      .from(properties)
      .where(and(eq(properties.id, req.params.propertyId), eq(properties.organizationId, org.id)));

    if (!property) {
      return res.status(404).json({ error: 'Property not found' });
    }

    const request = {
      propertyId: property.id,
      acres: property.acres || 0,
      location: {
        state: property.state || '',
        county: property.county || '',
        zipCode: property.zipCode || '',
        latitude: property.latitude ? parseFloat(property.latitude) : 0,
        longitude: property.longitude ? parseFloat(property.longitude) : 0,
      },
      characteristics: {
        zoning: property.zoning || undefined,
        waterRights: property.waterRights || undefined,
        utilities: property.utilities || undefined,
        roadAccess: property.roadAccess || undefined,
        topography: property.topography || undefined,
        floodZone: property.floodZone || undefined,
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

    res.json({
      valuation,
      property,
      creditPool: {
        debitedCents: debit.debitedCents,
        remaining: debit.remaining,
        poolMonthly: debit.poolMonthly,
      },
    });
  } catch (error: any) {
    if (handleLandStatusError(res, error)) return;
    res.status(400).json({ error: error.message });
  }
});

// =====================
// VALUATION HISTORY
// =====================

router.get('/history/:propertyId', cacheResponse(300), async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const history = await acreOSValuation.getValuationHistory(
      org.id.toString(),
      req.params.propertyId
    );
    res.json({ history });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(400).json({ error: error.message });
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
    res.status(400).json({ error: error.message });
  }
});

export default router;
