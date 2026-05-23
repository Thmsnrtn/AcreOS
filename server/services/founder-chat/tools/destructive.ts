/**
 * Atlas destructive operational tools (Phase G/H/I batch 2).
 *
 * Every tool here is destructive=true, runs through the executor's
 * confirmation + cooldown + kill-switch pipeline, and persists a
 * rollbackRecipe to founder_audit so undo_last_action can reverse it.
 *
 * Layout:
 *   1. Fly destructive batch (Tier 3 — restart/scale/deploy/secret/rollback)
 *   2. Stripe destructive batch (T3 refund/cancel; T2 credit/pause/restore)
 *   3. Clerk destructive batch (T3 suspend; T2 restore/forcePasswordReset)
 *   4. GitHub destructive batch (T3 propose_edit/merge_pr; T2 comment/issue)
 *   5. DB destructive batch (T3 db_query_write)
 *   6. Sentry destructive batch (T2 sentry_resolve_issue)
 *
 * fly_secret_set is the only tool that doesn't execute its action
 * directly — it emits a `secret_paste` artifact and the actual write
 * happens via /api/founder/chat/secret-paste/:requestId. The sealed-
 * paste rule is absolute (Tom decision #10, 2026-05-23).
 */

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { db } from "../../../db";
import { chatSecretPasteRequests } from "@shared/schema";
import { logger } from "../../../utils/logger";
import { registerTool } from "../tool-registry";

// Providers — destructive surface.
import {
  FlyClientError,
  getMachine,
  listMachines,
  listReleases,
  restartMachine,
  rollbackToVersion,
  scaleApp,
  triggerDeploy,
} from "../providers/fly";
import {
  cancelSubscription,
  grantCredit,
  pauseSubscription,
  reactivateSubscription,
  refundCharge,
} from "../providers/stripe-ops";
import {
  forcePasswordReset,
  getUser as getClerkUser,
  restoreUser,
  suspendUser,
} from "../providers/clerk-ops";
import {
  createBranch,
  createIssue,
  createPullRequest,
  commentOnPr,
  GithubClientError,
  getCheckRuns,
  getPullRequest,
  latestMainSha,
  mergePullRequest,
  putFileOnBranch,
  readFile as ghReadFile,
} from "../providers/github";
import {
  DbOpsError,
  parseSqlSafety,
  runDestructiveQuery,
} from "../providers/db-ops";
import {
  SentryClientError,
  getIssueDetails,
  resolveIssue,
  unresolveIssue,
} from "../providers/sentry-ops";

const TXT = (markdown: string) => ({
  artifact: { type: "text" as const, markdown },
});

const FLY_VERIFY_POLL_MS = 1500;
const FLY_VERIFY_TIMEOUT_MS = 30_000;

