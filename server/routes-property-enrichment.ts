/**
 * T209 — Property Enrichment Routes
 *
 * POST /api/properties/:id/enrich        — enrich a single property
 * POST /api/properties/bulk-enrich       — enrich multiple properties (max 50)
 * GET  /api/properties/:id/enrichment    — get enrichment data for a property
 *
 * Evidence Fabric read surface (Master Audit BK13 "expose evidence lineage in
 * UI/Pax"):
 *
 * GET  /api/properties/:id/evidence            — every fact we hold about this
 *                                                property, each resolved to
 *                                                known / unknown / conflict
 *                                                with its provenance
 * GET  /api/properties/:id/evidence/:predicate — one fact's FULL claim history,
 *                                                including superseded and
 *                                                dissenting claims
 *
 * Both accept `?asOf=<ISO>` to reconstruct what we believed at a past moment.
 * That parameter is the whole of canonical law 6 (historical decisions preserve
 * what was known at the time) made reachable: it is the same code path, with a
 * different date.
 */

import { Router, type Request, type Response } from "express";
import { Errors } from "./utils/errors";
import { propertyEnrichmentService } from "./services/propertyEnrichment";
import { db } from "./db";
import { properties } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import {
  claimsForPredicate,
  resolveFact,
  resolveSubject,
} from "./services/evidence/evidenceStore";
import { isKnownPredicate, predicateById } from "@shared/evidence/claim";

const router = Router();


// POST /api/properties/:id/enrich
router.post("/:id/enrich", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const propertyId = parseInt(req.params.id);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid property ID" });

    // enrichProperty(organizationId, propertyId) — args were previously swapped.
    const result = await propertyEnrichmentService.enrichProperty(org.id, propertyId);
    res.json(result);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// POST /api/properties/bulk-enrich
router.post("/bulk-enrich", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { propertyIds, limit = 50 } = req.body;

    if (propertyIds && !Array.isArray(propertyIds)) {
      return res.status(400).json({ error: "propertyIds must be an array" });
    }

    // TODO(tsc): propertyEnrichmentService has no batchEnrich method. Enrich
    // each property individually via the existing enrichProperty(orgId, id).
    const ids: number[] = Array.isArray(propertyIds)
      ? propertyIds.map((p: any) => Number(p)).filter((n) => Number.isFinite(n)).slice(0, Math.min(limit, 50))
      : [];
    const results = [];
    for (const id of ids) {
      results.push(await propertyEnrichmentService.enrichProperty(org.id, id));
    }
    res.json({ results, count: results.length });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// GET /api/properties/:id/enrichment
router.get("/:id/enrichment", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const propertyId = parseInt(req.params.id);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid property ID" });

    const [property] = await db
      .select()
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, org.id)))
      .limit(1);

    if (!property) return res.status(404).json({ error: "Property not found" });

    // TODO(tsc): propertyEnrichmentService has no getEnrichmentData method;
    // re-running enrichProperty returns the latest enrichment result.
    const enrichmentData = await propertyEnrichmentService.enrichProperty(org.id, propertyId);
    res.json({ propertyId, enrichment: enrichmentData });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ── Evidence Fabric read surface ──────────────────────────────────────────

/**
 * Parse `?asOf=<ISO>`. An unparseable value is REFUSED rather than silently
 * falling back to now(): a caller asking "what did we believe on 3 March?" and
 * quietly receiving today's answer is the exact class of lie the Evidence
 * Fabric exists to prevent.
 */
function parseAsOf(raw: unknown): { ok: true; asOf: Date } | { ok: false } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, asOf: new Date() };
  }
  if (typeof raw !== "string") return { ok: false };
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? { ok: false } : { ok: true, asOf: d };
}

async function loadOwnedProperty(orgId: number, propertyId: number) {
  const [property] = await db
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)))
    .limit(1);
  return property ?? null;
}

