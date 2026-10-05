/**
 * AcreOS MCP (Model Context Protocol) Server
 *
 * Exposes AcreOS data as callable tools for power users' AI workflows.
 *
 * POST /api/mcp/execute
 * Auth: Bearer token — must match organization's API key stored in
 *       organizationIntegrations (provider = "mcp_api_key") or the
 *       organization's own slug-derived token until dedicated API key support lands.
 *
 * Rate limit: 100 requests / hour per org (tracked in-memory, reset hourly).
 */

import type { Request, Response } from 'express';
import { db } from './db';
import { storage } from './storage';
import {
  dealTallies,
  leadTallies,
  listDealsNewestFirst,
  listLeadsNewestFirst,
  listPropertiesNewestFirst,
  propertyTallies,
} from './storage/wholeOrgReadsE';
import { organizationIntegrations, organizations } from '../shared/schema';
import { eq, and } from 'drizzle-orm';
import { sendError } from "./utils/errors";

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

interface RateLimitBucket {
  count: number;
  resetAt: number; // epoch ms
}

const rateLimitMap = new Map<number, RateLimitBucket>();
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRateLimit(orgId: number): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let bucket = rateLimitMap.get(orgId);

  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(orgId, bucket);
  }

  if (bucket.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }

  bucket.count += 1;
  return { allowed: true, remaining: RATE_LIMIT_MAX - bucket.count, resetAt: bucket.resetAt };
}

// ─── API Key Auth ─────────────────────────────────────────────────────────────