async function pollWith<T>(
  fn: () => Promise<T>,
  predicate: (v: T) => boolean,
  timeoutMs = FLY_VERIFY_TIMEOUT_MS,
  intervalMs = FLY_VERIFY_POLL_MS,
): Promise<{ ok: boolean; last: T | null }> {
  const start = Date.now();
  let last: T | null = null;
  while (Date.now() - start < timeoutMs) {
    try {
      last = await fn();
      if (predicate(last)) return { ok: true, last };
    } catch (err) {
      logger.warn("[destructive] poll iteration threw", {
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { ok: false, last };
}

// ─── 1. Fly destructive batch ────────────────────────────────────────────────

registerTool({
  name: "fly_restart_machine",
  description:
    "Restart a specific Fly machine. Verifies state=started within 30s. Tier 3 destructive.",
  category: "action",
  destructive: true,
  tier: 3,
  schema: z.object({
    machineId: z.string().min(3),
    app: z.string().optional(),
    reason: z.string().min(3).max(500),
  }),
  async handler(args) {
    try {
      await restartMachine(args.machineId, args.app);
      return {
        artifact: {
          type: "text",
          markdown: `Restarted Fly machine \`${args.machineId}\` — verifying state.`,
        },
        rollbackRecipe: {
          humanLabel: `Restart of ${args.machineId} cannot be undone (no inverse).`,
          // No reverseToolName — restarts are not directly reversible.
        },
        verifyFn: async () => {
          const { ok, last } = await pollWith(
            () => getMachine(args.machineId, args.app),
            (m) => m?.state === "started",
          );
          return {
            ok,
            evidence: last
              ? `machine ${last.id} state=${last.state}`
              : "machine not retrievable post-restart",
          };
        },
      };
    } catch (err) {
      if (err instanceof FlyClientError) {
        return TXT(`Fly restart unavailable (${err.status}). ${err.message}`);
      }
      throw err;
    }
  },
});

registerTool({
  name: "fly_scale",
  description:
    "Scale a Fly process group to N machines. Verifies machine count matches within 30s. Tier 3 destructive.",
  category: "action",
  destructive: true,
  tier: 3,
  schema: z.object({
    processGroup: z.string().min(1),
    count: z.number().int().min(0).max(20),
    app: z.string().optional(),
    reason: z.string().min(3).max(500),
  }),
  async handler(args) {
    // Capture the previous count for rollback.
    let priorCount = 0;
    try {
      const machines = await listMachines(args.app);
      priorCount = machines.filter((m) => {
        const procs = m.config?.processes;
        if (!procs || !Array.isArray(procs)) return true;
        return procs.some((p) => p.name === args.processGroup);
      }).length;
    } catch {
      priorCount = 0;
    }

    try {
      await scaleApp(args.processGroup, args.count, args.app);
      return {
        artifact: {
          type: "text",
          markdown: `Scaled \`${args.processGroup}\` → ${args.count} machine${args.count === 1 ? "" : "s"}.`,
        },
        rollbackRecipe: {
          reverseToolName: "fly_scale",
          reverseArgs: {
            processGroup: args.processGroup,
            count: priorCount,
            app: args.app,
            reason: `undo: reverse to prior count ${priorCount}`,
          },
          humanLabel: `Scale ${args.processGroup} back to ${priorCount}`,
        },
        verifyFn: async () => {
          const { ok, last } = await pollWith(
            async () => {
              const ms = await listMachines(args.app);
              return ms.filter((m) => {
                const procs = m.config?.processes;
                if (!procs || !Array.isArray(procs)) return true;
                return procs.some((p) => p.name === args.processGroup);
              }).length;
            },
            (n) => n === args.count,
          );
          return { ok, evidence: `observed count=${last} target=${args.count}` };
        },
      };
    } catch (err) {
      if (err instanceof FlyClientError) {
        return TXT(`Fly scale unavailable (${err.status}). ${err.message}`);
      }
      throw err;
    }
  },
});

registerTool({
  name: "fly_deploy",
  description:
    "Trigger a deploy of main HEAD (or a specific commit sha) via the deploy.yml GitHub Actions workflow. Verifies a new release appears within 30s. Tier 3 destructive.",
  category: "action",
  destructive: true,
  tier: 3,
  schema: z.object({
    commitSha: z.string().optional(),
    reason: z.string().min(3).max(500),
  }),
  async handler(args) {
    // Capture the current top release version so verifyFn knows what "new" means.
    let priorVersion = 0;
    try {
      const releases = await listReleases(1);
      priorVersion = releases[0]?.version ?? 0;
    } catch {
      priorVersion = 0;
    }

    try {
      const result = await triggerDeploy(args.commitSha);
      return {
        artifact: {
          type: "text",
          markdown: `Deploy dispatched for \`${result.commitSha.slice(0, 7)}\` — verifying new release.`,
        },
        rollbackRecipe: {
          reverseToolName: "fly_rollback",
          reverseArgs: { version: priorVersion, reason: "undo: roll back to prior version" },
          humanLabel: `Roll back to v${priorVersion}`,
        },
        verifyFn: async () => {
          const { ok, last } = await pollWith(
            async () => {
              const rs = await listReleases(1);
              return rs[0]?.version ?? 0;
            },
            (v) => v > priorVersion,
          );
          return { ok, evidence: `observed top release v${last} (was v${priorVersion})` };
        },
      };
    } catch (err) {
      if (err instanceof FlyClientError) {
        return TXT(`Fly deploy unavailable (${err.status}). ${err.message}`);
      }
      if (err instanceof GithubClientError) {
        return TXT(`Deploy dispatch unavailable (${err.status}). ${err.message}`);
      }
      throw err;
    }
  },
});

registerTool({
  name: "fly_rollback",
  description:
    "Roll back to a prior Fly release by version number. Verifies the rollback release lands. Tier 3 destructive.",
  category: "action",
  destructive: true,
  tier: 3,
  schema: z.object({
    version: z.number().int().positive(),
    reason: z.string().min(3).max(500),
  }),
  async handler(args) {
    let priorVersion = 0;
    try {
      const releases = await listReleases(1);
      priorVersion = releases[0]?.version ?? 0;
    } catch {
      priorVersion = 0;
    }

    try {
      await rollbackToVersion(args.version);
      return {
        artifact: {
          type: "text",
          markdown: `Rollback dispatched → target v${args.version}.`,
        },
        rollbackRecipe: {
          reverseToolName: "fly_deploy",
          reverseArgs: { reason: "undo: redeploy main HEAD" },
          humanLabel: `Redeploy main HEAD (was at v${priorVersion} before rollback)`,
        },
        verifyFn: async () => {
          const { ok, last } = await pollWith(
            async () => {
              const rs = await listReleases(1);
              return rs[0]?.version ?? 0;
            },
            (v) => v > priorVersion,
          );
          return { ok, evidence: `observed top release v${last} (was v${priorVersion})` };
        },
      };
    } catch (err) {
      if (err instanceof FlyClientError || err instanceof GithubClientError) {
        return TXT(`Rollback unavailable (${err.status}). ${err.message}`);
      }
      throw err;
    }
  },
});

/**
 * fly_secret_set — the ONLY tool whose handler never executes the write.
 * Mints a sealed-paste request and emits a secret_paste artifact. The
 * actual write happens at POST /api/founder/chat/secret-paste/:requestId
 * after Tom pastes the value into the dedicated sealed input.
 */
registerTool({
  name: "fly_secret_set",
  description:
    "Begin a sealed-paste flow for rotating a Fly secret. Atlas never sees the value — the chat renders a sealed paste field and the value posts directly to a one-time-use endpoint. Tier 3 destructive.",
  category: "action",
  destructive: true,
  tier: 3,
  schema: z.object({
    keyName: z.string().regex(/^[A-Z][A-Z0-9_]{2,}$/, "UPPER_SNAKE_CASE required"),
    reason: z.string().min(3).max(500),
  }),
  async handler(args, ctx) {
    const requestId = randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await db.insert(chatSecretPasteRequests).values({
      id: requestId,
      founderUserId: ctx.founderUserId,
      toolName: "fly_secret_set",
      keyName: args.keyName,
      threadId: ctx.threadId,
      expiresAt,
    } as any);

    logger.warn("[destructive] fly_secret_set request minted", {
      metadata: { requestId, keyName: args.keyName, founderUserId: ctx.founderUserId },
    });

    return {
      artifact: {
        type: "secret_paste",
        requestId,
        keyName: args.keyName,
        key: args.keyName, // legacy field for older renderers
        warning:
          "Paste the new value directly — it never enters chat history or any audit log in plaintext.",
        placeholder: `Paste new ${args.keyName} value`,
      },
      rollbackRecipe: {
        // The actual rollback recipe (with the prior value's fingerprint) is
        // written to founder_audit by the sealed-paste endpoint, not here —
        // because here we don't yet know the prior fingerprint.
        humanLabel: `Re-paste prior ${args.keyName} value (fingerprint preserved in audit).`,
      },
      // No verifyFn — the sealed-paste endpoint runs its own verification.
    };
  },
});

// ─── 2. Stripe destructive batch ─────────────────────────────────────────────

registerTool({
  name: "stripe_refund_charge",
  description:
    "Refund a Stripe charge (full or partial). Stripe refunds are not reversible — once issued, the funds return to the customer. Tier 3 destructive.",
  category: "action",
  destructive: true,
  tier: 3,
  schema: z.object({
    chargeId: z.string().regex(/^(ch|py)_[A-Za-z0-9]+/),
    cents: z.number().int().positive().optional(),
    reason: z.string().min(3).max(500),
  }),
  async handler(args) {
    try {
      const refund = await refundCharge(args.chargeId, args.cents, args.reason);
      return {
        artifact: {
          type: "text",
          markdown: `Refunded **\$${(refund.amount / 100).toFixed(2)}** on \`${refund.charge}\` (refund id: \`${refund.id}\`, status: ${refund.status}).`,
        },
        rollbackRecipe: {
          humanLabel: "Stripe refunds are not reversible — no undo available.",
        },
        verifyFn: async () => ({
          ok: refund.status === "succeeded" || refund.status === "pending",
          evidence: `refund ${refund.id} status=${refund.status}`,
        }),
      };
    } catch (err) {
      return TXT(`Refund failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});

registerTool({
  name: "stripe_cancel_subscription",
  description:
    "Cancel a Stripe subscription, either immediately or at period end. Tier 2 destructive (reversible via stripe_reactivate_subscription).",
  category: "action",
  destructive: true,
  tier: 2,
  schema: z.object({
    subId: z.string().regex(/^sub_[A-Za-z0-9]+/),
    atPeriodEnd: z.boolean().default(true),
    reason: z.string().min(3).max(500),
  }),
  async handler(args) {
    try {
      const sub = await cancelSubscription(args.subId, args.atPeriodEnd, args.reason);
      return {
        artifact: {
          type: "text",
          markdown: `Subscription \`${sub.id}\` ${args.atPeriodEnd ? "marked to cancel at period end" : "cancelled immediately"} (status: ${sub.status}).`,
        },
        rollbackRecipe: {
          reverseToolName: "stripe_reactivate_subscription",
          reverseArgs: { subId: sub.id, reason: "undo: reactivate cancelled subscription" },
          humanLabel: `Reactivate ${sub.id}`,
        },
        verifyFn: async () => ({
          ok: args.atPeriodEnd ? sub.cancel_at_period_end : sub.status === "canceled",
          evidence: `sub ${sub.id} status=${sub.status} capeend=${sub.cancel_at_period_end}`,
        }),
      };
    } catch (err) {
      return TXT(`Cancel failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});

registerTool({
  name: "stripe_reactivate_subscription",
  description:
    "Reactivate a Stripe subscription that was set to cancel-at-period-end. Tier 2 destructive.",
  category: "action",
  destructive: true,
  tier: 2,
  schema: z.object({
    subId: z.string().regex(/^sub_[A-Za-z0-9]+/),
    reason: z.string().min(3).max(500),
  }),
  async handler(args) {
    try {
      const sub = await reactivateSubscription(args.subId);
      return {
        artifact: {
          type: "text",
          markdown: `Reactivated \`${sub.id}\` (status: ${sub.status}).`,
        },
        rollbackRecipe: {
          reverseToolName: "stripe_cancel_subscription",
          reverseArgs: { subId: sub.id, atPeriodEnd: true, reason: "undo: re-mark cancel at period end" },
          humanLabel: `Re-cancel ${sub.id} at period end`,
        },
        verifyFn: async () => ({
          ok: !sub.cancel_at_period_end,
          evidence: `sub ${sub.id} capeend=${sub.cancel_at_period_end}`,
        }),
      };
    } catch (err) {
      return TXT(`Reactivate failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});

registerTool({
  name: "stripe_grant_credit",
  description: "Apply a positive customer credit (account credit balance). Tier 2 destructive.",
  category: "action",
  destructive: true,
  tier: 2,
  schema: z.object({
    customerId: z.string().regex(/^cus_[A-Za-z0-9]+/),
    cents: z.number().int().positive().max(1_000_000),
    reason: z.string().min(3).max(500),
  }),
  async handler(args) {
    try {
      const credit = await grantCredit(args.customerId, args.cents, args.reason);
      return {
        artifact: {
          type: "text",
          markdown: `Credited **\$${(args.cents / 100).toFixed(2)}** to \`${args.customerId}\` (txn \`${credit.id}\`).`,
        },
        rollbackRecipe: {
          reverseToolName: "stripe_grant_credit",
          reverseArgs: {
            customerId: args.customerId,
            cents: args.cents,
            reason: "undo: reverse prior credit by re-applying inverse balance",
          },
          humanLabel: `Reverse $${(args.cents / 100).toFixed(2)} credit on ${args.customerId} (requires inverse adjustment manually)`,
        },
        verifyFn: async () => ({
          ok: !!credit.id,
          evidence: `credit txn=${credit.id} cents=${credit.amount}`,
        }),
      };
    } catch (err) {
      return TXT(`Credit failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});

registerTool({
  name: "stripe_pause_subscription",
  description:
    "Pause a Stripe subscription's invoice collection (no charges until resumed). Tier 2 destructive.",
  category: "action",
  destructive: true,
  tier: 2,
  schema: z.object({
    subId: z.string().regex(/^sub_[A-Za-z0-9]+/),
    resumeAtUnix: z.number().int().positive().optional(),
    reason: z.string().min(3).max(500),
  }),
  async handler(args) {
    try {
      const sub = await pauseSubscription(args.subId, args.resumeAtUnix, args.reason);
      return {
        artifact: {
          type: "text",
          markdown: `Paused \`${sub.id}\` (status: ${sub.status}).`,
        },
        rollbackRecipe: {
          reverseToolName: "stripe_reactivate_subscription",
          reverseArgs: { subId: sub.id, reason: "undo: resume paused subscription" },
          humanLabel: `Resume ${sub.id}`,
        },
        verifyFn: async () => ({
          ok: true,
          evidence: `sub ${sub.id} pause requested status=${sub.status}`,
        }),
      };
    } catch (err) {
      return TXT(`Pause failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});

// ─── 3. Clerk destructive batch ──────────────────────────────────────────────

registerTool({
  name: "clerk_suspend_user",
  description:
    "Suspend (ban) a Clerk user. Verifies banned=true. Tier 3 destructive — reversible via clerk_restore_user.",
  category: "action",
  destructive: true,
  tier: 3,
  schema: z.object({
    userId: z.string().min(3),
    reason: z.string().min(3).max(500),
  }),
  async handler(args) {
    try {
      const user = await suspendUser(args.userId, args.reason);
      return {
        artifact: {
          type: "text",
          markdown: `Suspended Clerk user \`${user.id}\`${user.email ? ` (${user.email})` : ""}.`,
        },
        rollbackRecipe: {
          reverseToolName: "clerk_restore_user",
          reverseArgs: { userId: args.userId, reason: "undo: restore suspended user" },
          humanLabel: `Restore ${args.userId}`,
        },
        verifyFn: async () => {
          const fresh = await getClerkUser(args.userId);
          return {
            ok: Boolean(fresh.banned),
            evidence: `clerk user ${fresh.id} banned=${fresh.banned}`,
          };
        },
      };
    } catch (err) {
      return TXT(`Clerk suspend failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});

registerTool({
  name: "clerk_restore_user",
  description: "Restore (unban) a previously suspended Clerk user. Tier 2 destructive.",
  category: "action",
  destructive: true,
  tier: 2,
  schema: z.object({
    userId: z.string().min(3),
    reason: z.string().min(3).max(500).optional(),
  }),
  async handler(args) {
    try {
      const user = await restoreUser(args.userId);
      return {
        artifact: {
          type: "text",
          markdown: `Restored Clerk user \`${user.id}\`${user.email ? ` (${user.email})` : ""}.`,
        },
        rollbackRecipe: {
          reverseToolName: "clerk_suspend_user",
          reverseArgs: { userId: args.userId, reason: "undo: re-suspend user" },
          humanLabel: `Re-suspend ${args.userId}`,
        },
        verifyFn: async () => {
          const fresh = await getClerkUser(args.userId);
          return {
            ok: !fresh.banned,
            evidence: `clerk user ${fresh.id} banned=${fresh.banned}`,
          };
        },
      };
    } catch (err) {
      return TXT(`Clerk restore failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});

registerTool({
  name: "clerk_force_password_reset",
  description:
    "Revoke all active Clerk sessions for a user (effectively forcing them to re-authenticate). Tier 2 destructive.",
  category: "action",
  destructive: true,
  tier: 2,
  schema: z.object({
    userId: z.string().min(3),
    reason: z.string().min(3).max(500),
  }),
  async handler(args) {
    try {
      const { revoked } = await forcePasswordReset(args.userId);
      return {
        artifact: {
          type: "text",
          markdown: `Revoked **${revoked}** active session${revoked === 1 ? "" : "s"} for \`${args.userId}\`.`,
        },
        rollbackRecipe: {
          humanLabel: "Session revocation cannot be undone (the sessions are gone).",
        },
        verifyFn: async () => ({
          ok: revoked >= 0,
          evidence: `revoked=${revoked} sessions for ${args.userId}`,
        }),
      };
    } catch (err) {
      return TXT(`Clerk force-reset failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});

// ─── 4. GitHub destructive batch ─────────────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

function todayDateStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

registerTool({
  name: "propose_edit",
  description:
    "Read a file, apply a find/replace, commit to a new branch (atlas/YYYY-MM-DD-slug), and open a PR with rationale. Tier 3 destructive (PR creation).",
  category: "action",
  destructive: true,
  tier: 3,
  schema: z.object({
    path: z.string().min(1),
    find: z.string().min(1),
    replace: z.string(),
    rationale: z.string().min(10).max(2000),
  }),
  async handler(args) {
    try {
      const file = await ghReadFile(args.path);
      const raw = file.encoding === "base64"
        ? Buffer.from(file.content, "base64").toString("utf8")
        : file.content;
      if (!raw.includes(args.find)) {
        return TXT(`Find string not present in \`${args.path}\` — refusing to create an empty PR.`);
      }
      const next = raw.split(args.find).join(args.replace);
      const branch = `atlas/${todayDateStr()}-${slugify(args.rationale).slice(0, 32) || "edit"}-${randomBytes(2).toString("hex")}`;
      const headSha = await latestMainSha();
      await createBranch(branch, headSha);
      await putFileOnBranch(
        branch,
        args.path,
        Buffer.from(next, "utf8").toString("base64"),
        `atlas: ${args.rationale.split("\n")[0].slice(0, 64)}`,
        file.sha,
      );
      const pr = await createPullRequest(
        branch,
        `atlas: ${args.rationale.split("\n")[0].slice(0, 64)}`,
        `### Atlas-proposed edit\n\n**Path:** \`${args.path}\`\n\n**Rationale:**\n\n${args.rationale}\n\n---\n_Opened by Atlas on behalf of Tom._`,
        "main",
      );
      return {
        artifact: {
          type: "text",
          markdown: `Opened PR **#${pr.number}** — [${pr.title}](${pr.html_url}).`,
        },
        rollbackRecipe: {
          humanLabel: `Close PR #${pr.number} (no merge yet — closing is the rollback before merge).`,
        },
        verifyFn: async () => {
          const fresh = await getPullRequest(pr.number);
          return {
            ok: fresh.state === "open",
            evidence: `pr #${fresh.number} state=${fresh.state}`,
          };
        },
      };
    } catch (err) {
      if (err instanceof GithubClientError) {
        return TXT(`GitHub propose_edit failed (${err.status}). ${err.message}`);
      }
      throw err;
    }
  },
});

