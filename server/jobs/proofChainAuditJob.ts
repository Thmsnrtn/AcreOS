/**
 * Proof-receipt chain audit job — extracted from runScheduledJobs.ts
 * (MON-DEF-1 fix round, 2026-11-21).
 *
 * The job body lives here, not in runScheduledJobs.ts: that file is the
 * autopilot heartbeat under a strictly-DOWN line-count ratchet (S3
 * decomposition), so job groups land in server/jobs/*.ts and the
 * monolith keeps only the import + start call. Same shared runtime
 * (jobRuntime lock/interval/log) as every other carved-out job. The
 * verification work itself lives in
 * server/services/autopilot/proofReceiptStore.ts
 * (auditAllReceiptChains).
 */

import { trackInterval, withJobLock, jobLog as log } from "../utils/jobRuntime";

/**
 * Proof-receipt chain self-verify (Frontier #4) — daily, walks every scope's
 * persisted receipt chain and re-checks the per-row seal + chain linkage. A
 * tamper-evident log is only worth anything if something re-verifies it: a
 * silent corruption (an edited row, a forked chain) becomes a critical page
 * instead of sitting undetected until a regulator/insurer asks for the proof.
 */
export function startProofChainAuditJob() {
  const ONE_DAY = 24 * 60 * 60 * 1000;
  log('Registering proof-receipt chain audit (daily)', 'sovereign');
  const runOnce = async () => {
    // Daily — TTL = 23h (≈90% of cadence).
    withJobLock("proof_chain_audit", 23 * 60 * 60, async () => {
      const { auditAllReceiptChains } = await import('../services/autopilot/proofReceiptStore');
      const r = await auditAllReceiptChains();
      if (r.brokenChains.length > 0) {
        const detail = r.brokenChains.map((b) => `${b.scope}: ${b.reason}`).join('; ');
        log(`[proof-chain-audit] BROKEN ${r.brokenChains.length}/${r.scopesChecked} chains — ${detail}`, 'sovereign');
        const { sendSolenePage } = await import('../services/solene/pagerService');
        await sendSolenePage({
          severity: 'critical',
          subject: `Proof-receipt chain integrity broken (${r.brokenChains.length} scope${r.brokenChains.length === 1 ? '' : 's'})`,
          body: `A persisted governance receipt chain failed self-verification — possible tampering or corruption. ${detail}`,
        }).catch(() => { /* paging best-effort; the log line is the durable record */ });
      } else {
        log(`[proof-chain-audit] OK — ${r.receiptsChecked} receipts across ${r.scopesChecked} scopes verify`, 'sovereign');
      }
    }).catch((err: any) => {
      log(`[proof-chain-audit] failed: ${err?.message ?? err}`, 'sovereign');
    });
  };

  // MON-DEF-1: first run 5 minutes after boot, then daily. This was the
  // only daily job in this file with NO boot-time first run — a bare 24h
  // interval whose first fire lands a full day after every worker boot
  // and resets on every restart, so any worker generation shorter than
  // 24h starved it indefinitely (staging runs: Oct 31, Nov 4, Nov 11 —
  // weekly-ish against a daily registration; the registration was right,
  // the schedule mechanism was wrong). Every peer job here
  // (recourse_sweep, data_source_probe, burn_rate_monitor) pairs its
  // interval with a boot run; this one now does too. The audit is a
  // read-only verification, so an extra boot run on a deploy-heavy day
  // is harmless — and the lock keeps two live generations from running
  // it concurrently.
  setTimeout(runOnce, 5 * 60 * 1000);
  trackInterval(runOnce, ONE_DAY);
}
