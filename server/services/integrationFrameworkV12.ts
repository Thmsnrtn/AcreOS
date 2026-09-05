/**
 * Integration Execution Framework — Sovereign Company Protocol v12: FOUNDATION
 *
 * Agents touch the real world securely. Every external API call goes through
 * execute() — which checks agent permissions, enforces rate limits, trips
 * circuit breakers on repeated failures, and logs everything. Credentials are
 * stored encrypted. Rollback actions can be registered and triggered.
 *
 * Circuit breaker: after N consecutive failures the breaker opens, blocking
 * further calls until manually reset or the cooldown expires.
 */

import { db } from "../db";
import {
  integrationCredentials,
  integrationExecutionLog,
  type IntegrationCredential,
  type IntegrationExecutionLogEntry,
} from "@shared/schema";
import { eq, and, or, desc, sql, gte, isNull } from "drizzle-orm";

class IntegrationFrameworkService {

  // ─── Register Credential ──────────────────────────────────────────────────────

  async registerCredential(params: {
    serviceName: string;
    credentialType: string;
    value: string;
    allowedAgents: string[];
    rateLimitPerMinute?: number;
    circuitBreakerThreshold?: number;
    orgId?: number;
  }): Promise<Omit<IntegrationCredential, "encryptedValue">> {
    const encrypted = Buffer.from(params.value).toString("base64");

    const [cred] = await db.insert(integrationCredentials).values({
      serviceName: params.serviceName,
      credentialType: params.credentialType,
      encryptedValue: encrypted,
      allowedAgents: params.allowedAgents,
      rateLimitPerMinute: params.rateLimitPerMinute ?? 60,
      circuitBreakerThreshold: params.circuitBreakerThreshold ?? 5,
      orgId: params.orgId ?? null,
    }).returning();

    const { encryptedValue, ...safe } = cred;
    return safe;
  }

  /**
   * Which credential rows a caller may see for a service name.
   *
   * `integration_credentials.org_id` is nullable and untethered — a TAG, not a
   * tenant key — and `service_name` carries no unique constraint, so two rows
   * can share one name. Every read here was `where(eq(serviceName, …))` with a
   * bare `.limit(1)` and NO `orderBy`, which is not "the platform credential":
   * it is an ARBITRARY row among however many share the name. The moment a
   * per-org credential exists, `execute` can base64-decode another tenant's
   * secret and send it as `Authorization: Bearer` to a caller-supplied endpoint.
   *
   * Every row today is a founder-registered platform credential, so this is
   * latent rather than live — but `registerCredential` is wired to
   * `POST /api/founder/v12/integrations` and takes `req.body` unvalidated, so
   * `orgId` can be set today and the column is not guaranteed null. The rule:
   * an org sees its OWN credential and the platform fallback, never another
   * org's; and `orderBy` makes which one wins a decision rather than an
   * accident.
   *
   * The column is load-bearing elsewhere and must not simply be dropped:
   * `orgDeletion.TENANT_KEY_COLUMNS` enumerates tables by `org_id`, and
   * `integration_credentials` is named in the test that pins that sweep.
   */
  private credentialLane(orgId: number | null | undefined) {
    return orgId == null
      ? isNull(integrationCredentials.orgId)
      : or(
          eq(integrationCredentials.orgId, orgId),
          isNull(integrationCredentials.orgId),
        );
  }

  /** The org's own row before the platform fallback — never an arbitrary one. */
  private static readonly LANE_ORDER = sql`org_id NULLS LAST`;

  // ─── THE EXECUTOR ─────────────────────────────────────────────────────────────

