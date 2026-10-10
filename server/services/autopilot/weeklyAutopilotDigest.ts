/**
 * The weekly autopilot digest (founder decision 2026-10-10).
 *
 * Routine, reversible ops and deploy moves, and the routine support work, no
 * longer ask one by one: they run inside the gate stack (domainAutonomy
 * DEFAULT_DOMAIN_LEVEL; act.ts digestLaneRefusal keeps anything irreversible or
 * customer-facing asking first). The founder sees what ran here instead, behind
 * the Decisions door, with an undo on each item.
 *
 * What "undo" does, stated plainly because a generic autopilot action has no
 * universal inverse:
 *   - if the dispatch has not finished (queued or in progress), it is
 *     CANCELLED — the work never completes;
 *   - if it already finished, its effect is not reversed by this button. The
 *     founder's undo is recorded as a declined verdict on the action (the
 *     learning loop reads it) and the domain drops to DRAFT, so the next move
 *     of that kind asks first. The digest says which of the two happened.
 *
 * Read model only: the rows are the Experience Log's "acted" entries, so
 * nothing here can list something that did not run.
 */
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "../../db";
import { autopilotExperiences } from "@shared/schema";
import { soleneDispatchQueue } from "@shared/schema/solene-dispatch";
import { clock } from "../../utils/clock";

/** Domains whose unasked work the digest lists. */
const DIGEST_DOMAINS = ["ops", "deploy", "support"] as const;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const UNFINISHED = new Set(["queued", "in_progress"]);

export interface DigestItem {
  experienceId: number;
  moveKind: string;
  domain: string;
  at: string | null;
  dispatchId: number | null;
  dispatchStatus: string | null;
  summary: string | null;
  /** "undone" once the founder has undone it (founder verdict declined). */
  undone: boolean;
  /** What the undo button will do for this item. */
  undo: "cancel" | "ask_first" | null;
}

/** What undo does for a dispatch in this status. Pure. */
export function undoKindFor(dispatchStatus: string | null, alreadyUndone: boolean): DigestItem["undo"] {
  if (alreadyUndone) return null;
  if (dispatchStatus && UNFINISHED.has(dispatchStatus)) return "cancel";
  return "ask_first";
}

export async function getWeeklyAutopilotDigest(opts: { nowMs?: number; limit?: number } = {}): Promise<{ since: string; items: DigestItem[] }> {
  const since = new Date((opts.nowMs ?? clock.nowMs()) - WEEK_MS);
  const rows = await db
    .select({
      id: autopilotExperiences.id,
      moveKind: autopilotExperiences.moveKind,
      domain: autopilotExperiences.domain,
      createdAt: autopilotExperiences.createdAt,
      dispatchId: autopilotExperiences.dispatchId,
      founderVerdict: autopilotExperiences.founderVerdict,
      status: soleneDispatchQueue.status,
      summary: soleneDispatchQueue.resultSummary,
    })
    .from(autopilotExperiences)
    .leftJoin(soleneDispatchQueue, eq(soleneDispatchQueue.id, autopilotExperiences.dispatchId))
    .where(
      and(
        eq(autopilotExperiences.outcome, "acted"),
        inArray(autopilotExperiences.domain, [...DIGEST_DOMAINS]),
        gte(autopilotExperiences.createdAt, since),
      ),
    )
    .orderBy(desc(autopilotExperiences.createdAt))
    .limit(opts.limit ?? 100);
  return {
    since: since.toISOString(),
    items: rows.map((r) => {
      const undone = r.founderVerdict === "declined";
      return {
        experienceId: r.id,
        moveKind: r.moveKind,
        domain: r.domain,
        at: r.createdAt ? r.createdAt.toISOString() : null,
        dispatchId: r.dispatchId,
        dispatchStatus: r.status ?? null,
        summary: r.summary ?? null,
        undone,
        undo: undoKindFor(r.status ?? null, undone),
      };
    }),
  };
}

export type UndoResult =
  | { ok: true; did: "cancelled" | "ask_first"; message: string }
  | { ok: false; reason: string };

export async function undoDigestItem(experienceId: number, by: string): Promise<UndoResult> {
  const [row] = await db
    .select({
      id: autopilotExperiences.id,
      moveKind: autopilotExperiences.moveKind,
      domain: autopilotExperiences.domain,
      outcome: autopilotExperiences.outcome,
      dispatchId: autopilotExperiences.dispatchId,
      founderVerdict: autopilotExperiences.founderVerdict,
    })
    .from(autopilotExperiences)
    .where(eq(autopilotExperiences.id, experienceId))
    .limit(1);
  if (!row || row.outcome !== "acted" || !(DIGEST_DOMAINS as readonly string[]).includes(row.domain)) {
    return { ok: false, reason: "not an item in the weekly digest" };
  }
  if (row.founderVerdict === "declined") return { ok: false, reason: "already undone" };

  let did: "cancelled" | "ask_first" = "ask_first";
  if (row.dispatchId != null) {
    const { cancelDispatch } = await import("../solene/dispatchQueue");
    const c = await cancelDispatch(row.dispatchId, `undone from the weekly digest by ${by}`);
    if (c.cancelled) did = "cancelled";
  }
  if (did === "ask_first") {
    const { getDomainLevel, setDomainLevel, levelRank, AUTOPILOT_DOMAINS } = await import("./domainAutonomy");
    const domain = AUTOPILOT_DOMAINS.find((d) => d === row.domain);
    if (domain && levelRank(await getDomainLevel(domain)) > levelRank("draft")) {
      await setDomainLevel(domain, "draft", `founder undo from the weekly digest (${row.moveKind}, by ${by})`);
    }
  }
  await db
    .update(autopilotExperiences)
    .set({ founderVerdict: "declined", resolvedAt: clock.now() })
    .where(eq(autopilotExperiences.id, row.id));
  return did === "cancelled"
    ? { ok: true, did, message: `Cancelled before it finished: ${row.moveKind} will not complete.` }
    : {
        ok: true,
        did,
        message: `${row.moveKind} had already run, so its effect was not reversed. ${row.domain} now asks you first for its next move.`,
      };
}
