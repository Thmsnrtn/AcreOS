import { Router, type Request, type Response } from 'express';
import { dealHunterService } from './services/dealHunter';
import { db } from './db';
import { dealSources } from '../shared/schema';
import { eq } from 'drizzle-orm';

const router = Router();

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error('Organization not found');
  return org;
}

// =====================
// DEAL SOURCES
// =====================

router.get('/sources', async (req: Request, res: Response) => {
  try {
    const sources = await db.select().from(dealSources);
    res.json({ sources });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/sources', async (req: Request, res: Response) => {
  try {
    const source = await dealHunterService.registerSource(req.body);
    res.json({ source, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/sources/:id/scrape', async (req: Request, res: Response) => {
  try {
    const result = await dealHunterService.scrapeSource(parseInt(req.params.id));
    res.json({ result, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.patch('/sources/:id/toggle', async (req: Request, res: Response) => {
  try {
    const [source] = await db
      .update(dealSources)
      .set({ isActive: req.body.isActive })
      .where(eq(dealSources.id, parseInt(req.params.id)))
      .returning();
    res.json({ source });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// =====================
// SCRAPED DEALS
// =====================

router.get('/deals', async (req: Request, res: Response) => {
  try {
    const { status, sourceType, states, minDistressScore, limit, offset } = req.query;
    const deals = await dealHunterService.getDeals({
      status: status as string | undefined,
      sourceType: sourceType as string | undefined,
      states: states ? (states as string).split(',') : undefined,
      minDistressScore: minDistressScore ? parseInt(minDistressScore as string) : undefined,
      limit: limit ? parseInt(limit as string) : 50,
      offset: offset ? parseInt(offset as string) : 0,
    });
    res.json({ deals });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/deals/:id/convert-lead', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const lead = await dealHunterService.convertToLead(org.id, parseInt(req.params.id));
    res.json({ lead, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/deals/:id/convert-property', async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const property = await dealHunterService.convertToProperty(org.id, parseInt(req.params.id));
    res.json({ property, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// =====================
// STATS
// =====================

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await dealHunterService.getStats();
    res.json({ stats });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================
// SCRAPE ALL
// =====================

router.post('/scrape-all', async (_req: Request, res: Response) => {
  try {
    // Fire and forget
    dealHunterService.scrapeAllActiveSources().catch(console.error);
    res.json({ success: true, message: 'Scraping all active sources in the background' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