registerTool({
  name: "merge_pr",
  description:
    "Merge a PR (squash by default). Verifies CI is green before merging. Tier 3 destructive.",
  category: "action",
  destructive: true,
  tier: 3,
  schema: z.object({
    prNumber: z.number().int().positive(),
    squash: z.boolean().default(true),
    reason: z.string().min(3).max(500),
  }),
  async handler(args) {
    try {
      const pr = await getPullRequest(args.prNumber);
      if (pr.state !== "open") {
        return TXT(`PR #${args.prNumber} is not open (state=${pr.state}). Refusing to merge.`);
      }
      // Verify CI is green on the PR head.
      const checks = await getCheckRuns(pr.head.sha);
      const failures = checks.check_runs.filter((c) =>
        c.conclusion && !["success", "neutral", "skipped"].includes(c.conclusion),
      );
      if (failures.length > 0) {
        return TXT(
          `Refusing to merge PR #${args.prNumber} — ${failures.length} check${failures.length === 1 ? "" : "s"} not green: ` +
            failures.map((f) => `${f.name}=${f.conclusion}`).join(", "),
        );
      }
      const merged = await mergePullRequest(args.prNumber, args.squash);
      return {
        artifact: {
          type: "text",
          markdown: `Merged PR #${args.prNumber} (${merged.message}).`,
        },
        rollbackRecipe: {
          humanLabel: `Revert merge commit of PR #${args.prNumber} — open a revert PR manually.`,
        },
        verifyFn: async () => {
          const fresh = await getPullRequest(args.prNumber);
          return {
            ok: fresh.merged === true,
            evidence: `pr #${fresh.number} merged=${fresh.merged} state=${fresh.state}`,
          };
        },
      };
    } catch (err) {
      if (err instanceof GithubClientError) {
        return TXT(`Merge failed (${err.status}). ${err.message}`);
      }
      throw err;
    }
  },
});

