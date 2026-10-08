/**
 * Product limits that a customer can be TOLD about — one definition each.
 *
 * Each constant here is read by the code that ENFORCES it (the import routes,
 * the export rate limiters) and by Pax's product-facts tool
 * (`server/services/paxProductFacts.ts`), so the number Pax quotes is the
 * number the product applies. Before this module the 500-row cap was three
 * private `const MAX_CSV_IMPORT_ROWS = 500` lines in three route files and the
 * export cap was a bare `max: 5` in two limiters; an answer copied from either
 * would have drifted the first time one of them changed.
 *
 * Isomorphic on purpose (no server imports): the client may render the same
 * limits on the import sheet.
 */

/**
 * Rows accepted by one synchronous CSV import: the Leads page's "Import CSV"
 * and "Import Tax List" buttons, the properties CSV import, and the
 * synchronous `/api/import/:entityType` path. Larger files go through the
 * job-backed Data Import page (`MAX_IMPORT_ROWS` in server/services/migrationJobs.ts).
 */
export const CSV_IMPORT_MAX_ROWS_PER_FILE = 500;

/**
 * Bulk exports per person per 24 hours, on every bulk-export path
 * (`/api/leads/export` and siblings, `/api/export/*`).
 */
export const BULK_EXPORT_DAILY_CAP = 5;

/**
 * Rows accepted by one job-backed import (Data Import page, `POST
 * /api/import/:entityType` above the synchronous cap). Enforced in
 * server/services/migrationJobs.ts (`MAX_IMPORT_ROWS`) and the import route.
 */
export const DATA_IMPORT_JOB_MAX_ROWS = 50_000;
