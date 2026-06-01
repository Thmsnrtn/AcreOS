import { Archive, CheckCircle2 } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

/**
 * ClearedEmpty
 * --------------------------------------------------------------------------
 * Archetype #2 — "Inbox zero" feeling. Used when the user has *cleared*
 * their queue and there's nothing demanding attention right now, but
 * archived/older items still exist in the system.
 *
 * Tone: affirming and quiet. Don't oversell.
 *
 * Composes the canonical EmptyState primitive so the "required cta" contract
 * is enforced at the type level. When no `onShowArchive` is provided the cta
 * uses the _noOp escape hatch — a deliberately CTA-less cleared state is
 * a valid UI moment (nothing to do IS the message).
 */

interface ClearedEmptyProps {
  /** Headline copy. e.g. "All clear — nothing needs you right now". */
  headline: string;
  /** Optional subtitle. */
  subtitle?: string;
  /** When provided, renders a small "View archived" CTA with the count. */
  archiveCount?: number;
  /** Click handler for the archive CTA. */
  onShowArchive?: () => void;
  /** Custom label for the archive CTA (defaults to "View archived"). */
  archiveLabel?: string;
  className?: string;
}

export function ClearedEmpty({
  headline,
  subtitle,
  archiveCount,
  onShowArchive,
  archiveLabel = "View archived",
  className = "",
}: ClearedEmptyProps) {
  const ctaLabel =
    archiveCount !== undefined && archiveCount > 0
      ? `${archiveLabel} (${archiveCount.toLocaleString()})`
      : archiveLabel;

  return (
    <EmptyState
      icon={CheckCircle2}
      headline={headline}
      subtitle={subtitle}
      tone="celebratory"
      actionIcon={Archive}
      cta={
        onShowArchive
          ? {
              label: ctaLabel,
              onClick: onShowArchive,
              "data-testid": "cleared-empty-archive",
            }
          : {
              // TODO(cta): no archive handler — cleared queue is self-contained
              label: "",
              _noOp: true,
            }
      }
      className={className}
      testId="cleared-empty"
    />
  );
}
