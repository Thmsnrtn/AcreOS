import type { Express } from "express";
import { db } from "./storage";
import { z } from "zod";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { eq, and, sql } from "drizzle-orm";

// Lease schema for validation
const leaseSchema = z.object({
  propertyId: z.number().int().positive(),
  tenantName: z.string().min(1, "Tenant name required"),
  tenantEmail: z.string().email().optional().nullable(),
  tenantPhone: z.string().optional().nullable(),
  monthlyRent: z.string().or(z.number()).transform(String),
  securityDeposit: z.string().or(z.number()).optional().nullable().transform(v => v ? String(v) : null),
  leaseStart: z.string().min(1, "Lease start date required"),
  leaseEnd: z.string().min(1, "Lease end date required"),
  status: z.enum(["active", "expiring", "expired", "terminated"]).default("active"),
  terms: z.record(z.unknown()).optional().nullable(),
});

export function registerLeaseRoutes(app: Express): void {

  // GET all leases for org
  app.get("/api/leases", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      // Query leases table directly
      const result = await db.execute(
        sql`SELECT * FROM leases WHERE organization_id = ${org.id} ORDER BY created_at DESC`
      );
      res.json(result.rows || []);
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // GET leases for a specific property
  app.get("/api/properties/:propertyId/leases", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = Number(req.params.propertyId);
      const result = await db.execute(
        sql`SELECT * FROM leases WHERE organization_id = ${org.id} AND property_id = ${propertyId} ORDER BY lease_end DESC`
      );
      res.json(result.rows || []);
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // GET single lease
  app.get("/api/leases/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = Number(req.params.id);
      const result = await db.execute(
        sql`SELECT * FROM leases WHERE id = ${id} AND organization_id = ${org.id} LIMIT 1`
      );
      if (!result.rows?.length) return Errors.notFound(res, "Lease");
      res.json(result.rows[0]);
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // CREATE lease
  app.post("/api/leases", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = leaseSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.errors);

      const data = parsed.data;
      const result = await db.execute(sql`
        INSERT INTO leases (organization_id, property_id, tenant_name, tenant_email, tenant_phone,
          monthly_rent, security_deposit, lease_start, lease_end, status, terms)
        VALUES (${org.id}, ${data.propertyId}, ${data.tenantName}, ${data.tenantEmail},
          ${data.tenantPhone}, ${data.monthlyRent}, ${data.securityDeposit},
          ${data.leaseStart}, ${data.leaseEnd}, ${data.status}, ${JSON.stringify(data.terms || {})})
        RETURNING *
      `);
      res.status(201).json(result.rows?.[0] || {});
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // UPDATE lease
  app.put("/api/leases/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = Number(req.params.id);
      const parsed = leaseSchema.partial().safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.errors);

      const data = parsed.data;
      const sets: string[] = [];
      const vals: any[] = [];

      if (data.tenantName !== undefined) { sets.push("tenant_name"); vals.push(data.tenantName); }
      if (data.tenantEmail !== undefined) { sets.push("tenant_email"); vals.push(data.tenantEmail); }
      if (data.tenantPhone !== undefined) { sets.push("tenant_phone"); vals.push(data.tenantPhone); }
      if (data.monthlyRent !== undefined) { sets.push("monthly_rent"); vals.push(data.monthlyRent); }
      if (data.securityDeposit !== undefined) { sets.push("security_deposit"); vals.push(data.securityDeposit); }
      if (data.leaseStart !== undefined) { sets.push("lease_start"); vals.push(data.leaseStart); }
      if (data.leaseEnd !== undefined) { sets.push("lease_end"); vals.push(data.leaseEnd); }
      if (data.status !== undefined) { sets.push("status"); vals.push(data.status); }

      if (sets.length === 0) return Errors.badRequest(res, "No fields to update");

      const result = await db.execute(sql`
        UPDATE leases SET ${sql.raw(sets.map((s, i) => `${s} = $${i + 3}`).join(", "))}
        WHERE id = ${id} AND organization_id = ${org.id}
        RETURNING *
      `);

      if (!result.rows?.length) return Errors.notFound(res, "Lease");
      res.json(result.rows[0]);
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  // DELETE lease
  app.delete("/api/leases/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = Number(req.params.id);
      await db.execute(
        sql`DELETE FROM leases WHERE id = ${id} AND organization_id = ${org.id}`
      );
      res.json({ success: true });
    } catch (error) {
      Errors.internal(res, error);
    }
  });
}
