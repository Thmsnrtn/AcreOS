import { Router, type Request, type Response } from 'express';

const router = Router();

// In-memory store for demo/stub — replace with DB/service calls as needed
// These stubs return realistic shaped data so the UI can be wired up immediately.

function parseRange(dateRange: string | undefined): { start?: Date; end?: Date } {
  if (!dateRange) return {};
  const [start, end] = (dateRange as string).split(',');
  return { start: start ? new Date(start) : undefined, end: end ? new Date(end) : undefined };
}

// =====================
// ANALYTICS
// =====================

// GET /fees/analytics — fee analytics (total collected, pending, avg rate)
router.get('/fees/analytics', async (_req: Request, res: Response) => {
  try {
    // Stub: replace with real DB aggregation
    const analytics = {
      totalCollected: 0,
      pendingInEscrow: 0,
      paidOut: 0,
      thisMonth: 0,
      avgFeeRate: 0,
      transactionCount: 0,
      lastUpdated: new Date().toISOString(),
    };
    res.json({ analytics });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================
// SETTLEMENTS
// =====================

// GET /fees/settlements — list settlements with filters
router.get('/fees/settlements', async (req: Request, res: Response) => {
  try {
    const { status, dateRange, limit, offset } = req.query;
    const range = parseRange(dateRange as string | undefined);
    // Stub: replace with service/db call
    const settlements: any[] = [];
    res.json({ settlements, total: 0, filters: { status, range } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /fees/settlements/:id — single settlement details
router.get('/fees/settlements/:id', async (req: Request, res: Response) => {
  try {
    // Stub: replace with DB lookup
    res.status(404).json({ error: 'Settlement not found' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /fees/settlements — create a new settlement
router.post('/fees/settlements', async (req: Request, res: Response) => {
  try {
    const { transactionId, amount, feeRate, notes } = req.body;
    if (!transactionId || !amount) {
      return res.status(400).json({ error: 'transactionId and amount are required' });
    }
    // Stub: replace with service call
    const settlement = {
      id: Date.now(),
      transactionId,
      amount,
      feeRate: feeRate ?? 0,
      notes: notes ?? '',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    res.status(201).json({ settlement, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// PATCH /fees/settlements/:id/release — release from escrow
router.patch('/fees/settlements/:id/release', async (req: Request, res: Response) => {
  try {
    const { releaseNote } = req.body;
    // Stub: replace with service call
    const settlement = {
      id: req.params.id,
      status: 'released',
      releasedAt: new Date().toISOString(),
      releaseNote: releaseNote ?? '',
    };
    res.json({ settlement, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// =====================
// LEDGER
// =====================

// GET /fees/ledger — full audit log entries
router.get('/fees/ledger', async (req: Request, res: Response) => {
  try {
    const { limit, offset, dateRange } = req.query;
    const range = parseRange(dateRange as string | undefined);
    // Stub: replace with DB query
    const entries: any[] = [];
    res.json({
      entries,
      total: 0,
      limit: limit ? parseInt(limit as string) : 100,
      offset: offset ? parseInt(offset as string) : 0,
      range,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =====================
// PAYOUTS
// =====================

// GET /fees/payouts — payout history
router.get('/fees/payouts', async (req: Request, res: Response) => {
  try {
    const { limit, offset } = req.query;
    // Stub: replace with DB query
    const payouts: any[] = [];
    res.json({
      payouts,
      total: 0,
      limit: limit ? parseInt(limit as string) : 50,
      offset: offset ? parseInt(offset as string) : 0,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /fees/payouts/schedule — configure auto-payout schedule
router.post('/fees/payouts/schedule', async (req: Request, res: Response) => {
  try {
    const { frequency, minimumAmount, bankAccountId, enabled } = req.body;
    if (!frequency) {
      return res.status(400).json({ error: 'frequency is required (daily|weekly|monthly)' });
    }
    if (!['daily', 'weekly', 'monthly'].includes(frequency)) {
      return res.status(400).json({ error: 'frequency must be daily, weekly, or monthly' });
    }
    // Stub: persist schedule
    const schedule = {
      frequency,
      minimumAmount: minimumAmount ?? 0,
      bankAccountId: bankAccountId ?? null,
      enabled: enabled ?? true,
      updatedAt: new Date().toISOString(),
    };
    res.json({ schedule, success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// POST /fees/payouts/trigger — manually trigger payout
router.post('/fees/payouts/trigger', async (req: Request, res: Response) => {
  try {
    const { amount, bankAccountId, note } = req.body;
    if (!amount || !bankAccountId) {
      return res.status(400).json({ error: 'amount and bankAccountId are required' });
    }
    // Stub: trigger payout via payment provider
    const payout = {
      id: Date.now(),
      amount,
      bankAccountId,
      note: note ?? '',
      status: 'processing',
      triggeredAt: new Date().toISOString(),
    };
    res.status(202).json({ payout, success: true, message: 'Payout triggered and processing' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
