import { Router, type Request, type Response } from 'express';
import { acreOSValuation } from './services/acreOSValuation';
import { db } from './db';
import { properties } from '../shared/schema';
import { eq, and } from 'drizzle-orm';

const router = Router();

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error('Organization not found');
  return org;
}

// =====================
// GENERATE VALUATION
// =====================

router.post('/generate', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const valuation = await acreOSValuation.generateValuation(
      org.id.toString(),
      req.body
    );
    res.json({ valuation });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Generate valuation by property ID (pulls property details from DB)
router.post('/property/:propertyId', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
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

    const valuation = await acreOSValuation.generateValuation(org.id.toString(), request);
    res.json({ valuation, property });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// =====================
// VALUATION HISTORY
// =====================

router.get('/history/:propertyId', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
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

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
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
    const org = getOrg(req);
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
    const org = getOrg(req);
    await acreOSValuation.generateBulkValuations(org.id.toString());
    res.json({ success: true, message: 'Bulk valuation started for all owned properties' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
