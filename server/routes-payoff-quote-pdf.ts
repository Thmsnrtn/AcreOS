/**
 * Payoff-quote PDF artifact — the served document.
 *
 *   GET /api/note-payoff-quotes/:quoteId/pdf   — render one RECORDED quote
 *
 * Every line above is a route registered in this file's body. If a route is
 * ever removed, remove its line in the same edit.
 *
 * WHY ITS OWN PATH, NOT A CHILD OF /api/notes/:id
 * ----------------------------------------------
 * `note_payoff_quotes` deliberately spans BOTH note books via
 * `note_system` + `note_ref` — an acquired note (uuid) or a serviced note
 * (integer id as text). Hanging the artifact off `/api/notes/:id/...` would
 * bind the document to the acquired book and force a second, divergent route
 * the day the servicing book issues its first quote. The quote id is already
 * globally unique and org-scoped, so it addresses the artifact on its own.
 *
 * The path is `/api/note-payoff-quotes/...` and not `/api/payoff-quotes/...`
 * on purpose: server/routes-va-engine.ts owns `/api/payoff-quotes` for the
 * LEGACY decimal `payoff_quotes` table, whose rows are caller-supplied numbers
 * with no engine provenance. Those rows are not renderable as a payoff
 * statement and must not be reachable through this door by a path collision.
 *
 * WHAT THIS ROUTE DOES NOT DO
 * ---------------------------
 * It does not compute. It reads the frozen row, org-scoped at the query, and
 * hands it to the renderer. There is no payoff arithmetic in this file and no
 * import of the payoff engine — regenerating a quoted figure from a loan that
 * has since moved is the exact defect `note_payoff_quotes` was created to
 * prevent.
 *
 * AUTHORIZATION mirrors the routes that WRITE these quotes
 * (`POST /api/notes/:id/payoff/quotes` in server/routes-notes.ts): owner/admin
 * only, because the artifact carries payer identity and balance.
 */

import type { Express, Response } from "express";
import { and, eq } from "drizzle-orm";

import { db } from "./db";
import { notePayoffQuotes } from "@shared/schema/notes-vertical";
import { organizations } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireRole } from "./middleware/roleGuard";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import {
  PAYOFF_QUOTE_PDF_CHANNEL,
  PayoffQuoteRenderRefusal,
  REQUIRED_QUOTE_FIELDS,
  renderPayoffQuotePdf,
} from "./services/payoffQuotePdf";

export function registerPayoffQuotePdfRoutes(app: Express): void {
  const ownerOrAdmin = requireRole(["owner", "admin"]);

  app.get(
    "/api/note-payoff-quotes/:quoteId/pdf",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      const orgId = getOrganizationId(req);
      const quoteId = req.params.quoteId;

      try {
        // ORG-SCOPED AT THE QUERY. A payoff statement for another tenant's
        // borrower is a disclosure incident, not a 403 to be applied later.
        const [row] = await db
          .select()
          .from(notePayoffQuotes)
          .where(
            and(
              eq(notePayoffQuotes.id, quoteId),
              eq(notePayoffQuotes.organizationId, orgId),
            ),
          )
          .limit(1);
        if (!row) return Errors.notFound(res, "Payoff quote");

        const [org] = await db
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, orgId))
          .limit(1);

        const { buffer, filename, statement } = renderPayoffQuotePdf(row, {
          orgName: org?.name ?? null,
        });

        logger.info("payoffQuotePdf.rendered", {
          organizationId: orgId,
          quoteId,
          noteSystem: statement.noteSystem,
          noteRef: statement.noteRef,
          totalPayoffCents: statement.totalPayoffCents,
          asOfDate: statement.asOfDate,
          engineVersion: statement.engineVersion,
          // Which license-aware egress channel these bytes left through, and
          // whether the chokepoint thinned the artifact on the way out.
          egressChannel: PAYOFF_QUOTE_PDF_CHANNEL,
          egressWithheld: statement.egressNotice !== null,
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Length", String(buffer.length));
        // A payoff statement is point-in-time evidence; a cached copy served
        // for a different quote id would be indistinguishable from a forgery.
        res.setHeader("Cache-Control", "private, no-store");
        return res.end(buffer);
      } catch (err) {
        if (err instanceof PayoffQuoteRenderRefusal) {
          // The row exists but cannot be stated honestly. Say WHICH figure is
          // missing — a blank field on a payoff statement is worse than a
          // refusal, and "something went wrong" is unactionable.
          logger.warn("payoffQuotePdf.refused", {
            organizationId: orgId,
            quoteId,
            defects: err.defects,
          });
          return Errors.badRequest(
            res,
            "This payoff quote is missing figures a payoff statement must state, so no document was produced. " +
              "Issue a new quote rather than relying on this record.",
            {
              quoteId,
              defects: err.defects,
              // The full contract, so support can see WHICH of the figures a
              // payoff statement must state this row is short of.
              requiredFields: REQUIRED_QUOTE_FIELDS,
            },
          );
        }
        logger.error(
          "payoffQuotePdf.failed",
          err instanceof Error ? err : undefined,
        );
        return Errors.internal(res, err);
      }
    },
  );
}