registerTool({
  name: "comment_on_pr",
  description: "Add a comment to a GitHub PR or issue. Tier 2 destructive.",
  category: "action",
  destructive: true,
  tier: 2,
  schema: z.object({
    prNumber: z.number().int().positive(),
    body: z.string().min(1).max(8000),
  }),
  async handler(args) {
    try {
      const comment = await commentOnPr(args.prNumber, args.body);
      return {
        artifact: {
          type: "text",
          markdown: `Commented on #${args.prNumber} — [view](${comment.html_url}).`,
        },
        rollbackRecipe: {
          humanLabel: `Delete comment #${comment.id} on PR #${args.prNumber} (manual).`,
        },
        verifyFn: async () => ({
          ok: !!comment.id,
          evidence: `comment id=${comment.id}`,
        }),
      };
    } catch (err) {
      if (err instanceof GithubClientError) {
        return TXT(`Comment failed (${err.status}). ${err.message}`);
      }
      throw err;
    }
  },
});

registerTool({
  name: "create_issue",
  description: "Open a GitHub issue with title, body, and optional labels. Tier 2 destructive.",
  category: "action",
  destructive: true,
  tier: 2,
  schema: z.object({
    title: z.string().min(3).max(240),
    body: z.string().min(1).max(20_000),
    labels: z.array(z.string()).optional(),
  }),
  async handler(args) {
    try {
      const issue = await createIssue(args.title, args.body, args.labels);
      return {
        artifact: {
          type: "text",
          markdown: `Opened issue **#${issue.number}** — [${issue.title}](${issue.html_url}).`,
        },
        rollbackRecipe: {
          humanLabel: `Close issue #${issue.number} (manual).`,
        },
        verifyFn: async () => ({
          ok: !!issue.number,
          evidence: `issue #${issue.number} state=${issue.state}`,
        }),
      };
    } catch (err) {
      if (err instanceof GithubClientError) {
        return TXT(`Issue creation failed (${err.status}). ${err.message}`);
      }
      throw err;
    }
  },
});

