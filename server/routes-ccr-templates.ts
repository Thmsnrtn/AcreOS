/**
 * Subdivider vertical SD-8 — CC&R / covenant template library.
 *
 * Brigid §6: "A template engine with merge fields, period. […] No AI here,
 * please. I do not want a generative model writing CC&Rs that get recorded
 * in perpetuity against my buyers' titles."
 *
 *   GET    /api/ccr-templates                — org + global library
 *   GET    /api/ccr-templates/:id            — single
 *   POST   /api/ccr-templates                — create org-scoped
 *   PATCH  /api/ccr-templates/:id            — edit org-scoped
 *   DELETE /api/ccr-templates/:id            — delete org-scoped
 *   POST   /api/ccr-templates/:id/render     — render with merge values
 *
 * v1 is markdown-only (rendering to PDF + signer integration is the next
 * surface; this PR ships the template + merge-field engine so the
 * existing /documents + HMAC signer can pick up the rendered body).
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, isNull, or, asc, sql } from "drizzle-orm";
import { db } from "./db";
import { ccrTemplates, CCR_TEMPLATE_KINDS } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors, sendError } from "./utils/errors";
import { logger } from "./utils/logger";

const mergeFieldSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
  type: z.enum(["string", "number", "currency_cents", "date", "boolean"]),
  required: z.boolean(),
  placeholder: z.string().optional(),
});

const createSchema = z.object({
  kind: z.enum(CCR_TEMPLATE_KINDS),
  name: z.string().min(1).max(200),
  state: z.string().length(2).optional().nullable(),
  bodyMarkdown: z.string().min(1),
  mergeFields: z.array(mergeFieldSchema).default([]),
  notes: z.string().optional().nullable(),
});

const updateSchema = createSchema.partial();

const renderSchema = z.object({
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

/**
 * Substitute {{key}} occurrences with formatted values. Type-aware:
 *   - currency_cents: integer cents → "$1,234.56"
 *   - date: ISO → "Mon DD, YYYY"
 *   - number: comma-separated
 *   - boolean: "yes" / "no"
 *   - string: as-is
 *
 * Validation: all `required` merge fields must be present in `values`.
 */
function renderTemplate(
  body: string,
  fields: Array<{ key: string; type: string; required: boolean }>,
  values: Record<string, string | number | boolean>,
): { rendered: string; missing: string[] } {
  const missing: string[] = [];
  for (const f of fields) {
    if (f.required && (values[f.key] === undefined || values[f.key] === null || values[f.key] === "")) {
      missing.push(f.key);
    }
  }

  const fieldByKey = new Map(fields.map((f) => [f.key, f]));
  const out = body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, k: string) => {
    const v = values[k];
    if (v === undefined || v === null) return "";
    const f = fieldByKey.get(k);
    if (!f) return String(v);
    switch (f.type) {
      case "currency_cents": {
        const cents = Number(v);
        if (!Number.isFinite(cents)) return String(v);
        return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
      }
      case "date": {
        const d = new Date(String(v));
        if (Number.isNaN(d.getTime())) return String(v);
        return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      }
      case "number":
        return new Intl.NumberFormat("en-US").format(Number(v));
      case "boolean":
        return v ? "yes" : "no";
      default:
        return String(v);
    }
  });

  return { rendered: out, missing };
}

export function registerCcrTemplateRoutes(app: Express): void {
  // List — global templates (organization_id IS NULL) plus the org's own.
  app.get(
    "/api/ccr-templates",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const rows = await db
          .select({
            id: ccrTemplates.id,
            organizationId: ccrTemplates.organizationId,
            kind: ccrTemplates.kind,
            name: ccrTemplates.name,
            state: ccrTemplates.state,
            mergeFields: ccrTemplates.mergeFields,
            attorneyReviewedAt: ccrTemplates.attorneyReviewedAt,
            attorneyReviewedBy: ccrTemplates.attorneyReviewedBy,
            notes: ccrTemplates.notes,
            updatedAt: ccrTemplates.updatedAt,
          })
          .from(ccrTemplates)
          .where(or(isNull(ccrTemplates.organizationId), eq(ccrTemplates.organizationId, orgId)))
          .orderBy(asc(ccrTemplates.kind), asc(ccrTemplates.name));
        return res.json({ templates: rows });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // Single (with body markdown).
  app.get(
    "/api/ccr-templates/:id",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const [row] = await db
          .select()
          .from(ccrTemplates)
          .where(and(
            eq(ccrTemplates.id, req.params.id),
            or(isNull(ccrTemplates.organizationId), eq(ccrTemplates.organizationId, orgId)),
          ));
        if (!row) return Errors.notFound(res, "Template");
        return res.json({ template: row });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // Create — org-scoped.
  app.post(
    "/api/ccr-templates",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const userId = getUserId(req);
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

        const [row] = await db.insert(ccrTemplates).values({
          organizationId: orgId,
          kind: parsed.data.kind,
          name: parsed.data.name,
          state: parsed.data.state ?? null,
          bodyMarkdown: parsed.data.bodyMarkdown,
          mergeFields: parsed.data.mergeFields,
          notes: parsed.data.notes ?? null,
        }).returning();

        logger.info("[SD-8] CC&R template created", { orgId, userId, kind: parsed.data.kind });
        return res.status(201).json({ template: row });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // Update — only org-scoped templates.
  app.patch(
    "/api/ccr-templates/:id",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = updateSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (parsed.data.name !== undefined) updates.name = parsed.data.name;
        if (parsed.data.kind !== undefined) updates.kind = parsed.data.kind;
        if (parsed.data.state !== undefined) updates.state = parsed.data.state;
        if (parsed.data.bodyMarkdown !== undefined) updates.bodyMarkdown = parsed.data.bodyMarkdown;
        if (parsed.data.mergeFields !== undefined) updates.mergeFields = parsed.data.mergeFields;
        if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;

        const [row] = await db
          .update(ccrTemplates)
          .set(updates)
          .where(and(
            eq(ccrTemplates.id, req.params.id),
            eq(ccrTemplates.organizationId, orgId),
          ))
          .returning();
        if (!row) return Errors.notFound(res, "Template (or not editable — global templates are read-only)");
        return res.json({ template: row });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // Delete — only org-scoped.
  app.delete(
    "/api/ccr-templates/:id",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const [row] = await db
          .delete(ccrTemplates)
          .where(and(
            eq(ccrTemplates.id, req.params.id),
            eq(ccrTemplates.organizationId, orgId),
          ))
          .returning({ id: ccrTemplates.id });
        if (!row) return Errors.notFound(res, "Template");
        return res.json({ deleted: true, id: row.id });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // Render — substitute merge-field values into the markdown body.
  app.post(
    "/api/ccr-templates/:id/render",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = renderSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

        const [tpl] = await db
          .select()
          .from(ccrTemplates)
          .where(and(
            eq(ccrTemplates.id, req.params.id),
            or(isNull(ccrTemplates.organizationId), eq(ccrTemplates.organizationId, orgId)),
          ));
        if (!tpl) return Errors.notFound(res, "Template");

        const fields = (tpl.mergeFields as any) ?? [];
        const { rendered, missing } = renderTemplate(tpl.bodyMarkdown, fields, parsed.data.values);

        if (missing.length > 0) {
          return sendError(res, 422, "missing_required_fields", `Missing values for required fields: ${missing.join(", ")}`, { missing });
        }

        return res.json({
          templateId: tpl.id,
          name: tpl.name,
          kind: tpl.kind,
          rendered,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
