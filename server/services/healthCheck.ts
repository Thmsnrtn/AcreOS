// @ts-nocheck
/**
 * External Service Health Check System
 * 
 * Provides health checks for all external integrations to ensure
 * they're available before users attempt to use features that depend on them.
 */

export type ServiceStatus = 'healthy' | 'degraded' | 'unavailable' | 'unconfigured';

export interface ServiceHealth {
  name: string;
  status: ServiceStatus;
  latency?: number;
  message?: string;
  lastChecked: Date;
}

export interface HealthCheckResult {
  overall: ServiceStatus;
  services: ServiceHealth[];
  timestamp: Date;
}

class HealthCheckService {
  private lastResults: Map<string, ServiceHealth> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;

  /**
   * Check if Stripe is configured and accessible
   */
  async checkStripe(): Promise<ServiceHealth> {
    const name = 'stripe';
    const start = Date.now();
    
    try {
      const stripeKey = process.env.STRIPE_SECRET_KEY;
      if (!stripeKey) {
        return this.createHealth(name, 'unconfigured', undefined, 'STRIPE_SECRET_KEY not configured');
      }

      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(stripeKey);
      
      await stripe.balance.retrieve();
      const latency = Date.now() - start;
      
      return this.createHealth(name, 'healthy', latency);
    } catch (error: any) {
      const latency = Date.now() - start;
      if (error.type === 'StripeAuthenticationError') {
        return this.createHealth(name, 'unavailable', latency, 'Invalid API key');
      }
      if (error.type === 'StripeConnectionError') {
        return this.createHealth(name, 'unavailable', latency, 'Connection failed');
      }
      return this.createHealth(name, 'degraded', latency, error.message);
    }
  }

