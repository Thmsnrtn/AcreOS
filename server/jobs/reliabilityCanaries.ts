/**
 * Reliability canaries — a cohesive job-group carved out of the
 * runScheduledJobs god-file (S3 decomposition, same pattern as
 * expiryDetectorJobs.ts / achAutopayRun.ts; the line-count ratchet on
 * runScheduledJobs.ts only goes down, so this group must not grow it).
 *
 *   1. synthetic_checks (FW-OLU-2 — moved VERBATIM from runScheduledJobs.ts):
 *      every 15 min ping the five critical vendor surfaces (SES, Stripe
 *      webhook freshness, Clerk proxy, DB writeable, Twilio), persist to
 *      synthetic_check_runs, and page P1 through the alert spine on any
 *      failing probe. Critical roster entry — absence pages via the deadman.
 *
 *   2. persona_journey_canary (O4, P5 §2 "promises with sensors" — NEW):
 *      every 30 min walk a real minimal persona journey (demo-org workspace
 *      read + sample-marked sentinel round-trip when DEMO_ORG_ID is
 *      provisioned; the deepest platform journey otherwise, recorded honestly
 *      as substrate "platform_only") and record per-step latency+success to
 *      the same synthetic_check_runs table. NON-critical, onFailure "queue"
 *      per the O5 pager matrix: a broken journey raises a WARNING finding +
 *      system_alerts row (deduped by the spine) and surfaces on the public
 *      /status page — it does not page. The zero-tolerance page-worthy
 *      sensors (mail_flusher, synthetic_checks, data_source_probe) are
 *      already critical roster entries; paging on a brand-new journey canary
 *      would train pager fatigue, not reliability.
 *
 * Registered by runScheduledJobs() via one dynamic import (its module body
 * carries the withJobLock literals — jobRosterCoverage.test.ts scans this
 * file for roster parity).
 */

import { withJobLock, jobLog as log } from "../utils/jobRuntime";

export function startReliabilityCanaryJobs(): void {
  // ─── FW-OLU-2: synthetic vendor checks (every 15 min) ──
  // Five checks (SES, Stripe webhook freshness, Clerk proxy, DB
  // writeable, Twilio). Persists to synthetic_check_runs. Founder
  // pulls latest via /api/founder/synthetic-checks/recent.
  import("../services/syntheticChecks").then(({ runAllSyntheticChecks }) => {
    import("./scheduler").then(({ scheduleSelfRescheduling }) => {
      log("Synthetic checks scheduler registered (self-rescheduling, 15m)", "ops");
      scheduleSelfRescheduling({
        name: "synthetic_checks",
        intervalMs: 15 * 60 * 1000,
        initialDelayMs: 3 * 60 * 1000, // 3min after boot
        run: async () => {
          // 15m cadence → TTL = ~90% of cadence (13m).
          await withJobLock("synthetic_checks", 13 * 60, async () => {
            // Detection WITHOUT announcement was the bug: the results were
            // discarded. Inspect them and page on-call if any check is
            // failing (a failing SES/Stripe-webhook/Clerk/DB/Twilio probe is a
            // production-affecting signal). 'degraded' is informational only.
            const results = await runAllSyntheticChecks();
            const failing = results.filter((r) => r.status === "failing");
            if (failing.length > 0) {
              // Tier 1D: route through the alert spine instead of a raw
              // notifyOnCall — the spine's dedupe window means a check that
              // stays failing pages once an hour, not every 15 minutes, and
              // the failure also lands as a finding + system_alerts row.
              const { raiseAlert } = await import("../services/alertSpine");
              for (const r of failing) {
                await raiseAlert({
                  severity: "critical",
                  source: "synthetic_checks",
                  title: `Synthetic check failing: ${r.checkKey}`,
                  detail:
                    `Synthetic vendor check "${r.checkKey}" reported status=failing. ` +
                    `A failing probe means a core dependency (email/Stripe webhook/Clerk proxy/DB/Twilio) ` +
                    `is unreachable or erroring. See synthetic_check_runs for detail.`,
                  dedupeKey: `failing:${r.checkKey}`,
                  domain: "reliability",
                  citedReason: "Synthetic vendor probes assert core dependencies stay reachable (FW-OLU-2).",
                  alertType: "synthetic_check_failing",
                  pagePriority: "P1",
                  metadata: { checkKey: r.checkKey, status: r.status },
                }).catch(() => {/* raiseAlert is internally best-effort */});
              }
            }
          });
        },
      });
    });
  }).catch(err => {
    log(`Failed to import synthetic checks: ${err}`, "ops");
  });

  // ─── O4: persona-journey canary (every 30 min) ──
  import("./scheduler").then(({ scheduleSelfRescheduling }) => {
    log("Persona-journey canary registered (self-rescheduling, 30m)", "ops");
    scheduleSelfRescheduling({
      name: "persona_journey_canary",
      intervalMs: 30 * 60 * 1000,
      initialDelayMs: 6 * 60 * 1000, // after the vendor checks' first pass
      run: async () => {
        // 30m cadence → TTL well under it (25m).
        await withJobLock("persona_journey_canary", 25 * 60, async () => {
          const { runPersonaJourneyCanary } = await import("../services/slo");
          const run = await runPersonaJourneyCanary();
          log(
            `Persona journey: ${run.overallStatus} substrate=${run.substrate} ` +
              `steps=${run.steps.length} totalMs=${run.totalLatencyMs}`,
            "ops",
          );
          if (run.overallStatus === "failing") {
            // O5 matrix, queue lane: warning finding + system_alerts row via
            // the spine (deduped), NO page — see the module header rationale.
            const { raiseAlert } = await import("../services/alertSpine");
            const failingSteps = run.steps
              .filter((s) => s.status === "failing")
              .map((s) => s.key)
              .join(", ");
            await raiseAlert({
              severity: "warning",
              source: "persona_journey_canary",
              title: "Persona-journey canary failing",
              detail:
                `The synthetic persona journey (substrate ${run.substrate}) reported failing ` +
                `step(s): ${failingSteps || "unknown"}. Per-step rows are in synthetic_check_runs ` +
                `(checkKey persona_journey / journey_*).`,
              dedupeKey: "persona_journey_failing",
              domain: "reliability",
              citedReason:
                "P5 §2 — synthetic journeys are the outside-in sensor that the PRODUCT works, not just that the app is up.",
              alertType: "persona_journey_canary_failing",
              metadata: { substrate: run.substrate, failingSteps },
            }).catch(() => {/* raiseAlert is internally best-effort */});
          }
        });
      },
    });
  }).catch(err => {
    log(`Failed to register persona journey canary: ${err}`, "ops");
  });
}
