/**
 * /founder/studio API — every founder-tunable dial.
 *
 * Backs the /founder/studio UI. The UI is a generic dial-rendering engine
 * over `founder_settings`: this API just exposes the catalog + change
 * operations. New keys added to settingsSeeder.ts auto-appear in the
 * studio with no UI changes needed.
 *
 * Endpoints (all founder-only):
 *   GET    /api/founder/studio/dials           — every global-scope key, grouped by category
 *   GET    /api/founder/studio/dial/:key       — read one key (with overrides at deeper scopes)
 *   PATCH  /api/founder/studio/dial            — set value at given scope
 *   POST   /api/founder/studio/dial/reset      — reset to default (or delete override)
 *   GET    /api/founder/studio/audit           — recent founder_audit rows, filterable
 */

import type { Express, Request, Response } from "express";
import { db } from "./db";
import { platformSettings, founderAudit } from "@shared/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { isAuthenticated, requireFounder } from "./auth/clerkAuth";
import { getSettingRow, setSetting, resetSetting } from "./services/settings";

export function registerFounderStudioRoutes(app: Express) {
  // GET /api/founder/studio/dials — full catalog at global scope, grouped by category.
  // The UI uses category to render tabs; each dial includes the validRange so the
  // generic input renderer can pick number/enum/boolean/json editor.
  app.get(
    "/api/founder/studio/dials",
    isAuthenticated,
    requireFounder,
    async (_req: Request, res: Response) => {
      const rows = await db
        .select()
        .from(platformSettings)
        .where(and(eq(platformSettings.scope, "global"), isNull(platformSettings.scopeRef)))
        .orderBy(platformSettings.category, platformSettings.key);

      const grouped: Record<string, typeof rows> = {};
      for (const row of rows) {
        if (!grouped[row.category]) grouped[row.category] = [];
        grouped[row.category].push(row);
      }

      res.json({
        categories: Object.entries(grouped).map(([category, dials]) => ({
          category,
          dials,
        })),
      });
    },
  );

  // GET /api/founder/studio/dial/:key — one key + all narrower-scope overrides
  // (e.g. per-agent or per-skill rows). Used by the dial-detail panel.
  app.get(
    "/api/founder/studio/dial/:key",
    isAuthenticated,
    requireFounder,
    async (req: Request, res: Response) => {
      const key = req.params.key;
      const globalRow = await getSettingRow(key, { scope: "global", scopeRef: null });
      if (!globalRow) {
        return res.status(404).json({ error: `unknown key '${key}'` });
      }
      const allRows = await db
        .select()
        .from(platformSettings)
        .where(eq(platformSettings.key, key));
      const overrides = allRows.filter(
        (r) => !(r.scope === "global" && r.scopeRef === null),
      );
      res.json({ global: globalRow, overrides });
    },
  );

  // PATCH /api/founder/studio/dial — set value (may create override row at non-global scope)
  app.patch(
    "/api/founder/studio/dial",
    isAuthenticated,
    requireFounder,
    async (req: Request, res: Response) => {
      const body = req.body as {
        key: string;
        value: unknown;
        scope?: "global" | "org" | "agent" | "skill";
        scopeRef?: string | null;
        note?: string;
      };
      if (!body.key) return res.status(400).json({ error: "key required" });
      if (body.value === undefined) return res.status(400).json({ error: "value required" });

      const founderEmail = (req as any).user?.email as string | undefined;
      try {
        const row = await setSetting({
          key: body.key,
          value: body.value,
          founderId: founderEmail ?? "founder",
          note: body.note,
          scope: { scope: body.scope ?? "global", scopeRef: body.scopeRef ?? null },
        });
        res.json({ dial: row });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: message });
      }
    },
  );

  // POST /api/founder/studio/dial/reset — clear override or restore default
  app.post(
    "/api/founder/studio/dial/reset",
    isAuthenticated,
    requireFounder,
    async (req: Request, res: Response) => {
      const body = req.body as {
        key: string;
        scope?: "global" | "org" | "agent" | "skill";
        scopeRef?: string | null;
      };
      if (!body.key) return res.status(400).json({ error: "key required" });

      const founderEmail = (req as any).user?.email as string | undefined;
      try {
        await resetSetting(body.key, founderEmail ?? "founder", {
          scope: body.scope ?? "global",
          scopeRef: body.scopeRef ?? null,
        });
        res.json({ ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: message });
      }
    },
  );

  // GET /api/founder/studio/audit — recent founder mutations. Filter by area.
  app.get(
    "/api/founder/studio/audit",
    isAuthenticated,
    requireFounder,
    async (req: Request, res: Response) => {
      const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10), 500);
      const area = req.query.area ? String(req.query.area) : null;
      const rows = await db
        .select()
        .from(founderAudit)
        .where(area ? eq(founderAudit.area, area) : undefined)
        .orderBy(desc(founderAudit.createdAt))
        .limit(limit);
      res.json({ entries: rows });
    },
  );
}
