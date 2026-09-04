/**
 * PaxAskCard — ONE ask, rendered the same way everywhere it can be answered
 * (the Pax controls spec §4.5; frozen wave-1 contract 4).
 *
 * The four hosts — the chat message where Pax proposed it (the rail and the
 * /ai stream), the pinned "Waiting for your tap" strip on /ai, Today's
 * decision queue and the support chat — all import THIS component, and
 * tests/unit/paxAskHosts.test.ts pins that no other file renders an
 * Approve/Reject pair for a pending action. Four hosts, one wording.
 *
 * Every line on the card is server truth from GET /api/pax/needs-you
 * (server/services/paxAskSummary.ts): the verb, who it goes to, which of the
 * org's own connected identities it leaves on, the full frozen text or the
 * before → after of a record write, Pax's explanation (only when Pax gave
 * one — never a number), where the ask came from, and when it expires. The
 * client formats nothing about the ask itself.
 *
 * Taps: Approve and Reject post to the approval routes through the host's
 * handlers (usePaxAskActions); Edit opens the frozen text inline and posts a
 * revision — the server rejects the old row and inserts the new one in one
 * transaction, so the revised ask replaces this one in the queue. An expired
 * ask offers one tap back into the conversation with the request prefilled.
 * While the org is paused the card says plainly that approving still sends —
 * a tap is the human acting, and Pause never gates that.
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Verbs } from "@/lib/labels";
import { formatPaxTime, PAX_LABELS, PAX_PAUSE_COPY } from "@shared/pax-glossary";
import { usePaxPaused, type PaxAskDecisionOutcome, type PaxAskItem } from "@/hooks/usePaxNeedsYou";
import { AlertCircle, CheckCircle2, Clock, Loader2, Pencil, RotateCcw, XCircle } from "lucide-react";

export type PaxAskCardStatus =
  | "pending"
  | "deciding"
  | "executed"
  | "rejected"
  | "failed"
  | "revised"
  | "expired";

export interface PaxAskCardProps {
  /** The server-formatted ask (one item of GET /api/pax/needs-you). */
  ask: PaxAskItem;
  /** Approve: the host posts to the server and returns the outcome. */
  onApprove: (ask: PaxAskItem) => Promise<PaxAskDecisionOutcome> | void;
  /** Reject: same shape. */
  onReject: (ask: PaxAskItem) => Promise<PaxAskDecisionOutcome> | void;
  /** Edit → revise with the full revised args (the frozen args with the text replaced). */
  onRevise: (ask: PaxAskItem, args: Record<string, unknown>) => Promise<PaxAskDecisionOutcome> | void;
  /** Tighter spacing for the /ai strip and the chat bubble. */
  compact?: boolean;
  className?: string;
}

/** The keys a message-bearing tool stores its text under (mirrors paxAskSummary.messageTextOf). */
const TEXT_KEYS = ["message", "body", "content", "text"] as const;

function textKeyOf(args: Record<string, unknown> | undefined): (typeof TEXT_KEYS)[number] | null {
  if (!args) return null;
  for (const key of TEXT_KEYS) {
    if (typeof args[key] === "string" && (args[key] as string).trim().length > 0) return key;
  }
  return null;
}

