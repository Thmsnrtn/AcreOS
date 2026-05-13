/**
 * Pillar F / F1 — Pax-specific wrapper around hallucinationDetector.
 *
 * Verifies that Pax output:
 *   - Doesn't mention numbers that aren't in its source context
 *     (delegates to detectHallucinations).
 *   - Doesn't reference lead/parcel/deal IDs that don't exist in the
 *     user's organization (entity-existence check, new).
 *
 * Returns a structured warning list so the caller can decide between
 * advisory rendering (show banner) and strict rejection (refuse to
 * persist + ask Pax to retry).
 */

import { db } from "../db";
import { leads, properties, deals } from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { detectHallucinations, type HallucinationWarning } from "./hallucinationDetector";

export interface PaxGuardInput {
  organizationId: number;
  output: string;
  // Optional context — when omitted, only the entity-existence check fires.
  sourceNumbers?: number[];
  proposedArv?: number;
  compArvs?: number[];
  requiredFields?: string[];
  // Entity IDs that Pax claims to reference. Each is verified against
  // the user's organization. Mentions of foreign org IDs always
  // produce a warning — that's the most dangerous hallucination shape.
  claimedLeadIds?: number[];
  claimedPropertyIds?: number[];
  claimedDealIds?: number[];
}

export interface PaxGuardResult {
  warnings: HallucinationWarning[];
  safe: boolean;
}

async function checkEntitiesExist(
  orgId: number,
  ids: number[] | undefined,
  table: typeof leads | typeof properties | typeof deals,
  entityName: string,
): Promise<HallucinationWarning[]> {
  if (!ids || ids.length === 0) return [];
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.organizationId, orgId), inArray(table.id, ids)));
  const foundSet = new Set(rows.map((r) => Number(r.id)));
  const missing = ids.filter((id) => !foundSet.has(Number(id)));
  return missing.map((id) => ({
    kind: "entity_not_in_org" as const,
    severity: "error" as const,
    detail: `Pax claimed to reference ${entityName} #${id} which is not in this organization.`,
    field: `${entityName}:${id}`,
    evidence: { field: `${entityName}:${id}` },
  }));
}

export async function guardPaxOutput(input: PaxGuardInput): Promise<PaxGuardResult> {
  const warnings: HallucinationWarning[] = [];

  // 1. Reuse the existing numeric/ARV/field detector.
  warnings.push(
    ...detectHallucinations({
      output: input.output,
      sourceNumbers: input.sourceNumbers,
      proposedArv: input.proposedArv,
      compArvs: input.compArvs,
      requiredFields: input.requiredFields,
    }),
  );

  // 2. Entity-existence checks (parallel).
  const [leadMissing, propMissing, dealMissing] = await Promise.all([
    checkEntitiesExist(input.organizationId, input.claimedLeadIds, leads, "lead"),
    checkEntitiesExist(input.organizationId, input.claimedPropertyIds, properties, "property"),
    checkEntitiesExist(input.organizationId, input.claimedDealIds, deals, "deal"),
  ]);
  warnings.push(...leadMissing, ...propMissing, ...dealMissing);

  const safe = warnings.every((w) => w.severity !== "error");
  return { warnings, safe };
}
