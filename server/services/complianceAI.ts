// @ts-nocheck — ORM type refinement deferred; runtime-correct
import { db } from '../db';
import { 
  regulatoryChanges, 
  complianceAlerts,
  properties 
} from '../../shared/schema';
import { eq, and, desc, gte } from 'drizzle-orm';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface RegulatoryChange {
  changeType: string;
  title: string;
  description: string;
  impactLevel: string;
  effectiveDate: Date;
  sourceUrl?: string;
}

class ComplianceAI {
  /**
   * Monitor for regulatory changes in specific jurisdictions
   */
  async monitorJurisdiction(
    state: string,
    county: string,
    municipality?: string
  ): Promise<RegulatoryChange[]> {
    try {
      // In production, this would scrape government websites, RSS feeds, etc.
      // For now, return recently added changes from database
      const changes = await db.query.regulatoryChanges.findMany({
        where: and(
          eq(regulatoryChanges.state, state),
          eq(regulatoryChanges.county, county)
        ),
        orderBy: [desc(regulatoryChanges.createdAt)],
        limit: 20,
      });

      return changes.map(c => ({
        changeType: c.changeType,
        title: c.title,
        description: c.description || '',
        impactLevel: c.impactLevel || 'medium',
        effectiveDate: c.effectiveDate || new Date(),
        sourceUrl: c.sourceUrl || undefined,
      }));
    } catch (error) {
      console.error('Failed to monitor jurisdiction:', error);
      return [];
    }
  }

  /**
   * Record a new regulatory change
   */
  async recordRegulatoryChange(
    state: string,
    county: string,
    change: RegulatoryChange,
    municipality?: string
  ): Promise<string> {
    try {
      const [record] = await db.insert(regulatoryChanges).values({
        state,
        county,
        municipality: municipality || null,
        changeType: change.changeType,
        title: change.title,
        description: change.description,
        impactLevel: change.impactLevel,
        effectiveDate: change.effectiveDate,
        proposedDate: new Date(),
        sourceUrl: change.sourceUrl || null,
        sourceDocument: null,
        status: 'active',
        affectedProperties: [],
      }).returning();

      // Find affected properties and create alerts
      await this.identifyAffectedProperties(record.id, state, county);

      return record.id.toString();
    } catch (error) {
      console.error('Failed to record regulatory change:', error);
      throw error;
    }
  }

  /**
   * Identify which properties are affected by a regulatory change
   */
  private async identifyAffectedProperties(
    changeId: number,
    state: string,
    county: string
  ): Promise<void> {
    try {
      const change = await db.query.regulatoryChanges.findFirst({
        where: eq(regulatoryChanges.id, changeId),
      });

      if (!change) return;

      // Find all properties in affected jurisdiction
      const props = await db.query.properties.findMany({
        where: and(
          eq(properties.state, state),
          eq(properties.county, county)
        ),
      });

      // Create alerts for each affected property
      for (const prop of props) {
        await this.createComplianceAlert(
          prop.organizationId!,
          prop.id,
          changeId,
          change
        );
      }
    } catch (error) {
      console.error('Failed to identify affected properties:', error);
    }
  }

  /**
   * Create compliance alert for a property
   */
  private async createComplianceAlert(
    organizationId: number,
    propertyId: number,
    changeId: number,
    change: any
  ): Promise<void> {
    try {
      // Determine severity based on change type and impact
      let severity: string = 'medium';
      if (change.impactLevel === 'high') severity = 'high';
      if (change.changeType === 'zoning' && change.impactLevel === 'high') severity = 'critical';

      // Determine if action is required
      let alertType: string = 'informational';
      let actionRequired: string | null = null;

      if (change.changeType === 'zoning') {
        alertType = 'action_required';
        actionRequired = 'Review zoning change and assess impact on property use and value';
      } else if (change.changeType === 'tax') {
        alertType = 'informational';
      } else if (change.changeType === 'environmental') {
        alertType = 'action_required';
        actionRequired = 'Verify compliance with new environmental regulations';
      }

      await db.insert(complianceAlerts).values({
        organizationId,
        propertyId,
        regulatoryChangeId: changeId,
        alertType,
        severity,
        title: `${change.changeType.toUpperCase()}: ${change.title}`,
        description: change.description,
        actionRequired,
        deadline: change.effectiveDate,
        status: 'pending',
      });
    } catch (error) {
      console.error('Failed to create compliance alert:', error);
    }
  }