  /**
   * Check if OpenAI is configured and accessible
   */
  async checkOpenAI(): Promise<ServiceHealth> {
    const name = 'openai';
    const start = Date.now();
    
    try {
      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        return this.createHealth(name, 'unconfigured', undefined, 'OPENAI_API_KEY not configured');
      }

      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey: openaiKey });
      
      await openai.models.list();
      const latency = Date.now() - start;
      
      return this.createHealth(name, 'healthy', latency);
    } catch (error: any) {
      const latency = Date.now() - start;
      if (error.status === 401) {
        return this.createHealth(name, 'unavailable', latency, 'Invalid API key');
      }
      if (error.status === 429) {
        return this.createHealth(name, 'degraded', latency, 'Rate limited');
      }
      return this.createHealth(name, 'degraded', latency, error.message);
    }
  }

  /**
   * Check if Twilio is configured (BYOK via organization integrations)
   * Since Twilio is BYOK, we just check if credentials exist for any org
   */
  async checkTwilio(): Promise<ServiceHealth> {
    const name = 'twilio';
    
    try {
      const { db } = await import('../db');
      const { organizationIntegrations } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      
      const integrations = await db.select()
        .from(organizationIntegrations)
        .where(eq(organizationIntegrations.provider, 'twilio'))
        .limit(1);
      
      if (integrations.length === 0) {
        return this.createHealth(name, 'unconfigured', undefined, 'No Twilio integrations configured');
      }
      
      return this.createHealth(name, 'healthy', undefined, 'BYOK integration available');
    } catch (error: any) {
      return this.createHealth(name, 'degraded', undefined, error.message);
    }
  }

  /**
   * Check if SendGrid is configured
   */
  async checkSendGrid(): Promise<ServiceHealth> {
    const name = 'sendgrid';
    const start = Date.now();
    
    try {
      const sendgridKey = process.env.SENDGRID_API_KEY;
      if (!sendgridKey) {
        return this.createHealth(name, 'unconfigured', undefined, 'SENDGRID_API_KEY not configured');
      }

      const response = await fetch('https://api.sendgrid.com/v3/user/profile', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${sendgridKey}`,
          'Content-Type': 'application/json',
        },
      });
      
      const latency = Date.now() - start;
      
      if (response.ok) {
        return this.createHealth(name, 'healthy', latency);
      } else if (response.status === 401) {
        return this.createHealth(name, 'unavailable', latency, 'Invalid API key');
      } else {
        return this.createHealth(name, 'degraded', latency, `HTTP ${response.status}`);
      }
    } catch (error: any) {
      const latency = Date.now() - start;
      return this.createHealth(name, 'degraded', latency, error.message);
    }
  }

  /**
   * Check if Lob is configured and accessible
   */
  async checkLob(): Promise<ServiceHealth> {
    const name = 'lob';
    const start = Date.now();
    
    try {
      const lobKey = process.env.LOB_LIVE_API_KEY || process.env.LOB_TEST_API_KEY;
      if (!lobKey) {
        return this.createHealth(name, 'unconfigured', undefined, 'LOB_LIVE_API_KEY or LOB_TEST_API_KEY not configured');
      }

      const response = await fetch('https://api.lob.com/v1/addresses', {
        method: 'GET',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(lobKey + ':').toString('base64'),
          'Content-Type': 'application/json',
        },
      });
      
      const latency = Date.now() - start;
      
      if (response.ok) {
        return this.createHealth(name, 'healthy', latency);
      } else if (response.status === 401) {
        return this.createHealth(name, 'unavailable', latency, 'Invalid API key');
      } else {
        return this.createHealth(name, 'degraded', latency, `HTTP ${response.status}`);
      }
    } catch (error: any) {
      const latency = Date.now() - start;
      return this.createHealth(name, 'degraded', latency, error.message);
    }
  }

  /**
   * Check database connectivity
   */
  async checkDatabase(): Promise<ServiceHealth> {
    const name = 'database';
    const start = Date.now();
    
    try {
      const { db } = await import('../db');
      const { sql } = await import('drizzle-orm');
      
      await db.execute(sql`SELECT 1`);
      const latency = Date.now() - start;
      
      return this.createHealth(name, 'healthy', latency);
    } catch (error: any) {
      const latency = Date.now() - start;
      return this.createHealth(name, 'unavailable', latency, error.message);
    }
  }

  /**
   * Run all health checks
   */
  async checkAll(): Promise<HealthCheckResult> {
    const checks = await Promise.all([
      this.checkDatabase(),
      this.checkStripe(),
      this.checkOpenAI(),
      this.checkTwilio(),
      this.checkSendGrid(),
      this.checkLob(),
    ]);

    checks.forEach(check => {
      this.lastResults.set(check.name, check);
    });

    const overall = this.calculateOverallStatus(checks);

    return {
      overall,
      services: checks,
      timestamp: new Date(),
    };
  }

  /**
   * Check a specific service
   */
  async checkService(serviceName: string): Promise<ServiceHealth | null> {
    switch (serviceName.toLowerCase()) {
      case 'database':
        return this.checkDatabase();
      case 'stripe':
        return this.checkStripe();
      case 'openai':
        return this.checkOpenAI();
      case 'twilio':
        return this.checkTwilio();
      case 'sendgrid':
        return this.checkSendGrid();
      case 'lob':
        return this.checkLob();
      default:
        return null;
    }
  }

  /**
   * Get last cached results
   */
  getLastResults(): HealthCheckResult | null {
    if (this.lastResults.size === 0) return null;
    
    const services = Array.from(this.lastResults.values());
    return {
      overall: this.calculateOverallStatus(services),
      services,
      timestamp: new Date(),
    };
  }

  /**
   * Check if a service is available for use
   */
  isServiceAvailable(serviceName: string): boolean {
    const health = this.lastResults.get(serviceName.toLowerCase());
    if (!health) return true;
    return health.status === 'healthy' || health.status === 'degraded';
  }

  /**
   * Get user-friendly message for unavailable service
   */
  getServiceUnavailableMessage(serviceName: string): string {
    const health = this.lastResults.get(serviceName.toLowerCase());
    if (!health) return `${serviceName} service is currently unavailable`;
    
    if (health.status === 'unconfigured') {
      return `${serviceName} is not configured. Please contact your administrator.`;
    }
    if (health.status === 'unavailable') {
      return `${serviceName} is currently unavailable: ${health.message || 'Unknown error'}`;
    }
    return `${serviceName} service is experiencing issues: ${health.message || 'Unknown error'}`;
  }

  private createHealth(
    name: string, 
    status: ServiceStatus, 
    latency?: number, 
    message?: string
  ): ServiceHealth {
    return {
      name,
      status,
      latency,
      message,
      lastChecked: new Date(),
    };
  }

  private calculateOverallStatus(services: ServiceHealth[]): ServiceStatus {
    const criticalServices = ['database'];
    const hasCriticalFailure = services.some(
      s => criticalServices.includes(s.name) && s.status === 'unavailable'
    );
    
    if (hasCriticalFailure) return 'unavailable';
    
    const hasUnavailable = services.some(s => s.status === 'unavailable');
    const hasDegraded = services.some(s => s.status === 'degraded');
    
    if (hasUnavailable) return 'degraded';
    if (hasDegraded) return 'degraded';
    
    return 'healthy';
  }

  /**
   * Start periodic health checks
   */
  startPeriodicChecks(intervalMs: number = 60000): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    
    this.checkAll();
    
    this.checkInterval = setInterval(() => {
      this.checkAll().catch(err => {
        console.error('[healthCheck] Periodic health check failed:', err);
      });
    }, intervalMs);
    
    console.log(`[healthCheck] Started periodic health checks (every ${intervalMs / 1000}s)`);
  }

  /**
   * Stop periodic health checks
   */
  stopPeriodicChecks(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('[healthCheck] Stopped periodic health checks');
    }
  }
}

export const healthCheckService = new HealthCheckService();
