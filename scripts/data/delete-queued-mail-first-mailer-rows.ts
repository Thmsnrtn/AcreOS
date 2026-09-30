#!/usr/bin/env tsx
/**
 * Quality directive 2026-09-29 (first-mail wedge, DEFECT-0194 residue):
 * delete the `activation_events` rows the outreach mail QUEUE wrote as
 * `first_mailer_sent`.
 *
 * Until 0133993 the mail queue recorded `first_mailer_sent` — the email/SMS
 * milestone — when a letter was merely queued, with
 * `event_value.source = "outreach:mail:queue"`. The table allows ONE row per
 * org per event, so that row also blocked the org's later, real email/SMS
 * milestone from ever being recorded. The funnel now ignores these rows;
 * deleting them lets the real milestone record the next time it happens.
 * (The queue now records `first_mail_queued`; physical mail is
 * `first_letter_sent`, recorded by the flusher.)
 *
 * Only rows with exactly that source are touched. Everything deleted is
 * exported to JSON first, in one transaction.
 *
 *   DATABASE_URL=... npx tsx scripts/data/delete-queued-mail-first-mailer-rows.ts          # dry run
 *   DATABASE_URL=... npx tsx scripts/data/delete-queued-mail-first-mailer-rows.ts --apply  # export + delete
 */
import { connect, exportRows, isMain, parseFlags, type Queryable } from "./_client";

export interface ActivationRow {
  id: number;
  organization_id: number;
  event_name: string;
  event_value: Record<string, unknown> | null;
  occurred_at: string | Date;
}

export const QUEUE_SOURCE = "outreach:mail:queue";

export async function deleteQueuedMailFirstMailerRows(
  client: Queryable,
  opts: { apply: boolean; outDir: string },
): Promise<{ rows: ActivationRow[]; exportPath: string | null; applied: boolean }> {
  const { rows } = await client.query<ActivationRow>(
    `SELECT id, organization_id, event_name, event_value, occurred_at FROM activation_events
      WHERE event_name = 'first_mailer_sent' AND event_value->>'source' = $1
      ORDER BY id`,
    [QUEUE_SOURCE],
  );
  if (!opts.apply || rows.length === 0) return { rows, exportPath: null, applied: false };
  const exportPath = exportRows(opts.outDir, "activation-events-queued-mail-first-mailer", rows);
  await client.query("BEGIN");
  try {
    await client.query(
      `DELETE FROM activation_events
        WHERE id = ANY($1::int[]) AND event_name = 'first_mailer_sent' AND event_value->>'source' = $2`,
      [rows.map((r) => r.id), QUEUE_SOURCE],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  return { rows, exportPath, applied: true };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const { client, end } = await connect();
  const r = await deleteQueuedMailFirstMailerRows(client, flags);
  await end();
  console.log(`${r.rows.length} first_mailer_sent row(s) written by the mail queue.`);
  console.log(r.applied ? `Exported to ${r.exportPath}, then deleted.` : "Dry run: nothing changed. Re-run with --apply to export and delete.");
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