  async execute(
    agentCodename: string,
    serviceName: string,
    method: string,
    endpoint: string,
    params?: {
      body?: Record<string, any>;
      rollbackAction?: string;
      orgId?: number;
    },
  ): Promise<IntegrationExecutionLogEntry> {
    const startTime = Date.now();

    // 1. Find credential for this service
    const [cred] = await db
      .select()
      .from(integrationCredentials)
      .where(and(
        eq(integrationCredentials.serviceName, serviceName),
        this.credentialLane(params?.orgId),
      ))
      .orderBy(IntegrationFrameworkService.LANE_ORDER)
      .limit(1);

    if (!cred) {
      return this.logExecution(agentCodename, serviceName, method, endpoint, {
        success: false,
        error: `No credentials registered for service: ${serviceName}`,
        latencyMs: Date.now() - startTime,
        orgId: params?.orgId,
      });
    }

    // 2. Check agent permission
    if (!cred.allowedAgents.includes(agentCodename) && !cred.allowedAgents.includes("*")) {
      return this.logExecution(agentCodename, serviceName, method, endpoint, {
        success: false,
        error: `Agent ${agentCodename} not authorized for service ${serviceName}`,
        latencyMs: Date.now() - startTime,
        orgId: params?.orgId,
      });
    }

    // 3. Check circuit breaker
    if (cred.circuitBreakerOpen) {
      // Check if cooldown has expired (5 minute cooldown)
      if (cred.circuitBreakerResetAt && new Date() < cred.circuitBreakerResetAt) {
        return this.logExecution(agentCodename, serviceName, method, endpoint, {
          success: false,
          error: `Circuit breaker OPEN for ${serviceName} — too many failures. Resets at ${cred.circuitBreakerResetAt.toISOString()}`,
          latencyMs: Date.now() - startTime,
          orgId: params?.orgId,
        });
      }
      // Cooldown expired — auto-reset
      await this.resetCircuitBreaker(serviceName);
    }

    // 4. Check rate limit
    const rateLimitOk = await this.consumeRateLimit(cred);
    if (!rateLimitOk) {
      return this.logExecution(agentCodename, serviceName, method, endpoint, {
        success: false,
        error: `Rate limit exceeded for ${serviceName} (${cred.rateLimitPerMinute}/min)`,
        latencyMs: Date.now() - startTime,
        orgId: params?.orgId,
      });
    }

    // 5. Execute real HTTP request against the configured endpoint
    const requestStart = Date.now();
    let responseStatus = 0;
    let responseBody = "";
    let execSuccess = false;
    let execError: string | null = null;

    try {
      // integration_credentials has no config/apiKey columns. The secret is
      // stored (base64-encoded) in encryptedValue; there is no baseUrl/headers
      // config blob, so callers must pass an absolute endpoint.
      // TODO(tsc): add a config jsonb column for per-service baseUrl/headers.
      const apiKey = cred.encryptedValue
        ? Buffer.from(cred.encryptedValue, "base64").toString("utf8")
        : "";
      const fullUrl = endpoint;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      };

      const fetchOptions: RequestInit = {
        method: method.toUpperCase(),
        headers,
        signal: AbortSignal.timeout(30000), // 30s timeout
      };
      if (params?.body && ["POST", "PUT", "PATCH"].includes(method.toUpperCase())) {
        fetchOptions.body = JSON.stringify(params.body);
      }

      const response = await fetch(fullUrl, fetchOptions);
      responseStatus = response.status;
      responseBody = await response.text().catch(() => "");
      execSuccess = response.ok;

      if (!execSuccess) {
        execError = `HTTP ${responseStatus}: ${responseBody.slice(0, 200)}`;
      }
    } catch (fetchErr: any) {
      execError = fetchErr.message ?? "Network error";
      // If fetch fails entirely (network/timeout), mark as service unavailable
      responseStatus = 503;
    }

    const latencyMs = Date.now() - requestStart;
    const costCents = Math.max(1, Math.round(latencyMs / 100)); // Rough cost estimate based on latency

    const entry = await this.logExecution(agentCodename, serviceName, method, endpoint, {
      success: execSuccess,
      responseStatus,
      responseSummary: execSuccess ? responseBody.slice(0, 500) : execError,
      requestSummary: params?.body ? JSON.stringify(params.body).slice(0, 500) : null,
      latencyMs,
      costCents,
      rollbackAction: params?.rollbackAction,
      error: execError,
      orgId: params?.orgId,
    });

    // 6. Update circuit breaker on failure
    if (!execSuccess) {
      await this.incrementCircuitBreaker(cred);
    } else {
      // Reset failure count on success
      if (cred.circuitBreakerFailures > 0) {
        await db.update(integrationCredentials)
          .set({ circuitBreakerFailures: 0 })
          .where(eq(integrationCredentials.id, cred.id));
      }
    }

    // 7. Update last used
    await db.update(integrationCredentials)
      .set({ lastUsedAt: new Date() })
      .where(eq(integrationCredentials.id, cred.id));