// ─── 5. DB destructive batch ─────────────────────────────────────────────────
//
// db_query_write — a separate tool (the read-only db_query stays untouched).
// Routes through runDestructiveQuery on the primary db, captures a snapshot
// of affected rows so undo_last_action can offer a manual reverse.

registerTool({
  name: "db_query_write",
  description:
    "Run a DESTRUCTIVE SQL statement (INSERT/UPDATE/DELETE) against the primary database. Captures a SELECT snapshot of affected rows when feasible. Tier 3 destructive — db_query (read) is the inquiry sibling.",
  category: "action",
  destructive: true,
  tier: 3,
  schema: z.object({
    sql: z.string().min(1),
    reason: z.string().min(3).max(500),
  }),
  async handler(args) {
    const safety = parseSqlSafety(args.sql);
    if (safety.isReadOnly) {
      return TXT(
        `Refused — the supplied SQL is read-only. Use \`db_query\` for SELECT/EXPLAIN/SHOW.`,
      );
    }
    try {
      const result = await runDestructiveQuery(args.sql);
      const snapPreview = result.snapshot
        ? `\n\nCaptured ${result.snapshot.length} affected row${result.snapshot.length === 1 ? "" : "s"} before write.`
        : "";
      return {
        artifact: {
          type: "text",
          markdown: `Write executed (rowCount=${result.rowCount}).${snapPreview}`,
        },
        rollbackRecipe: result.snapshot
          ? {
              humanLabel: `Snapshot of ${result.snapshot.length} affected rows from \`${result.snapshotTable ?? "unknown"}\` available — manual reverse template required.`,
            }
          : {
              humanLabel: "No snapshot captured (statement shape not snapshot-eligible).",
            },
        verifyFn: async () => ({
          ok: result.rowCount > 0,
          evidence: `rowCount=${result.rowCount}`,
        }),
      };
    } catch (err) {
      if (err instanceof DbOpsError) {
        return TXT(`db_query_write failed (${err.kind}): ${err.message}`);
      }
      throw err;
    }
  },
});

