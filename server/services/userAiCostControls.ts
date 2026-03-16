/**
 * T20 — Per-User AI Cost Controls
 *
 * Tracks AI token usage at the user level and enforces configurable
 * daily/monthly spending caps set by org admins.
 *
 * Storage: Redis (preferred, fast lookups) with DB fallback for reporting.
 *
 * How it works:
 *   Before any AI call: check if user is within their budget
 *   After any AI call: record the cost
 *   Daily/monthly caps: configurable per org in settings
 *   Budget exhausted: returns 429 with clear message and resets-at time
 *
 * Usage:
 *   import { userAiCostControls } from "./userAiCostControls";
 *
 *   // In an AI route handler:
 *   const allowed = await userAiCostControls.checkBudget(orgId, userId);
 *   if (!allowed.ok) return res.status(429).json({ message: allowed.message });
 *
 *   const response = await callAI(...);
 *   await userAiCostControls.recordUsage(orgId, userId, response.usage.cost);
 */

const DAILY_RESET_HOUR_UTC = 0; // midnight UTC

interface BudgetConfig {
  dailyLimitUsd: number;    // 0 = unlimited
  monthlyLimitUsd: number;  // 0 = unlimited
}

interface BudgetCheck {
  ok: boolean;
  message?: string;
  resetsAt?: Date;
  dailyUsed: number;
  dailyLimit: number;
  monthlyUsed: number;
  monthlyLimit: number;
}

// Default per-user limits (can be overridden per org in settings)
const DEFAULT_LIMITS: BudgetConfig = {
  dailyLimitUsd: parseFloat(process.env.AI_USER_DAILY_LIMIT_USD ?? "5"),
  monthlyLimitUsd: parseFloat(process.env.AI_USER_MONTHLY_LIMIT_USD ?? "50"),
};

// ─── Redis keys ───────────────────────────────────────────────────────────────

function dailyKey(orgId: number, userId: string): string {
  const today = new Date().toISOString().split("T")[0];
  return `ai:cost:daily:org:${orgId}:user:${userId}:${today}`;
}

function monthlyKey(orgId: number, userId: string): string {
  const yearMonth = new Date().toISOString().slice(0, 7);
  return `ai:cost:monthly:org:${orgId}:user:${userId}:${yearMonth}`;
}

// ─── Redis client ─────────────────────────────────────────────────────────────

let _redis: any = null;
async function getRedis(): Promise<any | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (_redis) return _redis;
  try {
    const IORedis = (await import("ioredis")).default;
    _redis = new IORedis(url, { maxRetriesPerRequest: 1, enableReadyCheck: false, lazyConnect: true });
    await _redis.connect().catch(() => {});
    return _redis;
  } catch {
    return null;
  }
}

// In-memory fallback
const memUsage = new Map<string, number>();

async function getUsage(key: string): Promise<number> {
  try {
    const r = await getRedis();
    if (r) return parseFloat((await r.get(key)) ?? "0");
  } catch {}
  return memUsage.get(key) ?? 0;
}

async function addUsage(key: string, amount: number, ttlSeconds: number): Promise<void> {
  try {
    const r = await getRedis();
    if (r) {
      await r.incrbyfloat(key, amount);
      await r.expire(key, ttlSeconds);
      return;
    }
  } catch {}
  memUsage.set(key, (memUsage.get(key) ?? 0) + amount);
}

// ─── Public API ──────────────────────────────────────────────────────────────

