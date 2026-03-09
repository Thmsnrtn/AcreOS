/**
 * Territory Assignment & Routing Service (T53)
 *
 * Defines geographic territories (by state/county/zip combinations)
 * assigned to specific team members. When leads are imported or created,
 * they are auto-routed to the team member whose territory matches.
 *
 * Territory storage: uses organizationIntegrations with provider='territories'
 * (JSON blob) since territory management doesn't warrant a full DB table yet.
 * Easy to migrate to a proper table when needed.
 */

import { db } from "../db";
import { organizationIntegrations, teamMembers, leads } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export interface Territory {
  id: string;
  teamMemberId: string; // references teamMembers.userId
  teamMemberName?: string;
  name: string;
  /** Match criteria — at least one must be non-empty */
  states: string[];        // e.g. ["TX", "NM"]
  counties: string[];      // e.g. ["Bandera County", "Kerr County"]
  zipCodes: string[];      // e.g. ["78006", "78028"]
  priority: number;        // lower = higher priority when multiple territories match
  isActive: boolean;
}

async function getTerritoriesStore(organizationId: number): Promise<Territory[]> {
  const [integration] = await db
    .select()
    .from(organizationIntegrations)
    .where(
      and(
        eq(organizationIntegrations.organizationId, organizationId),
        eq(organizationIntegrations.provider, 'territories')
      )
    )
    .limit(1);

  if (!integration?.credentials) return [];
  const creds = integration.credentials as any;
  return Array.isArray(creds.territories) ? creds.territories : [];
}

async function saveTerritoriesStore(
  organizationId: number,
  territories: Territory[]
): Promise<void> {
  const [existing] = await db
    .select()
    .from(organizationIntegrations)
    .where(
      and(
        eq(organizationIntegrations.organizationId, organizationId),
        eq(organizationIntegrations.provider, 'territories')
      )
    )
    .limit(1);

  const credentials = { territories };

  if (existing) {
    await db
      .update(organizationIntegrations)
      .set({ credentials, updatedAt: new Date() })
      .where(eq(organizationIntegrations.id, existing.id));
  } else {
    await db.insert(organizationIntegrations).values({
      organizationId,
      provider: 'territories',
      isEnabled: true,
      credentials,
    });
  }
}

export async function getTerritories(organizationId: number): Promise<Territory[]> {
  const territories = await getTerritoriesStore(organizationId);
  return territories.sort((a, b) => a.priority - b.priority);
}

export async function upsertTerritory(
  organizationId: number,
  territory: Territory
): Promise<Territory[]> {
  const territories = await getTerritoriesStore(organizationId);
  const idx = territories.findIndex(t => t.id === territory.id);
  if (idx >= 0) {
    territories[idx] = territory;
  } else {
    territories.push(territory);
  }
  await saveTerritoriesStore(organizationId, territories);
  return territories;
}

export async function deleteTerritory(
  organizationId: number,
  territoryId: string
): Promise<boolean> {
  const territories = await getTerritoriesStore(organizationId);
  const filtered = territories.filter(t => t.id !== territoryId);
  if (filtered.length === territories.length) return false;
  await saveTerritoriesStore(organizationId, filtered);
  return true;
}

/**
 * Find the best matching territory for a lead's location.
 * Matching priority: zip code > county > state
 */
export function matchTerritory(
  territories: Territory[],
  leadState?: string | null,
  leadCounty?: string | null,
  leadZip?: string | null
): Territory | null {
  const active = territories.filter(t => t.isActive);

  // Check zip first (most specific)
  if (leadZip) {
    const cleanZip = leadZip.trim().slice(0, 5);
    const zipMatch = active.find(t => t.zipCodes.includes(cleanZip));
    if (zipMatch) return zipMatch;
  }

  // Then county
  if (leadCounty) {
    const cleanCounty = leadCounty.toLowerCase().replace(/ county$/i, '').trim();
    const countyMatch = active.find(t =>
      t.counties.some(c => c.toLowerCase().replace(/ county$/i, '').trim() === cleanCounty)
    );
    if (countyMatch) return countyMatch;
  }

  // Then state
  if (leadState) {
    const cleanState = leadState.toUpperCase().trim();
    const stateMatch = active.find(t =>
      t.states.some(s => s.toUpperCase() === cleanState)
    );
    if (stateMatch) return stateMatch;
  }

  return null;
}

/**
 * Auto-assign a lead to the matching territory owner.
 * Returns the assigned teamMemberId, or null if no match.
 */
export async function autoAssignLeadToTerritory(
  organizationId: number,
  leadId: number,
  leadState?: string | null,
  leadCounty?: string | null,
  leadZip?: string | null
): Promise<string | null> {
  const territories = await getTerritories(organizationId);
  const matched = matchTerritory(territories, leadState, leadCounty, leadZip);
  if (!matched) return null;

  // Update the lead's assignedTo field
  await db
    .update(leads)
    .set({ assignedTo: matched.teamMemberId, updatedAt: new Date() })
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)));

  console.log(`[Territory] Lead ${leadId} auto-assigned to ${matched.teamMemberName || matched.teamMemberId} via territory "${matched.name}"`);
  return matched.teamMemberId;
}

/**
 * Get territory statistics: lead count and deal count per territory.
 */
export async function getTerritoryStats(
  organizationId: number
): Promise<Array<Territory & { leadCount: number }>> {
  const territories = await getTerritories(organizationId);
  const allLeads = await db
    .select({ assignedTo: leads.assignedTo })
    .from(leads)
    .where(eq(leads.organizationId, organizationId));

  const countByMember: Record<string, number> = {};
  for (const l of allLeads) {
    if (l.assignedTo) {
      countByMember[l.assignedTo] = (countByMember[l.assignedTo] || 0) + 1;
    }
  }

  return territories.map(t => ({
    ...t,
    leadCount: countByMember[t.teamMemberId] || 0,
  }));
}