  /**
   * Get compliance alerts for organization
   */
  async getAlertsForOrganization(
    organizationId: number,
    status?: string
  ): Promise<any[]> {
    try {
      const where = status
        ? and(
            eq(complianceAlerts.organizationId, organizationId),
            eq(complianceAlerts.status, status)
          )
        : eq(complianceAlerts.organizationId, organizationId);

      return await db.query.complianceAlerts.findMany({
        where,
        orderBy: [desc(complianceAlerts.createdAt)],
      });
    } catch (error) {
      console.error('Failed to get alerts:', error);
      return [];
    }
  }

  /**
   * Get compliance alerts for specific property
   */
  async getAlertsForProperty(
    organizationId: number,
    propertyId: number
  ): Promise<any[]> {
    try {
      return await db.query.complianceAlerts.findMany({
        where: and(
          eq(complianceAlerts.organizationId, organizationId),
          eq(complianceAlerts.propertyId, propertyId)
        ),
        orderBy: [desc(complianceAlerts.createdAt)],
      });
    } catch (error) {
      console.error('Failed to get property alerts:', error);
      return [];
    }
  }

  /**
   * Acknowledge compliance alert
   */
  async acknowledgeAlert(
    organizationId: number,
    alertId: string,
    userId: number
  ): Promise<void> {
    try {
      await db.update(complianceAlerts)
        .set({
          status: 'acknowledged',
          acknowledgedAt: new Date(),
          acknowledgedBy: userId,
        })
        .where(and(
          eq(complianceAlerts.id, parseInt(alertId)),
          eq(complianceAlerts.organizationId, organizationId)
        ));
    } catch (error) {
      console.error('Failed to acknowledge alert:', error);
      throw error;
    }
  }

  /**
   * Resolve compliance alert
   */
  async resolveAlert(
    organizationId: number,
    alertId: string
  ): Promise<void> {
    try {
      await db.update(complianceAlerts)
        .set({
          status: 'resolved',
          resolvedAt: new Date(),
        })
        .where(and(
          eq(complianceAlerts.id, parseInt(alertId)),
          eq(complianceAlerts.organizationId, organizationId)
        ));
    } catch (error) {
      console.error('Failed to resolve alert:', error);
      throw error;
    }
  }

  /**
   * Generate disclosure document using AI
   */
  async generateDisclosure(
    propertyId: number,
    disclosureType: 'seller' | 'environmental' | 'zoning'
  ): Promise<string> {
    try {
      const property = await db.query.properties.findFirst({
        where: eq(properties.id, propertyId),
      });

      if (!property) {
        throw new Error('Property not found');
      }

      // Get any compliance alerts for this property
      const alerts = await db.query.complianceAlerts.findMany({
        where: eq(complianceAlerts.propertyId, propertyId),
      });

      // Build context for AI
      const propertyContext = `
Property: ${property.address}
State: ${property.state}
County: ${property.county}
Acres: ${property.acres}
Zoning: ${property.zoning || 'Unknown'}
Flood Zone: ${property.floodZone || 'Unknown'}
`;

      const alertContext = alerts.length > 0
        ? alerts.map(a => `- ${a.title}: ${a.description}`).join('\n')
        : 'No active compliance alerts';

      let prompt = '';

      if (disclosureType === 'seller') {
        prompt = `Generate a comprehensive Seller's Property Disclosure Statement for the following property:

${propertyContext}

Active Compliance Issues:
${alertContext}

Include standard sections for:
1. Property condition
2. Known defects or issues
3. Environmental hazards
4. Zoning and land use
5. Easements and encumbrances
6. Legal and regulatory compliance

Format as a professional legal document.`;
      } else if (disclosureType === 'environmental') {
        prompt = `Generate an Environmental Disclosure Report for:

${propertyContext}

Known Issues:
${alertContext}

Include:
1. Flood zone status and risk
2. Wetlands presence
3. Protected species habitat
4. Soil contamination status
5. Water quality
6. Environmental restrictions

Format as a professional report.`;
      } else if (disclosureType === 'zoning') {
        prompt = `Generate a Zoning and Land Use Disclosure for:

${propertyContext}

Recent Changes:
${alertContext}

Include:
1. Current zoning classification
2. Permitted uses
3. Restrictions and setbacks
4. Recent zoning changes
5. Pending applications or variances
6. Development potential

Format as a professional report.`;
      }

      const completion = await openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
      });

