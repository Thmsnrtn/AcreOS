import type { Express } from "express";
import { db } from "./storage";
import { z } from "zod";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { sql } from "drizzle-orm";

const maintenanceSchema = z.object({
  propertyId: z.number().int().positive(),
  leaseId: z.number().int().positive().optional().nullable(),
  description: z.string().min(1, "Description required"),
  priority: z.enum(["low", "normal", "urgent", "emergency"]).default("normal"),
  status: z.enum(["open", "in_progress", "resolved"]).default("open"),
  cost: z.string().or(z.number()).optional().nullable().transform(v => v ? String(v) : null),
});

export function registerMaintenanceRoutes(app: Express): void {

  app.get("/api/maintenance", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const propertyId = req.query.propertyId ? Number(req.query.propertyId) : null;

      const whereClause = propertyId
        ? sql`WHERE organization_id = ${org.id} AND property_id = ${propertyId}`
        : sql`WHERE organization_id = ${org.id}`;

      const result = await db.execute(
        sql`SELECT * FROM maintenance_requests ${whereClause} ORDER BY created_at DESC`
      );
      res.json(result.rows || []);
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  app.get("/api/maintenance/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = Number(req.params.id);
      const result = await db.execute(
        sql`SELECT * FROM maintenance_requests WHERE id = ${id} AND organization_id = ${org.id} LIMIT 1`
      );
      if (!result.rows?.length) return Errors.notFound(res, "Maintenance request");
      res.json(result.rows[0]);
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  app.post("/api/maintenance", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = maintenanceSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.errors);

      const data = parsed.data;
      const result = await db.execute(sql`
        INSERT INTO maintenance_requests (organization_id, property_id, lease_id, description, priority, status, cost)
        VALUES (${org.id}, ${data.propertyId}, ${data.leaseId}, ${data.description}, ${data.priority}, ${data.status}, ${data.cost})
        RETURNING *
      `);
      res.status(201).json(result.rows?.[0] || {});
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  app.put("/api/maintenance/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = Number(req.params.id);
      const { status, cost, priority } = req.body;

      const updates: string[] = [];
      if (status) updates.push(`status = '${status}'`);
      if (cost !== undefined) updates.push(`cost = '${cost}'`);
      if (priority) updates.push(`priority = '${priority}'`);
      if (status === "resolved") updates.push(`resolved_at = NOW()`);

      if (updates.length === 0) return Errors.badRequest(res, "No fields to update");

      const result = await db.execute(sql`
        UPDATE maintenance_requests SET ${sql.raw(updates.join(", "))}
        WHERE id = ${id} AND organization_id = ${org.id}
        RETURNING *
      `);

      if (!result.rows?.length) return Errors.notFound(res, "Maintenance request");
      res.json(result.rows[0]);
    } catch (error) {
      Errors.internal(res, error);
    }
  });

  app.delete("/api/maintenance/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = Number(req.params.id);
      await db.execute(
        sql`DELETE FROM maintenance_requests WHERE id = ${id} AND organization_id = ${org.id}`
      );
      res.json({ success: true });
    } catch (error) {
      Errors.internal(res, error);
    }
  });
}
