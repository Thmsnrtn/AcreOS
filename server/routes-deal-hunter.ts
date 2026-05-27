import { Router, type Request, type Response } from 'express';
import { logger } from './utils/logger';
import { dealHunterService } from './services/dealHunter';
import { db } from './db';
import { dealSources } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { Errors } from './utils/errors';

const router = Router();


// =====================
// DEAL SOURCES
// =====================

router.get('/sources', async (req: Request, res: Response) => {
  try {
    const sources = await db.select().from(dealSources).limit(1000);
    res.json({ sources });
  } catch (error) {
    Errors.internal(res, error);
  }
});

router.post('/sources', async (req: Request, res: Response) => {
  try {
    const source = await dealHunterService.registerSource(req.body);
    res.json({ source, success: true });
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
  }
});

router.post('/sources/:id/scrape', async (req: Request, res: Response) => {
  try {
    const result = await dealHunterService.scrapeSource(parseInt(req.params.id));
    res.json({ result, success: true });
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
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
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
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
  } catch (error) {
    Errors.internal(res, error);
  }
});

router.post('/deals/:id/convert-lead', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const lead = await dealHunterService.convertToLead(org.id, parseInt(req.params.id));
    res.json({ lead, success: true });
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
  }
});

router.post('/deals/:id/convert-property', async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const property = await dealHunterService.convertToProperty(org.id, parseInt(req.params.id));
    res.json({ property, success: true });
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
  }
});

// =====================
// STATS
// =====================

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await dealHunterService.getStats();
    res.json({ stats });
  } catch (error) {
    Errors.internal(res, error);
  }
});

// =====================
// SCRAPE ALL
// =====================

router.post('/scrape-all', async (_req: Request, res: Response) => {
  try {
    // Fire and forget
    dealHunterService.scrapeAllActiveSources().catch(err => logger.error("Scrape all sources failed", err));
    res.json({ success: true, message: 'Scraping all active sources in the background' });
  } catch (error) {
    Errors.badRequest(res, error instanceof Error ? error.message : 'Bad request');
  }
});

export default router;
