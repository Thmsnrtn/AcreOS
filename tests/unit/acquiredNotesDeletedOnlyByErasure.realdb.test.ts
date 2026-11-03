/**
 * Acquired notes are deleted only by org erasure — the half a source scan
 * cannot prove, run against a database built from this repository.
 *
 * Settings "Clear data" (clearOrganizationRecords) computes its delete set
 * from the LIVE foreign-key graph: every table that blocks deletion of
 * CLEAR_ROOT_TABLES through a NO ACTION/RESTRICT FK. acquired_notes references
 * properties and leads; if either FK were NO ACTION, "Clear data" would delete
 * the org's acquired notes and, by ON DELETE CASCADE, their
 * note_field_observations and note_events. Here it is RUN on an org whose note
 * holds rows in both ledgers, and everything must survive.
 *
 * Then the one path that may reach the cascade — org erasure,
 * deleteOrganization (D2/#412), which must stay a hard delete — is run on the
 * same org and must remove the note and both ledgers completely.
 *
 * Companion source-population ratchet: acquiredNotesDeletedOnlyByErasure.test.ts.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("acquiredNotesDeletedOnlyByErasure.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const tag = `andoe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let orgId = 0;

const n = (q: unknown): number => Number((q as { rows: Array<{ n: number | string }> }).rows[0].n);

describe.runIf(realDbAvailable)("acquired notes are deleted only by org erasure — real database", () => {
  afterAll(async () => {
    const { db, pool } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    if (orgId) await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => undefined);
    await pool.end();
  });

  it("the only ON DELETE CASCADE parent of acquired_notes is organizations", async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const res = await db.execute(sql`
      SELECT confrelid::regclass::text AS parent, confdeltype AS rule
      FROM pg_constraint
      WHERE conrelid = 'acquired_notes'::regclass AND contype = 'f'
      ORDER BY 1
    `);
    const fks = (res as unknown as { rows: Array<{ parent: string; rule: string }> }).rows;
    // Vacuity: the FK set was read at all (org, property, borrower as of 2026-11-03).
    expect(fks.length).toBeGreaterThanOrEqual(3);
    expect(fks.filter((f) => f.rule === "c").map((f) => f.parent)).toEqual(["organizations"]);
  });

  it("Settings 'Clear data' leaves an acquired note and both ledgers untouched; org erasure removes all three", async () => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const { organizations } = await import("@shared/schema");
    const [org] = await db.insert(organizations).values({ name: tag, slug: tag, ownerId: `${tag}-o` } as never).returning();
    orgId = org.id;

    // A property and a borrower lead the note points at — the two FKs that would
    // put acquired_notes inside the "Clear data" closure if they were NO ACTION.
    const prop = await db.execute(sql`
      INSERT INTO properties (organization_id, apn, county, state, size_acres, status)
      VALUES (${orgId}, ${`${tag}-apn`}, 'Test', 'TX', '1', 'owned') RETURNING id
    `);
    const propertyId = (prop as unknown as { rows: Array<{ id: number }> }).rows[0].id;
    const lead = await db.execute(sql`
      INSERT INTO leads (organization_id, first_name, last_name, type, status, source)
      VALUES (${orgId}, 'Test', ${tag}, 'buyer', 'active', 'import') RETURNING id
    `);
    const borrowerId = (lead as unknown as { rows: Array<{ id: number }> }).rows[0].id;

    const note = await db.execute(sql`
      INSERT INTO acquired_notes (
        organization_id, property_id, borrower_id, note_number,
        original_principal_cents, current_balance_cents, interest_rate_bps, term_months,
        payment_amount_cents, payment_due_day, origination_date, maturity_date,
        acquisition_date, acquisition_price_cents, payer_name
      ) VALUES (
        ${orgId}, ${propertyId}, ${borrowerId}, ${`${tag}-n1`},
        1000000, 900000, 900, 120,
        12000, 1, '2024-01-01', '2034-01-01',
        '2025-01-01', 800000, 'Test Payer'
      ) RETURNING id
    `);
    const noteId = (note as unknown as { rows: Array<{ id: string }> }).rows[0].id;

    await db.execute(sql`
      INSERT INTO note_field_observations (
        organization_id, note_id, field, kind, value, source, source_ref,
        confidence, confidence_basis, decay_class, recorded_by
      ) VALUES (
        ${orgId}, ${noteId}, 'currentBalanceCents', 'value', '900000'::jsonb, 'note_tape', '{}'::jsonb,
        'high', 'stated on the tape', 'continuous', ${tag}
      )
    `);
    await db.execute(sql`
      INSERT INTO note_events (
        organization_id, note_id, category, event_type, event_date, detail, source, source_ref, recorded_by
      ) VALUES (
        ${orgId}, ${noteId}, 'calendar', 'maturity', '2034-01-01', '{}'::jsonb, 'note_tape', '{}'::jsonb, ${tag}
      )
    `);

    const counts = async () => ({
      note: n(await db.execute(sql`SELECT count(*)::int AS n FROM acquired_notes WHERE id = ${noteId}`)),
      observations: n(await db.execute(sql`SELECT count(*)::int AS n FROM note_field_observations WHERE note_id = ${noteId}`)),
      events: n(await db.execute(sql`SELECT count(*)::int AS n FROM note_events WHERE note_id = ${noteId}`)),
      properties: n(await db.execute(sql`SELECT count(*)::int AS n FROM properties WHERE id = ${propertyId}`)),
      leads: n(await db.execute(sql`SELECT count(*)::int AS n FROM leads WHERE id = ${borrowerId}`)),
    });
    // Vacuity: every row exists before anything runs.
    expect(await counts()).toEqual({ note: 1, observations: 1, events: 1, properties: 1, leads: 1 });

    const { clearOrganizationRecords } = await import("../../server/services/orgDataClear");
    const clear = await clearOrganizationRecords(orgId);
    // "Clear data" really ran and really cleared its roots — the note survived a live sweep, not a no-op.
    expect(clear.blocked).toEqual([]);
    expect(clear.cleared.properties).toBe(1);
    expect(clear.cleared.leads).toBe(1);
    expect(clear.cleared.acquired_notes).toBeUndefined();
    expect(await counts()).toEqual({ note: 1, observations: 1, events: 1, properties: 0, leads: 0 });
    // The SET NULL edges fired: the note survives detached from the cleared parents.
    const links = await db.execute(sql`SELECT property_id, borrower_id FROM acquired_notes WHERE id = ${noteId}`);
    expect((links as unknown as { rows: unknown[] }).rows).toEqual([{ property_id: null, borrower_id: null }]);

    const { deleteOrganization } = await import("../../server/services/orgDeletion");
    const erased = await deleteOrganization(orgId);
    expect(erased.orgRowDeleted).toBe(true);
    expect(erased.residualTables).toEqual([]);
    expect(await counts()).toEqual({ note: 0, observations: 0, events: 0, properties: 0, leads: 0 });
    orgId = 0;
  });
});
