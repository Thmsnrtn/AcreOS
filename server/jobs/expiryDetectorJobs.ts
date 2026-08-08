/**
 * Daily due/expiry detector job registrations — a cohesive job-group carved out
 * of the runScheduledJobs god-file (S3 decomposition, continuing the pattern
 * leadCampaignJobs.ts started 2026-07-16). Both jobs are thin schedulers over a
 * pure daily scan that lives in server/services/*; each publishes one mesh event
 * per NEW finding (deduped against the mesh ledger — no new migration) and fires
 * the matching workflow trigger events. Registered by runScheduledJobs().
 */

import { trackInterval, withJobLock, jobLog as log } from "../utils/jobRuntime";

// ============================================================================
// Jarvis 2.1 (audit G2) — Note payment due-date detector. Daily 11:00 UTC
// (an hour before the Solene morning pulse at 12:00 UTC so the tick reads a
// fresh signal). Scans active notes for borrower payments due in the next 7
// days or overdue: one mesh event per NEW finding (deterministic dedupe key
// checked against the mesh ledger — a rerun never re-publishes), plus
// aggregate counts-only outward senses via perception.recordSense. Observe-
// only; overdue events at priority 3 ride the existing notification-router.
// Cheap: two indexed reads + a handful of inserts; no external API calls.
// ============================================================================
export function startNotePaymentDueDetectorJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TTL_SECONDS = 10 * 60;

  log('Registering note payment due-date detector (daily 11:00 UTC)', 'note-payments');

  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() === 11) {
      import('../services/notePaymentDueDetector').then(({ runNotePaymentDueScan }) => {
        withJobLock('note_payment_due_scan', TTL_SECONDS, async () => {
          const r = await runNotePaymentDueScan();
          log(
            `Note payment scan: scanned=${r.scanned} dueSoon=${r.dueSoon} overdue=${r.overdue} published=${r.published} errors=${r.errors}`,
            'note-payments',
          );
        }).catch(err => {
          log(`Note payment due scan failed: ${err}`, 'note-payments');
        });
      }).catch(err => log(`Note payment detector import failed: ${err}`, 'note-payments'));
    }
  }, ONE_HOUR);
}

// ============================================================================
// Audit Wave 1 (buy_and_hold beta→core) — lease-expiry detector. Daily 10:00 UTC
// (an hour before the note payment detector at 11:00 so the two landlord/note
// daily scans interleave cleanly). Scans active leases whose end date is within
// the next 60 days (skips month-to-month / non-active), publishes one mesh event
// per NEW finding (deterministic dedupe key checked against the mesh ledger — a
// rerun never re-publishes), and fires BOTH lease workflow events
// (lease.renewal_countdown_60d + lease.expiring_60d) for it. Cheap: one indexed
// read + a handful of inserts; no external API calls. Same shape as the note
// payment detector — no new migration.
// ============================================================================
export function startLeaseExpiryDetectorJob() {
  const ONE_HOUR = 60 * 60 * 1000;
  const TTL_SECONDS = 10 * 60;

  log('Registering lease-expiry detector (daily 10:00 UTC)', 'lease-expiry');

  trackInterval(() => {
    const now = new Date();
    if (now.getUTCHours() === 10) {
      import('../services/leaseExpiryDetector').then(({ runLeaseExpiryScan }) => {
        withJobLock('lease_expiry_scan', TTL_SECONDS, async () => {
          const r = await runLeaseExpiryScan();
          log(
            `Lease expiry scan: scanned=${r.scanned} inWindow=${r.inWindow} published=${r.published} emitted=${r.emitted} errors=${r.errors}`,
            'lease-expiry',
          );
        }).catch(err => {
          log(`Lease expiry scan failed: ${err}`, 'lease-expiry');
        });
      }).catch(err => log(`Lease expiry detector import failed: ${err}`, 'lease-expiry'));
    }
  }, ONE_HOUR);
}