async function resolveOrgFromApiKey(bearerToken: string): Promise<number | null> {
  if (!bearerToken) return null;

  // Look up in organizationIntegrations where provider = 'mcp_api_key'
  // and the apiKey credential matches
  try {
    const integrations = await db
      .select()
      .from(organizationIntegrations)
      .where(
        and(
          eq(organizationIntegrations.provider, 'mcp_api_key'),
          eq(organizationIntegrations.isEnabled, true)
        )
      );

    for (const integration of integrations) {
      const creds = integration.credentials as any;
      const storedKey = creds?.apiKey ?? creds?.encrypted;
      if (storedKey && storedKey === bearerToken) {
        return integration.organizationId;
      }
    }
  } catch {
    // fall through
  }

  return null;
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

type ToolParams = Record<string, any>;

/**
 * The list tools' row limit: the caller's (default 50), at most 200. An
 * unreadable or non-positive limit returns no rows, as the old slice did for
 * NaN and 0.
 */
function listLimit(limit: unknown): number {
  const n = Math.min(Number(limit), 200);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function runTool(
  toolName: string,
  params: ToolParams,
  orgId: number
): Promise<unknown> {
  switch (toolName) {
    case 'get_leads': {
      // Filtered, ordered newest first and limited in SQL over the whole live
      // book (DEFECT-0171) — a status filter over the newest 5000 could not
      // find an older lead.
      const { status, limit = 50 } = params;
      return listLeadsNewestFirst(orgId, { status: status || undefined }, listLimit(limit));
    }

    case 'get_properties': {
      const { status, limit = 50 } = params;
      return listPropertiesNewestFirst(orgId, { status: status || undefined }, listLimit(limit));
    }

    case 'get_deals': {
      const { stage, limit = 50 } = params;
      return listDealsNewestFirst(orgId, { status: stage || undefined }, listLimit(limit));
    }

    case 'get_market_prediction': {
      const { state, county } = params;
      if (!state) throw new Error('state is required');
      // Delegate to predictions service if available; otherwise return a stub
      try {
        // @ts-expect-error -- dynamic import; module may not exist at compile time
        const { predictionsService } = await import('./services/predictionsService');
        const prediction = await predictionsService.getMarketPrediction(state, county);
        return prediction;
      } catch {
        return {
          state,
          county: county ?? null,
          trend: 'unknown',
          note: 'Market prediction service unavailable',
        };
      }
    }

    case 'get_portfolio_summary': {
      // Every figure an SQL aggregate over the whole book (DEFECT-0171):
      // these were counts and sums of the newest 5000 of each kind.
      const [leads, properties, deals] = await Promise.all([
        leadTallies(orgId),
        propertyTallies(orgId),
        dealTallies(orgId),
      ]);
      const sumOf = (byStatus: Record<string, number>, statuses: string[]) =>
        statuses.reduce((sum, s) => sum + (byStatus[s] ?? 0), 0);

      return {
        totalLeads: leads.total,
        activeLeads: leads.total - sumOf(leads.byStatus, ['closed', 'dead', 'converted']),
        totalProperties: properties.total,
        ownedProperties: properties.byStatus['owned'] ?? 0,
        totalDeals: deals.total,
        openDeals: deals.total - sumOf(deals.byStatus, ['closed', 'cancelled']),
        closedDeals: deals.byStatus['closed'] ?? 0,
        totalRevenueUsd: deals.acceptedElseOfferSumByStatus['closed'] ?? 0,
      };
    }

    case 'create_lead': {
      const { firstName, lastName, email, phone, address, state, source } = params;
      if (!firstName && !lastName) {
        throw new Error('At least firstName or lastName is required');
      }
      const newLead = await storage.createLead({
        organizationId: orgId,
        firstName: firstName ?? '',
        lastName: lastName ?? '',
        email: email ?? null,
        phone: phone ?? null,
        address: address ?? null,
        state: state ?? null,
        source: source ?? 'mcp_api',
        status: 'new',
      });
      return newLead;
    }

    default:
      throw new Error(`Unknown tool: ${toolName}. Available tools: get_leads, get_properties, get_deals, get_market_prediction, get_portfolio_summary, create_lead`);
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function mcpHandler(req: Request, res: Response): Promise<void> {
  // 1. Extract Bearer token
  const authHeader = req.headers.authorization ?? '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!bearerToken) {
    sendError(res, 401, "UNAUTHORIZED", 'Missing Bearer token in Authorization header');
    return;
  }

  // 2. Resolve org from API key
  const orgId = await resolveOrgFromApiKey(bearerToken);
  if (!orgId) {
    sendError(res, 401, "UNAUTHORIZED", 'Invalid API key');
    return;
  }

  // 3. Rate limit check
  const rateCheck = checkRateLimit(orgId);
  res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT_MAX));
  res.setHeader('X-RateLimit-Remaining', String(rateCheck.remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.floor(rateCheck.resetAt / 1000)));

  if (!rateCheck.allowed) {
    res.status(429).json({
      error: 'Rate limit exceeded',
      resetAt: new Date(rateCheck.resetAt).toISOString(),
    });
    return;
  }

  // 4. Parse request body
  const { tool, params = {}, orgId: bodyOrgId } = req.body ?? {};

  if (!tool || typeof tool !== 'string') {
    sendError(res, 400, "BAD_REQUEST", 'tool (string) is required in request body');
    return;
  }

  // orgId in body must match the key's org if provided
  if (bodyOrgId !== undefined && Number(bodyOrgId) !== orgId) {
    sendError(res, 403, "FORBIDDEN", 'orgId in body does not match API key organization');
    return;
  }

  // 5. Execute tool
  const startedAt = Date.now();
  try {
    const result = await runTool(tool, params, orgId);

    // 6. Log execution to activity log
    try {
      await storage.logActivity({
        organizationId: orgId,
        action: 'mcp_execution',
        entityType: 'mcp_tool',
        entityId: 0,
        description: `MCP tool executed: ${tool}`,
        metadata: { tool, params, durationMs: Date.now() - startedAt },
      });
    } catch {
      // Non-fatal: don't fail the request if activity logging fails
    }

    res.json({
      success: true,
      tool,
      result,
      executedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    });
  } catch (err: any) {
    // Log failed execution
    try {
      await storage.logActivity({
        organizationId: orgId,
        action: 'mcp_execution_error',
        entityType: 'mcp_tool',
        entityId: 0,
        description: `MCP tool failed: ${tool} — ${err.message}`,
        metadata: { tool, params, error: err.message, durationMs: Date.now() - startedAt },
      });
    } catch {
      // Non-fatal
    }

    res.status(400).json({
      success: false,
      tool,
      error: err.message,
    });
  }
}