// GET /api/properties/:id/evidence
router.get("/:id/evidence", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const propertyId = parseInt(req.params.id, 10);
    if (isNaN(propertyId)) return Errors.badRequest(res, "Invalid property ID");

    const when = parseAsOf(req.query.asOf);
    if (!when.ok) {
      return Errors.badRequest(res, "Invalid asOf — expected an ISO 8601 timestamp");
    }

    if (!(await loadOwnedProperty(org.id, propertyId))) {
      return Errors.notFound(res, "Property");
    }

    // A property's cadastral facts are claimed against the `parcel` subject
    // while its economic facts are claimed against `property` — both are keyed
    // by this property id until Parcel separates into its own entity.
    const [propertyFacts, parcelFacts] = await Promise.all([
      resolveSubject(org.id, "property", propertyId, when.asOf),
      resolveSubject(org.id, "parcel", propertyId, when.asOf),
    ]);

    const facts = [...propertyFacts.values(), ...parcelFacts.values()].map((r) => ({
      predicate: r.predicate,
      label: predicateById(r.predicate)?.label ?? r.predicate,
      state: r.state,
      // `value` is deliberately absent (not null) when the state is not
      // "known" — a client cannot then mistake an unknown for a null answer.
      ...(r.state === "known" ? { value: r.value } : {}),
      confidence: r.confidence,
      stale: r.stale,
      factors: r.factors,
      sources: r.candidates[0]?.claims.map((c) => c.source) ?? [],
      // On conflict the rival values must reach the client — a UI that shows
      // only the winner has silently resolved a disagreement a human owns.
      ...(r.state === "conflict"
        ? {
            conflicting: r.candidates.map((c) => ({
              value: c.value,
              source: c.claims[0].source,
              authority: c.bestAuthority,
              observedAt: c.observedAt,
            })),
          }
        : {}),
    }));

    res.json({
      propertyId,
      asOf: when.asOf.toISOString(),
      resolutionPolicyVersion:
        propertyFacts.values().next().value?.policyVersion ??
        parcelFacts.values().next().value?.policyVersion ??
        null,
      facts,
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// GET /api/properties/:id/evidence/:predicate — one fact's full lineage
router.get("/:id/evidence/:predicate", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const propertyId = parseInt(req.params.id, 10);
    if (isNaN(propertyId)) return Errors.badRequest(res, "Invalid property ID");

    const predicate = req.params.predicate;
    if (!isKnownPredicate(predicate)) {
      // Refuse rather than return an empty lineage: an unregistered predicate
      // is a caller bug, and an empty answer would read as "no evidence".
      return Errors.badRequest(res, `Unknown evidence predicate: ${predicate}`);
    }

    const when = parseAsOf(req.query.asOf);
    if (!when.ok) {
      return Errors.badRequest(res, "Invalid asOf — expected an ISO 8601 timestamp");
    }

    if (!(await loadOwnedProperty(org.id, propertyId))) {
      return Errors.notFound(res, "Property");
    }

    const spec = predicateById(predicate)!;
    const resolved = await resolveFact(
      org.id,
      spec.subjectType,
      propertyId,
      predicate,
      when.asOf,
    );
    // The full history, including claims superseded under the resolution
    // policy. Nothing is hidden: dissent stays inspectable (BI139).
    const history = await claimsForPredicate(
      org.id,
      spec.subjectType,
      propertyId,
      predicate,
    );

    res.json({
      propertyId,
      predicate,
      label: spec.label,
      subjectType: spec.subjectType,
      unit: spec.unit ?? null,
      freshnessHorizonDays: spec.freshnessHorizonDays,
      asOf: when.asOf.toISOString(),
      resolution: {
        state: resolved.state,
        ...(resolved.state === "known" ? { value: resolved.value } : {}),
        confidence: resolved.confidence,
        stale: resolved.stale,
        factors: resolved.factors,
        policyVersion: resolved.policyVersion,
      },
      claims: history.map((c) => ({
        id: c.id,
        value: c.value,
        source: c.source,
        provider: c.provider,
        authority: c.authority,
        observedAt: c.observedAt,
        fetchedAt: c.fetchedAt,
        license: c.license,
        costCents: c.costCents,
      })),
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

export default router;
