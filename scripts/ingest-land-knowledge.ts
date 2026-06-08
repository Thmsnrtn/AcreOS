#!/usr/bin/env tsx
/**
 * scripts/ingest-land-knowledge.ts
 *
 * Andrei (Tahoe E5) — embed the curated Pax land-knowledge corpus and upsert
 * it into solene_embedded_records (namespace land_knowledge, organization_id =
 * NULL / global). Operator one-shot — run after editing the corpus or on a new
 * deploy so retrieve_land_knowledge has something to retrieve.
 *
 * Usage:
 *   DATABASE_URL=... VOYAGE_API_KEY=... tsx scripts/ingest-land-knowledge.ts
 *   DATABASE_URL=... VOYAGE_API_KEY=... tsx scripts/ingest-land-knowledge.ts --force
 *
 * Flags:
 *   --force   Re-embed every card regardless of content_hash drift (use after
 *             a Voyage model swap).
 *
 * Credential discipline: VOYAGE_API_KEY is read by the Voyage client at
 * call-time and never printed (only its length, inside the client). This
 * script logs counts only — never card content beyond the corpus itself,
 * which is public knowledge, never any credential value.
 */
import process from "node:process";
import { ingestLandKnowledge } from "../server/services/pax/landKnowledge/ingest";
import {
  LAND_KNOWLEDGE_CARDS,
  LAND_KNOWLEDGE_CORPUS_VERSION,
} from "../server/services/pax/landKnowledge/corpus";

async function main(): Promise<void> {
  const force = process.argv.includes("--force");

  if (!process.env.VOYAGE_API_KEY) {
    // eslint-disable-next-line no-console
    console.error(
      "[ingest-land-knowledge] VOYAGE_API_KEY not set — embedding will fail. " +
        "Set it before running so cards are embedded with the production model.",
    );
    process.exitCode = 1;
    return;
  }

  // eslint-disable-next-line no-console
  console.log(
    `[ingest-land-knowledge] corpus=${LAND_KNOWLEDGE_CORPUS_VERSION} ` +
      `cards=${LAND_KNOWLEDGE_CARDS.length} force=${force}`,
  );

  const result = await ingestLandKnowledge({ force });

  // eslint-disable-next-line no-console
  console.log(
    `[ingest-land-knowledge] done — embedded=${result.embedded} ` +
      `skipped=${result.skipped} failed=${result.failed} total=${result.total}`,
  );
  if (result.errors.length > 0) {
    // eslint-disable-next-line no-console
    console.error("[ingest-land-knowledge] errors:");
    for (const e of result.errors) {
      // eslint-disable-next-line no-console
      console.error("  - " + e);
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[ingest-land-knowledge] fatal", err);
  process.exitCode = 1;
});
