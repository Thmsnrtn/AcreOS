#!/usr/bin/env tsx
/**
 * F-A02-1: Encryption Key Rotation Script
 *
 * Re-encrypts all AES-256-GCM protected fields in the database from an old key
 * to a new key. Run this script whenever FIELD_ENCRYPTION_KEY is rotated.
 *
 * USAGE
 * -----
 *   OLD_KEY=<hex64> NEW_KEY=<hex64> DATABASE_URL=<url> npx tsx server/scripts/rotateEncryptionKey.ts
 *
 * Or, if the old key is currently in FIELD_ENCRYPTION_KEY:
 *   NEW_KEY=<hex64> DATABASE_URL=<url> npx tsx server/scripts/rotateEncryptionKey.ts
 *
 * GENERATE A NEW KEY
 * ------------------
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * PROCEDURE (zero-downtime)
 * -------------------------
 *  1. Generate a new 32-byte key:
 *       NEW=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
 *  2. Run this script with OLD_KEY = current FIELD_ENCRYPTION_KEY, NEW_KEY = $NEW
 *  3. Verify the script reports 0 errors.
 *  4. Update FIELD_ENCRYPTION_KEY in your production secret store to $NEW.
 *  5. Restart the application.
 *  6. Optionally schedule annual re-runs (add to calendar / cron).
 *
 * SAFETY NOTES
 * ------------
 *  - The script processes rows in batches of 100 to limit memory usage.
 *  - Each field is updated atomically per-row (single UPDATE).
 *  - On error the row is skipped and logged — re-run to retry failed rows.
 *  - The old key value is never logged.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq } from "drizzle-orm";
import { rotateEncryption, isEncrypted } from "../middleware/fieldEncryption";

// ─── Configuration ────────────────────────────────────────────────────────────

const OLD_KEY_HEX =
  process.env.OLD_KEY || process.env.FIELD_ENCRYPTION_KEY || "";
const NEW_KEY_HEX = process.env.NEW_KEY || "";

if (!OLD_KEY_HEX || OLD_KEY_HEX.length !== 64) {
  console.error(
    "ERROR: Set OLD_KEY (or FIELD_ENCRYPTION_KEY) to the current 64-hex-char key."
  );
  process.exit(1);
}
if (!NEW_KEY_HEX || NEW_KEY_HEX.length !== 64) {
  console.error(
    "ERROR: Set NEW_KEY to the new 64-hex-char key.\n" +
    "  Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  );
  process.exit(1);
}
if (OLD_KEY_HEX === NEW_KEY_HEX) {
  console.error("ERROR: OLD_KEY and NEW_KEY are identical. Nothing to rotate.");
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is required.");
  process.exit(1);
}

// ─── DB connection ────────────────────────────────────────────────────────────

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool);

// ─── Tables + encrypted columns ──────────────────────────────────────────────
// Add entries here when new encrypted columns are added to the schema.

import {
  landCreditScores,
  portfolioSimulations,
} from "../../shared/schema";

interface EncryptedTable {
  tableName: string;
  table: any;
  idColumn: string;
  encryptedColumns: string[];
}

const ENCRYPTED_TABLES: EncryptedTable[] = [
  {
    tableName: "land_credit_scores",
    table: landCreditScores,
    idColumn: "id",
    encryptedColumns: ["scoreData", "creditScore"],
  },
  {
    tableName: "portfolio_simulations",
    table: portfolioSimulations,
    idColumn: "id",
    encryptedColumns: ["simulationData", "results"],
  },
];

// ─── Rotation logic ───────────────────────────────────────────────────────────

async function rotateTable(tableConfig: EncryptedTable): Promise<void> {
  const { tableName, table, encryptedColumns } = tableConfig;
  console.log(`\n[rotate] Processing table: ${tableName}`);

  let offset = 0;
  const BATCH = 100;
  let totalRows = 0;
  let rotatedFields = 0;
  let errorCount = 0;

  while (true) {
    const rows = await db.select().from(table).limit(BATCH).offset(offset);
    if (rows.length === 0) break;

    for (const row of rows) {
      const updates: Record<string, string> = {};

      for (const col of encryptedColumns) {
        const val = (row as any)[col];
        if (typeof val === "string" && isEncrypted(val)) {
          try {
            updates[col] = rotateEncryption(val, OLD_KEY_HEX, NEW_KEY_HEX);
            rotatedFields++;
          } catch (err: any) {
            console.error(
              `  ERROR rotating ${tableName}.${col} id=${(row as any).id}: ${err.message}`
            );
            errorCount++;
          }
        }
      }

      if (Object.keys(updates).length > 0) {
        try {
          await db.update(table).set(updates).where(eq(table.id, (row as any).id));
        } catch (err: any) {
          console.error(
            `  ERROR updating ${tableName} id=${(row as any).id}: ${err.message}`
          );
          errorCount++;
        }
      }

      totalRows++;
    }

    offset += rows.length;
    process.stdout.write(`  Processed ${offset} rows...\r`);
  }

  console.log(
    `  Done: ${totalRows} rows, ${rotatedFields} fields rotated, ${errorCount} errors`
  );
}

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("AcreOS Field Encryption Key Rotation");
  console.log("=".repeat(60));
  console.log(`Old key: ${OLD_KEY_HEX.slice(0, 8)}...${OLD_KEY_HEX.slice(-8)} (redacted)`);
  console.log(`New key: ${NEW_KEY_HEX.slice(0, 8)}...${NEW_KEY_HEX.slice(-8)} (redacted)`);
  console.log(`Tables to process: ${ENCRYPTED_TABLES.map((t) => t.tableName).join(", ")}`);
  console.log();

  for (const tableConfig of ENCRYPTED_TABLES) {
    await rotateTable(tableConfig);
  }

  console.log("\n" + "=".repeat(60));
  console.log("Key rotation complete.");
  console.log(
    "Next step: Update FIELD_ENCRYPTION_KEY in your secret store to the new key and restart the app."
  );
  console.log("=".repeat(60));

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