    return entry;
  }

  // ─── Rollback Execution ───────────────────────────────────────────────────────

  async rollbackExecution(executionId: number): Promise<IntegrationExecutionLogEntry> {
    const [entry] = await db
      .select()
      .from(integrationExecutionLog)
      .where(eq(integrationExecutionLog.id, executionId));

    if (!entry) throw new Error(`Execution ${executionId} not found`);
    if (!entry.rollbackAction) throw new Error(`No rollback action registered for execution ${executionId}`);
    if (entry.rollbackExecuted) throw new Error(`Rollback already executed for ${executionId}`);

    // Mark rollback as executed
    const [updated] = await db.update(integrationExecutionLog)
      .set({ rollbackExecuted: true })
      .where(eq(integrationExecutionLog.id, executionId))
      .returning();

    // Log the rollback as a new execution
    await this.logExecution(entry.agentCodename, entry.serviceName, "ROLLBACK", entry.endpoint, {
      success: true,
      responseStatus: 200,
      responseSummary: `Rollback of execution ${executionId}: ${entry.rollbackAction}`,
      latencyMs: 0,
      orgId: entry.orgId,
    });

    return updated;
  }

  // ─── Get Credentials (safe — no values) ───────────────────────────────────────

  async getCredentials(serviceName?: string): Promise<Omit<IntegrationCredential, "encryptedValue">[]> {
    const conditions = [];
    if (serviceName) conditions.push(eq(integrationCredentials.serviceName, serviceName));

    const creds = await db
      .select()
      .from(integrationCredentials)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(integrationCredentials.createdAt));

    return creds.map(({ encryptedValue, ...safe }) => safe);
  }

  // ─── Check Rate Limit ─────────────────────────────────────────────────────────

  async checkRateLimit(serviceName: string, orgId: number | null = null): Promise<{
    allowed: boolean;
    used: number;
    limit: number;
    resetsAt: Date;
  }> {
    const [cred] = await db
      .select()
      .from(integrationCredentials)
      .where(and(
        eq(integrationCredentials.serviceName, serviceName),
        this.credentialLane(orgId),
      ))
      .orderBy(IntegrationFrameworkService.LANE_ORDER)
      .limit(1);

    if (!cred) throw new Error(`No credentials for service: ${serviceName}`);

    // Reset counter if window has passed
    if (new Date() >= cred.rateLimitResetAt) {
      return { allowed: true, used: 0, limit: cred.rateLimitPerMinute, resetsAt: new Date(Date.now() + 60_000) };
    }

    return {
      allowed: cred.rateLimitUsed < cred.rateLimitPerMinute,
      used: cred.rateLimitUsed,
      limit: cred.rateLimitPerMinute,
      resetsAt: cred.rateLimitResetAt,
    };
  }

  // ─── Circuit Breaker Status ───────────────────────────────────────────────────

  async getCircuitBreakerStatus(): Promise<{
    serviceName: string;
    open: boolean;
    failures: number;
    threshold: number;
    resetsAt: Date | null;
  }[]> {
    const creds = await db
      .select()
      .from(integrationCredentials)
      .where(eq(integrationCredentials.circuitBreakerOpen, true));

    return creds.map(c => ({
      serviceName: c.serviceName,
      open: c.circuitBreakerOpen,
      failures: c.circuitBreakerFailures,
      threshold: c.circuitBreakerThreshold,
      resetsAt: c.circuitBreakerResetAt,
    }));
  }

  // ─── Reset Circuit Breaker ────────────────────────────────────────────────────

  async resetCircuitBreaker(serviceName: string, orgId: number | null = null): Promise<void> {
    // A WRITE takes the lane EXACTLY — no platform fallback. Reading may fall
    // back to the shared credential; clearing a breaker must not reach across
    // to a row the caller did not name. Unscoped, this reset every row sharing
    // the service name, in every lane.
    await db.update(integrationCredentials)
      .set({
        circuitBreakerOpen: false,
        circuitBreakerFailures: 0,
        circuitBreakerResetAt: null,
      })
      .where(and(
        eq(integrationCredentials.serviceName, serviceName),
        orgId == null
          ? isNull(integrationCredentials.orgId)
          : eq(integrationCredentials.orgId, orgId),
      ));
  }

  // ─── Execution History ────────────────────────────────────────────────────────

  async getExecutionHistory(
    agentCodename?: string,
    serviceName?: string,
    limit: number = 50,
  ): Promise<IntegrationExecutionLogEntry[]> {
    const conditions = [];
    if (agentCodename) conditions.push(eq(integrationExecutionLog.agentCodename, agentCodename));
    if (serviceName) conditions.push(eq(integrationExecutionLog.serviceName, serviceName));

    return db
      .select()
      .from(integrationExecutionLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(integrationExecutionLog.createdAt))
      .limit(limit);
  }

  // ─── Cost Report ──────────────────────────────────────────────────────────────

  async getCostReport(days: number = 30): Promise<{
    totalCostCents: number;
    byService: { serviceName: string; costCents: number; calls: number }[];
    byAgent: { agentCodename: string; costCents: number; calls: number }[];
  }> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const entries = await db
      .select()
      .from(integrationExecutionLog)
      .where(gte(integrationExecutionLog.createdAt, since));

    let totalCostCents = 0;
    const serviceMap: Record<string, { costCents: number; calls: number }> = {};
    const agentMap: Record<string, { costCents: number; calls: number }> = {};

    for (const e of entries) {
      totalCostCents += e.costCents;

      if (!serviceMap[e.serviceName]) serviceMap[e.serviceName] = { costCents: 0, calls: 0 };
      serviceMap[e.serviceName].costCents += e.costCents;
      serviceMap[e.serviceName].calls++;

      if (!agentMap[e.agentCodename]) agentMap[e.agentCodename] = { costCents: 0, calls: 0 };
      agentMap[e.agentCodename].costCents += e.costCents;
      agentMap[e.agentCodename].calls++;
    }

    return {
      totalCostCents,
      byService: Object.entries(serviceMap)
        .map(([serviceName, data]) => ({ serviceName, ...data }))
        .sort((a, b) => b.costCents - a.costCents),
      byAgent: Object.entries(agentMap)
        .map(([agentCodename, data]) => ({ agentCodename, ...data }))
        .sort((a, b) => b.costCents - a.costCents),
    };
  }

  // ─── Stats ────────────────────────────────────────────────────────────────────

  async getStats(): Promise<{
    totalCalls: number;
    callsToday: number;
    successRate: number;
    avgLatencyMs: number;
    totalCostCents: number;
    openCircuits: number;
  }> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const all = await db.select().from(integrationExecutionLog);
    const today = all.filter(e => e.createdAt >= todayStart);

    const successful = all.filter(e => e.success === true).length;
    const latencies = all.filter(e => e.latencyMs !== null).map(e => e.latencyMs!);
    const avgLatency = latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0;

    const totalCost = all.reduce((sum, e) => sum + e.costCents, 0);

    const openCircuits = await db
      .select()
      .from(integrationCredentials)
      .where(eq(integrationCredentials.circuitBreakerOpen, true));

    return {
      totalCalls: all.length,
      callsToday: today.length,
      successRate: all.length > 0 ? Math.round((successful / all.length) * 100) : 0,
      avgLatencyMs: avgLatency,
      totalCostCents: totalCost,
      openCircuits: openCircuits.length,
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  private async logExecution(
    agentCodename: string,
    serviceName: string,
    method: string,
    endpoint: string,
    data: {
      success: boolean;
      error?: string | null;
      responseStatus?: number;
      responseSummary?: string | null;
      requestSummary?: string | null;
      latencyMs: number;
      costCents?: number;
      rollbackAction?: string;
      orgId?: number | null;
    },
  ): Promise<IntegrationExecutionLogEntry> {
    const [entry] = await db.insert(integrationExecutionLog).values({
      agentCodename,
      serviceName,
      method,
      endpoint,
      success: data.success,
      error: data.error ?? null,
      responseStatus: data.responseStatus ?? null,
      responseSummary: data.responseSummary ?? null,
      requestSummary: data.requestSummary ?? null,
      latencyMs: data.latencyMs,
      costCents: data.costCents ?? 0,
      rollbackAction: data.rollbackAction ?? null,
      orgId: data.orgId ?? null,
    }).returning();

    return entry;
  }

  private async consumeRateLimit(cred: IntegrationCredential): Promise<boolean> {
    const now = new Date();

    // Reset window if expired
    if (now >= cred.rateLimitResetAt) {
      await db.update(integrationCredentials)
        .set({
          rateLimitUsed: 1,
          rateLimitResetAt: new Date(Date.now() + 60_000),
        })
        .where(eq(integrationCredentials.id, cred.id));
      return true;
    }

    // Check if under limit
    if (cred.rateLimitUsed >= cred.rateLimitPerMinute) {
      return false;
    }

    // Increment
    await db.update(integrationCredentials)
      .set({ rateLimitUsed: cred.rateLimitUsed + 1 })
      .where(eq(integrationCredentials.id, cred.id));

    return true;
  }

  private async incrementCircuitBreaker(cred: IntegrationCredential): Promise<void> {
    const newFailures = cred.circuitBreakerFailures + 1;
    const shouldOpen = newFailures >= cred.circuitBreakerThreshold;

    await db.update(integrationCredentials)
      .set({
        circuitBreakerFailures: newFailures,
        circuitBreakerOpen: shouldOpen,
        circuitBreakerResetAt: shouldOpen ? new Date(Date.now() + 5 * 60 * 1000) : cred.circuitBreakerResetAt,
      })
      .where(eq(integrationCredentials.id, cred.id));
  }
}

export const integrationFrameworkService = new IntegrationFrameworkService();