export const userAiCostControls = {
  /**
   * Check if a user is within their AI cost budget.
   */
  async checkBudget(
    orgId: number,
    userId: string,
    limits?: Partial<BudgetConfig>
  ): Promise<BudgetCheck> {
    const config: BudgetConfig = {
      dailyLimitUsd: limits?.dailyLimitUsd ?? DEFAULT_LIMITS.dailyLimitUsd,
      monthlyLimitUsd: limits?.monthlyLimitUsd ?? DEFAULT_LIMITS.monthlyLimitUsd,
    };

    const [daily, monthly] = await Promise.all([
      getUsage(dailyKey(orgId, userId)),
      getUsage(monthlyKey(orgId, userId)),
    ]);

    // Check daily limit
    if (config.dailyLimitUsd > 0 && daily >= config.dailyLimitUsd) {
      const tomorrow = new Date();
      tomorrow.setUTCHours(24, 0, 0, 0);
      return {
        ok: false,
        message: `Daily AI budget ($${config.dailyLimitUsd}) reached. Resets at midnight UTC.`,
        resetsAt: tomorrow,
        dailyUsed: daily,
        dailyLimit: config.dailyLimitUsd,
        monthlyUsed: monthly,
        monthlyLimit: config.monthlyLimitUsd,
      };
    }

    // Check monthly limit
    if (config.monthlyLimitUsd > 0 && monthly >= config.monthlyLimitUsd) {
      const nextMonth = new Date();
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 1);
      nextMonth.setUTCHours(0, 0, 0, 0);
      return {
        ok: false,
        message: `Monthly AI budget ($${config.monthlyLimitUsd}) reached.`,
        resetsAt: nextMonth,
        dailyUsed: daily,
        dailyLimit: config.dailyLimitUsd,
        monthlyUsed: monthly,
        monthlyLimit: config.monthlyLimitUsd,
      };
    }

    return {
      ok: true,
      dailyUsed: daily,
      dailyLimit: config.dailyLimitUsd,
      monthlyUsed: monthly,
      monthlyLimit: config.monthlyLimitUsd,
    };
  },

  /**
   * Record AI usage for a user. Call this after a successful AI response.
   * @param costUsd  Cost in USD (estimate from token count × price)
   */
  async recordUsage(
    orgId: number,
    userId: string,
    costUsd: number
  ): Promise<void> {
    if (costUsd <= 0) return;

    const secsUntilMidnight = (() => {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setUTCHours(24, 0, 0, 0);
      return Math.ceil((midnight.getTime() - now.getTime()) / 1000);
    })();

    const secsUntilMonthEnd = (() => {
      const now = new Date();
      const nextMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
      return Math.ceil((nextMonth.getTime() - now.getTime()) / 1000);
    })();

    await Promise.all([
      addUsage(dailyKey(orgId, userId), costUsd, secsUntilMidnight + 60),
      addUsage(monthlyKey(orgId, userId), costUsd, secsUntilMonthEnd + 60),
    ]);
  },

  /**
   * Get current usage stats for a user (for the UI).
   */
  async getUsageStats(
    orgId: number,
    userId: string
  ): Promise<{
    dailyUsed: number;
    monthlyUsed: number;
    dailyLimit: number;
    monthlyLimit: number;
  }> {
    const [daily, monthly] = await Promise.all([
      getUsage(dailyKey(orgId, userId)),
      getUsage(monthlyKey(orgId, userId)),
    ]);

    return {
      dailyUsed: daily,
      monthlyUsed: monthly,
      dailyLimit: DEFAULT_LIMITS.dailyLimitUsd,
      monthlyLimit: DEFAULT_LIMITS.monthlyLimitUsd,
    };
  },

  /**
   * Estimate cost in USD from token counts.
   * Uses approximate GPT-4o pricing as baseline.
   */
  estimateCostUsd(inputTokens: number, outputTokens: number, model = "gpt-4o"): number {
    const pricing: Record<string, { input: number; output: number }> = {
      "gpt-4o": { input: 0.000005, output: 0.000015 },
      "gpt-4o-mini": { input: 0.00000015, output: 0.0000006 },
      "gpt-4": { input: 0.00003, output: 0.00006 },
      "gpt-3.5-turbo": { input: 0.0000005, output: 0.0000015 },
      "claude-3-5-sonnet": { input: 0.000003, output: 0.000015 },
      "claude-3-opus": { input: 0.000015, output: 0.000075 },
    };

    const rates = pricing[model] ?? pricing["gpt-4o"];
    return inputTokens * rates.input + outputTokens * rates.output;
  },
};
