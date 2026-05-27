// Team members + org co-owners.
// Extracted from the god-class server/storage.ts.

import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  teamMembers, orgCoOwners,
  type TeamMember, type InsertTeamMember,
  type OrgCoOwner, type InsertOrgCoOwner,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";

export const teamRepo = {
  // Team Members
  async getTeamMembers(this: DatabaseStorage, orgId: number): Promise<TeamMember[]> {
    return await db.select().from(teamMembers).where(eq(teamMembers.organizationId, orgId));
  },

  async getTeamMember(this: DatabaseStorage, orgId: number, userId: string): Promise<TeamMember | undefined> {
    const [member] = await db.select().from(teamMembers)
      .where(and(eq(teamMembers.organizationId, orgId), eq(teamMembers.userId, userId)));
    return member;
  },

  // Phase 4 Week 15-16 (Magdalena §1) — used by the lead-import worker to
  // resolve `assignedTo` CSV values (emails of team members) to team_member IDs.
  async getTeamMemberByEmail(this: DatabaseStorage, orgId: number, email: string): Promise<TeamMember | undefined> {
    const normalized = email.trim().toLowerCase();
    const [member] = await db.select().from(teamMembers)
      .where(and(eq(teamMembers.organizationId, orgId), eq(teamMembers.email, normalized)));
    return member;
  },

  async createTeamMember(this: DatabaseStorage, member: InsertTeamMember): Promise<TeamMember> {
    const [newMember] = await db.insert(teamMembers).values(member).returning();
    return newMember;
  },

  async updateTeamMember(this: DatabaseStorage, id: number, updates: Partial<InsertTeamMember>, organizationId?: number): Promise<TeamMember> {
    const conditions = [eq(teamMembers.id, id)];
    if (organizationId) conditions.push(eq(teamMembers.organizationId, organizationId));
    const [updated] = await db.update(teamMembers).set(updates).where(and(...conditions)).returning();
    return updated;
  },

  // ─── Org Co-Owners (Blanco §1) ──────────────────────────────────────────
  // Co-ownership is a billing/identity relation distinct from operational
  // role. Listing/adding/removing co-owners is owner-only at the route
  // layer; the storage helpers here are role-agnostic.
  async listOrgCoOwners(this: DatabaseStorage, orgId: number): Promise<OrgCoOwner[]> {
    return await db
      .select()
      .from(orgCoOwners)
      .where(eq(orgCoOwners.organizationId, orgId))
      .orderBy(asc(orgCoOwners.addedAt));
  },

  async addOrgCoOwner(this: DatabaseStorage, input: InsertOrgCoOwner): Promise<OrgCoOwner | undefined> {
    // Idempotent: the unique index on (org, user) means re-add is a no-op.
    const [row] = await db
      .insert(orgCoOwners)
      .values(input)
      .onConflictDoNothing()
      .returning();
    if (row) return row;
    const [existing] = await db
      .select()
      .from(orgCoOwners)
      .where(
        and(
          eq(orgCoOwners.organizationId, input.organizationId),
          eq(orgCoOwners.userId, input.userId),
        ),
      );
    return existing;
  },

  async removeOrgCoOwner(this: DatabaseStorage, orgId: number, userId: string): Promise<void> {
    await db
      .delete(orgCoOwners)
      .where(
        and(
          eq(orgCoOwners.organizationId, orgId),
          eq(orgCoOwners.userId, userId),
        ),
      );
  },
};

export type TeamRepo = typeof teamRepo;