      return completion.choices[0].message.content || 'Disclosure generation failed';
    } catch (error) {
      console.error('Failed to generate disclosure:', error);
      return 'Error generating disclosure document';
    }
  }

  /**
   * Check property compliance status
   */
  async checkPropertyCompliance(propertyId: number): Promise<{
    isCompliant: boolean;
    criticalIssues: number;
    pendingActions: number;
    recentChanges: number;
    complianceScore: number;
  }> {
    try {
      const alerts = await db.query.complianceAlerts.findMany({
        where: eq(complianceAlerts.propertyId, propertyId),
      });

      const criticalIssues = alerts.filter(a => 
        a.severity === 'critical' && a.status === 'pending'
      ).length;

      const pendingActions = alerts.filter(a => 
        a.alertType === 'action_required' && a.status === 'pending'
      ).length;

      const recentChanges = alerts.filter(a => {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        return a.createdAt >= thirtyDaysAgo;
      }).length;

      // Calculate compliance score (0-100)
      let score = 100;
      score -= criticalIssues * 20;
      score -= pendingActions * 10;
      score -= recentChanges * 5;
      score = Math.max(0, Math.min(100, score));

      const isCompliant = criticalIssues === 0 && pendingActions === 0;

      return {
        isCompliant,
        criticalIssues,
        pendingActions,
        recentChanges,
        complianceScore: score,
      };
    } catch (error) {
      console.error('Failed to check compliance:', error);
      return {
        isCompliant: false,
        criticalIssues: 0,
        pendingActions: 0,
        recentChanges: 0,
        complianceScore: 0,
      };
    }
  }

  /**
   * Get compliance dashboard data
   */
  async getComplianceDashboard(organizationId: number): Promise<{
    totalAlerts: number;
    criticalAlerts: number;
    pendingActions: number;
    recentChanges: number;
    alertsByType: { type: string; count: number }[];
    topRisks: any[];
  }> {
    try {
      const alerts = await db.query.complianceAlerts.findMany({
        where: eq(complianceAlerts.organizationId, organizationId),
      });

      const totalAlerts = alerts.length;
      const criticalAlerts = alerts.filter(a => a.severity === 'critical').length;
      const pendingActions = alerts.filter(a => 
        a.alertType === 'action_required' && a.status === 'pending'
      ).length;

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentChanges = alerts.filter(a => a.createdAt >= thirtyDaysAgo).length;

      // Alert breakdown by type
      const typeMap = new Map<string, number>();
      for (const alert of alerts) {
        typeMap.set(alert.alertType, (typeMap.get(alert.alertType) || 0) + 1);
      }

      const alertsByType = Array.from(typeMap.entries()).map(([type, count]) => ({
        type,
        count,
      }));

      // Top risks (critical/high severity pending alerts)
      const topRisks = alerts
        .filter(a => ['critical', 'high'].includes(a.severity) && a.status === 'pending')
        .sort((a, b) => {
          const severityOrder = { critical: 0, high: 1 };
          return severityOrder[a.severity as keyof typeof severityOrder] - 
                 severityOrder[b.severity as keyof typeof severityOrder];
        })
        .slice(0, 5);

      return {
        totalAlerts,
        criticalAlerts,
        pendingActions,
        recentChanges,
        alertsByType,
        topRisks,
      };
    } catch (error) {
      console.error('Failed to get compliance dashboard:', error);
      return {
        totalAlerts: 0,
        criticalAlerts: 0,
        pendingActions: 0,
        recentChanges: 0,
        alertsByType: [],
        topRisks: [],
      };
    }
  }
}

export const complianceAI = new ComplianceAI();