/** "expires in 3h 12m" — from the row's own expiry, never a default. */
export function expiresInWords(expiresAt: string | null, now: number = Date.now()): string | null {
  if (!expiresAt) return null;
  const at = new Date(expiresAt).getTime();
  if (!Number.isFinite(at)) return null;
  const diff = at - now;
  if (diff <= 0) return null;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "expires in under a minute";
  if (minutes < 60) return `expires in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return `expires in ${hours}h${rest > 0 ? ` ${rest}m` : ""}`;
  const days = Math.floor(hours / 24);
  return `expires in ${days}d${hours % 24 > 0 ? ` ${hours % 24}h` : ""}`;
}

/** The record an ask was about, as a link — only for routes that exist. */
function sourceLink(ask: PaxAskItem): { href: string; label: string } | null {
  const ref = ask.sourceRef;
  if (!ref) return null;
  if (typeof ref.leadId === "number") return { href: `/leads/${ref.leadId}`, label: "Open lead" };
  if (typeof ref.dealId === "number") return { href: `/deals/${ref.dealId}`, label: "Open deal" };
  if (typeof ref.noteId === "number") return { href: `/notes/${ref.noteId}`, label: "Open note" };
  if (typeof ref.ticketId === "number") return { href: "/help", label: "Open support" };
  if (typeof ref.scheduledTaskId === "number") return { href: "/settings/pax", label: "Open scheduled prompts" };
  return null;
}

/** The one-tap "ask Pax to draft it again" — the original request, prefilled from the frozen ask. */
export function draftAgainHref(ask: PaxAskItem): string {
  const request = `Draft this again: ${ask.verb}${ask.to ? ` (to ${ask.to})` : ""}${ask.text ? ` — "${ask.text}"` : ""}`;
  return `/ai?prefill=${encodeURIComponent(request)}`;
}

/**
 * A field name the customer can read.
 *
 * The diff used to render `key.replace(/_/g, " ")`, which unpacks snake_case
 * and leaves camelCase untouched — so `sellerFinancingApr` was shown verbatim
 * to the operator being asked to authorise a change to their own data. This is
 * the one branch of the card that must be read most carefully, and it was the
 * branch speaking in database vocabulary.
 *
 * Known initialisms are kept upper-case rather than title-cased into "Apr",
 * which would read as the month.
 */
const FIELD_INITIALISMS = new Set([
  "apr", "apn", "arv", "avm", "dscr", "hoa", "id", "irr", "ltv", "noi", "poc", "roi", "sms", "ssn", "url", "utm", "zip",
]);

export function fieldLabel(key: string): string {
  const words = key
    .replace(/[_-]+/g, " ")
    // camelCase and PascalCase, including runs like `APRValue`.
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (FIELD_INITIALISMS.has(lower)) return lower.toUpperCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

/**
 * A field value the customer can read.
 *
 * Anything non-primitive used to fall through to `JSON.stringify`, so an
 * object or array was dumped as raw JSON inside the approval card. Lists become
 * a comma-joined sentence, empty becomes an em dash rather than "" or "null",
 * and an object that cannot be flattened says how many fields it carries rather
 * than showing its braces — the customer is being asked to authorise the
 * change, not to review a payload.
 */
export function readableValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return value.map((v) => readableValue(v)).join(", ");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "—";
    // Two or three fields read fine inline; more is a payload, and saying so
    // is more honest than showing braces the reader cannot act on.
    if (entries.length <= 3) {
      return entries.map(([k, v]) => `${fieldLabel(k)}: ${readableValue(v)}`).join(", ");
    }
    return `${entries.length} fields`;
  }
  return String(value);
}

function outcomeLine(status: PaxAskCardStatus, ask: PaxAskItem): string {
  const isSend = ask.group === "sends";
  switch (status) {
    case "pending":
      return PAX_LABELS.queue;
    case "deciding":
      return "Working…";
    case "executed":
      return isSend ? "Approved and sent" : "Approved and done";
    case "rejected":
      return isSend ? "Rejected — nothing was sent" : "Rejected — nothing was changed";
    case "failed":
      return "Not completed — still waiting for your tap";
    case "revised":
      return "Replaced by your edit — the new version is waiting for your tap";
    case "expired":
      return ask.expiredLine ?? PAX_LABELS.expiredAsk;
  }
}

export default function PaxAskCard({ ask, onApprove, onReject, onRevise, compact = false, className }: PaxAskCardProps) {
  const [decision, setDecision] = useState<{ status: PaxAskCardStatus; note?: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ask.text ?? "");
  const { paused } = usePaxPaused();

  const status: PaxAskCardStatus = decision?.status ?? (ask.status === "expired" || ask.expired ? "expired" : "pending");
  // A tap in flight. Read from the decision state, not the narrowed `status`,
  // so the edit controls (which stay mounted while a revision posts) disable.
  const busy = decision?.status === "deciding";
  const actionable = status === "pending";
  const textKey = textKeyOf(ask.args);
  const canEdit = actionable && textKey !== null && ask.args !== undefined;
  const isSend = ask.group === "sends";
  const link = sourceLink(ask);
  const expiresIn = expiresInWords(ask.expiresAt);
  const expiresAbsolute = ask.expiresAt ? formatPaxTime(new Date(ask.expiresAt)) : null;
  const verbAria = ask.verb;

  async function run(kind: "approve" | "reject") {
    setDecision({ status: "deciding" });
    const outcome = await (kind === "approve" ? onApprove(ask) : onReject(ask));
    if (!outcome) {
      // A host that returns nothing owns the lifecycle itself; fall back to the row.
      setDecision(null);
      return;
    }
    if (outcome.ok) {
      setDecision({ status: kind === "approve" ? "executed" : "rejected", note: outcome.note });
    } else {
      // The server puts a failed execution back to pending — say so, keep the taps.
      setDecision({ status: kind === "approve" ? "failed" : "pending", note: outcome.note });
    }
  }

  async function saveEdit() {
    if (!textKey || !ask.args) return;
    const trimmed = draft.trim();
    if (!trimmed || trimmed === (ask.text ?? "").trim()) {
      setEditing(false);
      return;
    }
    setDecision({ status: "deciding" });
    const outcome = await onRevise(ask, { ...ask.args, [textKey]: trimmed });
    if (!outcome) {
      setDecision(null);
      setEditing(false);
      return;
    }
    if (outcome.ok) {
      setDecision({ status: "revised" });
      setEditing(false);
    } else {
      setDecision({ status: "pending", note: outcome.note });
    }
  }

  // The failed branch keeps the buttons live: a failed ask is still yours to
  // retry, and the server's reason is attached to it.
  const showButtons = status === "pending" || status === "failed";

  // ── KEEP THE USER'S PLACE ────────────────────────────────────────────────
  // Approving unmounts the whole button row, and the Approve button is the
  // element that had focus. Focus therefore fell back to <body> and a keyboard
  // or screen-reader user lost their position in the queue entirely — after
  // the single most consequential action in the product.
  //
  // Focus moves to the card itself, which is a labelled group, so the reader
  // hears which ask resolved and Tab continues from here rather than from the
  // top of the document. Only when the buttons go away because a DECISION was
  // made: a card that mounts already-executed never had focus to lose.
  const cardRef = useRef<HTMLDivElement | null>(null);
  const hadButtons = useRef(showButtons);
  useEffect(() => {
    const lost = hadButtons.current && !showButtons;
    hadButtons.current = showButtons;
    if (!lost || !decision) return;
    const card = cardRef.current;
    if (!card) return;
    // Only if focus actually escaped — never steal it from wherever the user
    // has since moved.
    const active = document.activeElement;
    if (active && active !== document.body && card.contains(active)) return;
    if (active && active !== document.body && !card.contains(active)) return;
    card.focus();
  }, [showButtons, decision]);

  // ── THREE STATES THAT USED TO BE ONE ─────────────────────────────────────
  // pending, deciding and failed all fell through to the same "else" arm:
  // identical amber border, identical amber fill, identical AlertCircle in
  // identical amber. An ask Pax TRIED and could not complete looked exactly
  // like one nobody has tapped yet, separated only by a 12px status string.
  // On the approval surface those are the two states that must never be
  // confused.
  //
  // It also spent the warn semantic at rest: a queue of six untouched asks
  // was a solid wall of amber, leaving nothing louder for the state that
  // actually warrants alarm.
  //
  // So: pending is a NEUTRAL card carrying a single amber left edge — the way
  // an unread issue is marked, present without shouting. `failed` takes the
  // negative arm and an XCircle, because it is the one that went wrong.
  // `deciding` gets a spinner and a dimmed body, so in-flight reads as
  // in-flight rather than as "the buttons stopped working".
  const StatusIcon =
    status === "executed"
      ? CheckCircle2
      : status === "expired"
        ? Clock
        : status === "failed"
          ? XCircle
          : status === "deciding"
            ? Loader2
            : AlertCircle;

  const statusTone =
    status === "executed"
      ? "text-acr-pos"
      : status === "expired"
        ? "text-muted-foreground"
        : status === "failed"
          ? "text-acr-neg"
          : "text-acr-warn";

  return (
    <div
      ref={cardRef}
      // -1 so it is programmatically focusable without entering the tab order.
      tabIndex={-1}
      className={cn(
        "rounded-card border text-sm transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        status === "executed"
          ? "border-acr-pos/30 bg-acr-pos-soft/40"
          : status === "rejected" || status === "expired" || status === "revised"
            ? "border-border bg-muted/40"
            : status === "failed"
              ? "border-acr-neg/40 bg-acr-neg-soft/40"
              : // pending and deciding: neutral card, amber left edge only.
                "border-border bg-card border-l-2 border-l-acr-warn",
        status === "deciding" && "opacity-70",
        compact ? "p-3 space-y-2" : "p-4 space-y-3",
        className,
      )}
      data-testid={`pax-ask-card-${ask.id}`}
      data-status={status}
      role="group"
      aria-label={`${outcomeLine(status, ask)}: ${verbAria}`}
    >
      {/* Status line */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <StatusIcon
            className={cn(
              "w-3.5 h-3.5 shrink-0",
              statusTone,
              // motion-safe: the spin is information, not decoration, but a
              // viewer who asked for less motion still gets the icon and the
              // "Working…" line.
              status === "deciding" && "motion-safe:animate-spin",
            )}
            aria-hidden="true"
          />
          {/*
            aria-live so the most consequential action in the product actually
            announces. Approving flips this text from "Waiting for your tap" to
            "Working…" to "Approved and sent" and unmounts the whole button
            row — and a screen-reader user was told none of it. There was no
            live region anywhere on this card.

            polite, not assertive: the customer just pressed the button, so
            this confirms rather than interrupts. atomic so the phrase is read
            as one sentence rather than a diff of changed words.
          */}
          <span
            className="text-xs font-medium truncate"
            aria-live="polite"
            aria-atomic="true"
            data-testid={`pax-ask-status-${ask.id}`}
          >
            {outcomeLine(status, ask)}
          </span>
        </div>
        {actionable && expiresIn && (
          <span
            className="text-xs text-muted-foreground shrink-0 tabular-nums"
            title={expiresAbsolute ? `Expires ${expiresAbsolute}` : undefined}
          >
            {expiresIn}
          </span>
        )}
      </div>

      {/* The ask itself — every line from the server */}
      <div className="space-y-1">
        <p className="font-medium leading-snug" data-testid={`pax-ask-verb-${ask.id}`}>
          {ask.verb}
        </p>
        {(ask.to || ask.from) && (
          <p className="text-xs text-muted-foreground">
            {ask.to && <span>to {ask.to}</span>}
            {ask.to && ask.from && <span> · </span>}
            {ask.from && <span>from {ask.from}</span>}
          </p>
        )}
        {editing && textKey ? (
          <div className="space-y-2 pt-1">
            <label htmlFor={`pax-ask-edit-${ask.id}`} className="sr-only">
              Edit the text of: {ask.verb}
            </label>
            <Textarea
              id={`pax-ask-edit-${ask.id}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[88px] text-sm"
              data-testid={`pax-ask-edit-text-${ask.id}`}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                className="min-h-11 md:min-h-9"
                onClick={saveEdit}
                disabled={busy || !draft.trim()}
                aria-label={`Save your edit and put it back in the queue: ${verbAria}`}
                data-testid={`pax-ask-edit-save-${ask.id}`}
              >
                Save edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11 md:min-h-9"
                onClick={() => {
                  setDraft(ask.text ?? "");
                  setEditing(false);
                }}
                disabled={busy}
                aria-label={`Cancel editing: ${verbAria}`}
                data-testid={`pax-ask-edit-cancel-${ask.id}`}
              >
                {Verbs.CANCEL}
              </Button>
            </div>
          </div>
        ) : (
          ask.text && (
            <blockquote
              className={cn(
                "whitespace-pre-wrap rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm leading-relaxed",
                // Capped in BOTH modes. The height limit used to be
                // `compact &&`, and DecisionQueue mounts this card WITHOUT
                // compact — so on Today a 400-word draft rendered at full
                // length and pushed the Approve row below several screens of
                // its own quoted text. With more than one ask queued, the
                // second card's controls were unreachable without deliberate
                // scrolling. A card whose entire job is one decision at a
                // glance may not make the decision the last thing you reach.
                "overflow-y-auto",
                compact ? "max-h-40" : "max-h-64",
              )}
              data-testid={`pax-ask-text-${ask.id}`}
            >
              {ask.text}
            </blockquote>
          )
        )}
        {ask.change && !ask.text && (
          <dl className="rounded-md border border-border/60 bg-background/60 px-3 py-2 text-xs space-y-1" data-testid={`pax-ask-change-${ask.id}`}>
            {Object.entries(ask.change.after).map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <dt className="text-muted-foreground shrink-0">{fieldLabel(key)}</dt>
                <dd className="min-w-0 break-words">
                  {ask.change?.before && typeof ask.change.before === "object" && key in (ask.change.before as Record<string, unknown>) ? (
                    <>
                      <span className="line-through text-muted-foreground">
                        {readableValue((ask.change.before as Record<string, unknown>)[key])}
                      </span>
                      {" → "}
                    </>
                  ) : null}
                  {readableValue(value)}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {ask.why && (
          <p className="text-xs text-muted-foreground" data-testid={`pax-ask-why-${ask.id}`}>
            <span className="font-medium">{ask.whyLabel}:</span> {ask.why}
          </p>
        )}
        {(ask.originPhrase || link) && (
          <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2">
            {ask.originPhrase && <span>{ask.originPhrase}</span>}
            {link && (
              <Link href={link.href} className="underline underline-offset-2 hover:text-foreground min-h-11 md:min-h-0 inline-flex items-center">
                {link.label}
              </Link>
            )}
          </p>
        )}
        {!compact && actionable && (
          <p className="text-xs text-muted-foreground">{ask.waitingBecause}</p>
        )}
      </div>

      {/* Pause is never a gate on a tap — say so on the card. */}
      {paused === true && showButtons && (
        <p className="text-xs text-muted-foreground" data-testid={`pax-ask-paused-${ask.id}`}>
          {PAX_LABELS.paused} — {PAX_PAUSE_COPY.stillWorks}
        </p>
      )}

      {decision?.note && (
        <p className="text-xs text-muted-foreground" data-testid={`pax-ask-note-${ask.id}`}>
          {decision.note}
        </p>
      )}

      {/* Taps */}
      {showButtons && !editing && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="min-h-11 md:min-h-9"
            disabled={busy}
            onClick={() => run("approve")}
            aria-label={`${isSend ? "Approve and send" : "Approve"}: ${verbAria}`}
            data-testid={`pax-ask-approve-${ask.id}`}
          >
            {isSend ? "Approve & send" : "Approve"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 md:min-h-9"
            disabled={busy}
            onClick={() => run("reject")}
            aria-label={`Reject: ${verbAria}`}
            data-testid={`pax-ask-reject-${ask.id}`}
          >
            Reject
          </Button>
          {canEdit && (
            <Button
              size="sm"
              variant="ghost"
              className="min-h-11 md:min-h-9 gap-1"
              disabled={busy}
              onClick={() => setEditing(true)}
              aria-label={`${Verbs.EDIT} the text before approving: ${verbAria}`}
              data-testid={`pax-ask-edit-${ask.id}`}
            >
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              {Verbs.EDIT}
            </Button>
          )}
        </div>
      )}
      {status === "expired" && (
        <Button
          asChild
          size="sm"
          variant="outline"
          className="min-h-11 md:min-h-9 gap-1"
        >
          <Link href={draftAgainHref(ask)} aria-label={`Ask Pax to draft it again: ${verbAria}`} data-testid={`pax-ask-draft-again-${ask.id}`}>
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            Ask Pax to draft it again
          </Link>
        </Button>
      )}
    </div>
  );
}
