import { db } from "../db";
import { systemAlerts, organizations } from "@shared/schema";
import { eq, and, gte, desc, sql, notInArray } from "drizzle-orm";

interface ServiceStatus {
  name: string;
  status: "operational" | "degraded" | "outage" | "unknown";
  lastChecked: Date;
  latency?: number;
  message?: string;
}

const SERVICE_ENDPOINTS: Record<string, { url: string; name: string; type: "api" | "status" }> = {
  stripe: { url: "https://api.stripe.com/v1/charges?limit=1", name: "Stripe", type: "api" },
  openai: { url: "https://api.openai.com/v1/models", name: "OpenAI", type: "api" },
  twilio: { url: "https://api.twilio.com/2010-04-01", name: "Twilio", type: "api" },
  lob: { url: "https://api.lob.com/v1/addresses", name: "Lob", type: "api" },
  regrid: { url: "https://app.regrid.com/api/v2/parcels", name: "Regrid", type: "api" }
};

export const externalStatusMonitor = {
  cachedStatuses: new Map<string, ServiceStatus>(),
  lastFullCheck: 0,
  
  async checkServiceHealth(serviceName: string): Promise<ServiceStatus> {
    const config = SERVICE_ENDPOINTS[serviceName.toLowerCase()];
    if (!config) {
      return {
        name: serviceName,
        status: "unknown",
        lastChecked: new Date(),
        message: "Unknown service"
      };
    }
    
    const startTime = Date.now();
    
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const headers: Record<string, string> = {};
      
      if (serviceName === "stripe" && process.env.STRIPE_SECRET_KEY) {
        headers["Authorization"] = `Bearer ${process.env.STRIPE_SECRET_KEY}`;
      } else if (serviceName === "openai" && process.env.OPENAI_API_KEY) {
        headers["Authorization"] = `Bearer ${process.env.OPENAI_API_KEY}`;
      }
      
      const response = await fetch(config.url, {
        method: "GET",
        headers,
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      const latency = Date.now() - startTime;
      
      let status: ServiceStatus["status"] = "operational";
      if (response.status >= 500) {
        status = "outage";
      } else if (response.status >= 400 && response.status !== 401 && response.status !== 403) {
        status = "degraded";
      } else if (latency > 3000) {
        status = "degraded";
      }
      
      const result: ServiceStatus = {
        name: config.name,
        status,
        lastChecked: new Date(),
        latency,
        message: status === "operational" ? undefined : `HTTP ${response.status}, ${latency}ms latency`
      };
      
      this.cachedStatuses.set(serviceName, result);
      return result;
      
    } catch (error: any) {
      const result: ServiceStatus = {
        name: config.name,
        status: error.name === "AbortError" ? "degraded" : "outage",
        lastChecked: new Date(),
        message: error.name === "AbortError" ? "Request timeout (>5s)" : error.message
      };
      
      this.cachedStatuses.set(serviceName, result);
      return result;
    }
  },
  
  async checkAllServices(): Promise<Record<string, ServiceStatus>> {
    const results: Record<string, ServiceStatus> = {};
    
    const checks = Object.keys(SERVICE_ENDPOINTS).map(async (service) => {
      results[service] = await this.checkServiceHealth(service);
    });
    
    await Promise.all(checks);
    this.lastFullCheck = Date.now();
    
    return results;
  },
  
  async getServiceStatus(serviceName: string): Promise<ServiceStatus> {
    const cached = this.cachedStatuses.get(serviceName.toLowerCase());
    const cacheAge = cached ? Date.now() - cached.lastChecked.getTime() : Infinity;
    
    if (cached && cacheAge < 60000) {
      return cached;
    }
    
    return this.checkServiceHealth(serviceName.toLowerCase());
  },
  
  async getAllStatuses(): Promise<Record<string, ServiceStatus>> {
    if (Date.now() - this.lastFullCheck < 60000 && this.cachedStatuses.size > 0) {
      const results: Record<string, ServiceStatus> = {};
      this.cachedStatuses.forEach((status, key) => {
        results[key] = status;
      });
      return results;
    }
    
    return this.checkAllServices();
  },
  
  async detectOutages(): Promise<Array<{ service: string; status: ServiceStatus; impact: string }>> {
    const statuses = await this.getAllStatuses();
    const outages: Array<{ service: string; status: ServiceStatus; impact: string }> = [];
    
    const impactMap: Record<string, string> = {
      stripe: "Payment processing, subscription billing, and invoicing may be affected",
      openai: "AI features, document generation, and analysis tools may be unavailable",
      twilio: "SMS notifications and two-way messaging will not work",
      lob: "Direct mail campaigns cannot be sent",
      regrid: "Parcel boundary lookups and property data enrichment will fail"
    };
    
    for (const [service, status] of Object.entries(statuses)) {
      if (status.status === "outage" || status.status === "degraded") {
        outages.push({
          service,
          status,
          impact: impactMap[service] || `${status.name} functionality may be limited`
        });
      }
    }
    
    return outages;
  },
  
  async notifyUsersOfOutage(service: string, impact: string): Promise<number> {
    const status = await this.getServiceStatus(service);
    if (status.status === "operational") {
      return 0;
    }
    
    // Task #N+1 fix: Batch query to find which orgs already have a recent alert,
    // then bulk-insert only for orgs that don't, avoiding N+1 SELECT per org.
    const cutoff = new Date(Date.now() - 60 * 60 * 1000);
    const alreadyNotified = await db.select({ orgId: systemAlerts.organizationId })
      .from(systemAlerts)
      .where(and(
        eq(systemAlerts.type, `external_outage` as any),
        gte(systemAlerts.createdAt, cutoff)
      ));
    const alreadyNotifiedIds = alreadyNotified.map(r => r.orgId!);

    const orgQuery = alreadyNotifiedIds.length > 0
      ? db.select({ id: organizations.id }).from(organizations)
          .where(notInArray(organizations.id, alreadyNotifiedIds))
          .limit(1000)
      : db.select({ id: organizations.id }).from(organizations).limit(1000);
    const orgsToNotify = await orgQuery;

    if (orgsToNotify.length === 0) return 0;

    const alertValues = orgsToNotify.map(org => ({
      organizationId: org.id,
      type: "external_outage" as any,
      severity: status.status === "outage" ? "critical" : "warning",
      title: `${SERVICE_ENDPOINTS[service]?.name || service} Service Issue`,
      message: `We're aware of an issue with ${SERVICE_ENDPOINTS[service]?.name || service}. ${impact}. We're monitoring the situation and will update you when it's resolved.`,
      metadata: { service, status: status.status, message: status.message }
    }));
    await db.insert(systemAlerts).values(alertValues);
    return orgsToNotify.length;
  },
  
  async resolveOutageNotifications(service: string): Promise<number> {
    // Task #N+1 fix: Use a single bulk UPDATE with SQL filter instead of looping N individual UPDATEs
    const updated = await db.update(systemAlerts)
      .set({ resolvedAt: new Date(), status: "resolved" as any })
      .where(and(
        eq(systemAlerts.type, "external_outage" as any),
        sql`${systemAlerts.resolvedAt} IS NULL`,
        sql`${systemAlerts.metadata}->>'service' = ${service}`
      ))
      .returning({ id: systemAlerts.id });
    return updated.length;
  },
  
  startPeriodicMonitoring(intervalMs: number = 5 * 60 * 1000): void {
    setInterval(async () => {
      try {
        const outages = await this.detectOutages();
        
        for (const outage of outages) {
          if (outage.status.status === "outage") {
            await this.notifyUsersOfOutage(outage.service, outage.impact);
            console.log(`[external-status] Detected ${outage.service} outage, notifying users`);
          }
        }
        
        for (const service of Object.keys(SERVICE_ENDPOINTS)) {
          const status = await this.getServiceStatus(service);
          if (status.status === "operational") {
            await this.resolveOutageNotifications(service);
          }
        }
      } catch (error) {
        console.error("[external-status] Error in periodic monitoring:", error);
      }
    }, intervalMs);
    
    console.log(`[external-status] Started periodic monitoring (every ${intervalMs / 1000}s)`);
  }
};