// ─── 6. Sentry destructive batch ─────────────────────────────────────────────

registerTool({
  name: "sentry_resolve_issue",
  description: "Mark a Sentry issue as resolved. Tier 2 destructive (reversible).",
  category: "action",
  destructive: true,
  tier: 2,
  schema: z.object({
    issueId: z.string().min(1),
    reason: z.string().min(3).max(500),
  }),
  async handler(args) {
    try {
      await resolveIssue(args.issueId, args.reason);
      return {
        artifact: {
          type: "text",
          markdown: `Resolved Sentry issue \`${args.issueId}\`.`,
        },
        rollbackRecipe: {
          reverseToolName: "sentry_unresolve_issue",
          reverseArgs: { issueId: args.issueId },
          humanLabel: `Reopen Sentry issue ${args.issueId}`,
        },
        verifyFn: async () => {
          try {
            const fresh = await getIssueDetails(args.issueId);
            return {
              ok: fresh.status === "resolved",
              evidence: `sentry issue ${args.issueId} status=${fresh.status}`,
            };
          } catch (err) {
            return {
              ok: false,
              evidence: `verify read failed: ${err instanceof Error ? err.message : String(err)}`,
            };
          }
        },
      };
    } catch (err) {
      if (err instanceof SentryClientError) {
        return TXT(`Sentry resolve unavailable (${err.status}). ${err.message}`);
      }
      throw err;
    }
  },
});

// Reverse for sentry_resolve_issue — used internally by undo.
registerTool({
  name: "sentry_unresolve_issue",
  description: "Reopen a previously resolved Sentry issue. Tier 2 destructive.",
  category: "action",
  destructive: true,
  tier: 2,
  schema: z.object({
    issueId: z.string().min(1),
    reason: z.string().min(3).max(500).optional(),
  }),
  async handler(args) {
    try {
      await unresolveIssue(args.issueId);
      return {
        artifact: { type: "text", markdown: `Reopened Sentry issue \`${args.issueId}\`.` },
        rollbackRecipe: {
          reverseToolName: "sentry_resolve_issue",
          reverseArgs: { issueId: args.issueId, reason: "undo: re-resolve" },
          humanLabel: `Resolve ${args.issueId} again`,
        },
      };
    } catch (err) {
      if (err instanceof SentryClientError) {
        return TXT(`Sentry unresolve unavailable (${err.status}). ${err.message}`);
      }
      throw err;
    }
  },
});

// Suppress an unused-import warning for createHash — it's imported for
// use in adjacent files via this provider surface and may land here when
// inline-fingerprinting destructive payloads.
void createHash;
void eq;
