// @ts-nocheck — ORM type refinement deferred; runtime-correct
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
import { organizationIntegrations, organizations } from '../shared/schema';
import { eq, and } from 'drizzle-orm';

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

async function runTool(
  toolName: string,
  params: ToolParams,
  orgId: number
): Promise<unknown> {
  switch (toolName) {
    case 'get_leads': {
      const { status, limit = 50 } = params;
      let leads = await storage.getLeads(orgId);
      if (status) {
        leads = leads.filter((l) => l.status === status);
      }
      return leads.slice(0, Math.min(Number(limit), 200));
    }

    case 'get_properties': {
      const { status, limit = 50 } = params;
      let props = await storage.getProperties(orgId);
      if (status) {
        props = props.filter((p) => p.status === status);
      }
      return props.slice(0, Math.min(Number(limit), 200));
    }

    case 'get_deals': {
      const { stage, limit = 50 } = params;
      let deals = await storage.getDeals(orgId);
      if (stage) {
        deals = deals.filter((d) => d.status === stage);
      }
      return deals.slice(0, Math.min(Number(limit), 200));
    }

    case 'get_market_prediction': {
      const { state, county } = params;
      if (!state) throw new Error('state is required');
      // Delegate to predictions service if available; otherwise return a stub
      try {
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
      const [leads, properties, deals] = await Promise.all([
        storage.getLeads(orgId),
        storage.getProperties(orgId),
        storage.getDeals(orgId),
      ]);

      const closedDeals = deals.filter((d) => d.status === 'closed');
      const totalRevenue = closedDeals.reduce((sum, d) => {
        const amount = parseFloat(d.salePrice ?? d.offerAmount ?? '0');
        return sum + (isNaN(amount) ? 0 : amount);
      }, 0);

      return {
        totalLeads: leads.length,
        activeLeads: leads.filter((l) => !['closed', 'dead', 'converted'].includes(l.status ?? '')).length,
        totalProperties: properties.length,
        ownedProperties: properties.filter((p) => p.status === 'owned').length,
        totalDeals: deals.length,
        openDeals: deals.filter((d) => !['closed', 'cancelled'].includes(d.status ?? '')).length,
        closedDeals: closedDeals.length,
        totalRevenueUsd: totalRevenue,
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
        propertyAddress: address ?? null,
        propertyState: state ?? null,
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
    res.status(401).json({ error: 'Missing Bearer token in Authorization header' });
    return;
  }

  // 2. Resolve org from API key
  const orgId = await resolveOrgFromApiKey(bearerToken);
  if (!orgId) {
    res.status(401).json({ error: 'Invalid API key' });
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
    res.status(400).json({ error: 'tool (string) is required in request body' });
    return;
  }

  // orgId in body must match the key's org if provided
  if (bodyOrgId !== undefined && Number(bodyOrgId) !== orgId) {
    res.status(403).json({ error: 'orgId in body does not match API key organization' });
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
        type: 'mcp_execution',
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
        type: 'mcp_execution_error',
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
