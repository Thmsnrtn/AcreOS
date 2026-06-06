/**
 * /api/tenant-theme — per-organization first-party theming (Tahoe E5).
 *
 * Distinct from /api/white-label (reseller/Kim tenants on custom domains).
 * These are org-level brand affordances every org can set from
 * Settings → Appearance and that TenantThemeProvider applies client-side as
 * CSS custom properties / data-attributes (never hardcoded colors):
 *
 *   - brandAccentColor — hex string ("#2563eb"); null = theme default
 *   - brandLogoUrl     — absolute URL shown in nav/topbar; null = AcreOS mark
 *   - brandDensity     — 'compact' | 'comfortable' | 'adaptive'; null = default
 *
 * GET   /api/tenant-theme   → current org theme (any member)
 * PATCH /api/tenant-theme   → merge partial update (admin/owner only)
 *
 * Reads are open to every org member (the provider needs them to render);
 * writes require admin-or-above since brand identity is org-wide.
 */

import { Router, type Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { organizations } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganization } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { requireAdminOrAbove } from "./utils/permissions";

const router = Router();

export interface TenantTheme {
  brandAccentColor: string | null;
  brandLogoUrl: string | null;
  brandDensity: "compact" | "comfortable" | "adaptive" | null;
}

// 6-digit hex with leading '#'. We deliberately reject 3-digit and 8-digit
// forms so the client's hex→HSL converter (which assumes 6 digits) never
// sees a value it would silently drop.
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const patchSchema = z
  .object({
    // `null` clears the override back to the theme default; a string sets it.
    brandAccentColor: z
      .union([z.string().regex(HEX_RE, "Expected a 6-digit hex color like #2563eb"), z.null()])
      .optional(),
    brandLogoUrl: z
      .union([z.string().url("Expected an absolute URL").max(2048), z.null()])
      .optional(),
    brandDensity: z
      .union([z.enum(["compact", "comfortable", "adaptive"]), z.null()])
      .optional(),
  })
  .strict();

function toTheme(row: {
  brandAccentColor: string | null;
  brandLogoUrl: string | null;
  brandDensity: string | null;
}): TenantTheme {
  return {
    brandAccentColor: row.brandAccentColor ?? null,
    brandLogoUrl: row.brandLogoUrl ?? null,
    brandDensity: (row.brandDensity as TenantTheme["brandDensity"]) ?? null,
  };
}

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const org = getOrganization(req);
    const [row] = await db
      .select({
        brandAccentColor: organizations.brandAccentColor,
        brandLogoUrl: organizations.brandLogoUrl,
        brandDensity: organizations.brandDensity,
      })
      .from(organizations)
      .where(eq(organizations.id, org.id))
      .limit(1);

    if (!row) return Errors.notFound(res, "Organization");
    res.json(toTheme(row));
  } catch (error) {
    Errors.internal(res, error);
  }
});

router.patch("/", requireAdminOrAbove(), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const org = getOrganization(req);

    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const update = parsed.data;
    if (Object.keys(update).length === 0) {
      return Errors.badRequest(res, "Empty tenant-theme update");
    }

    await db
      .update(organizations)
      .set({ ...update, updatedAt: new Date() })
      .where(eq(organizations.id, org.id));

    const [row] = await db
      .select({
        brandAccentColor: organizations.brandAccentColor,
        brandLogoUrl: organizations.brandLogoUrl,
        brandDensity: organizations.brandDensity,
      })
      .from(organizations)
      .where(eq(organizations.id, org.id))
      .limit(1);

    logger.info("Tenant theme updated", { organizationId: org.id, fields: Object.keys(update) });
    res.json(toTheme(row!));
  } catch (error) {
    Errors.internal(res, error);
  }
});

export default router;
