import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Archive } from "lucide-react";

/**
 * ClearedEmpty
 * --------------------------------------------------------------------------
 * Archetype #2 — "Inbox zero" feeling. Used when the user has *cleared*
 * their queue and there's nothing demanding attention right now, but
 * archived/older items still exist in the system.
 *
 * Tone: affirming and quiet. Don't oversell.
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
  return (
    <Card
      className={`border-dashed bg-acr-pos-soft/40 ${className}`}
      data-testid="cleared-empty"
    >
      <CardContent className="flex flex-col items-center justify-center py-12 px-6 text-center">
        <div
          className="mb-4 p-3 rounded-full bg-background border border-border"
          aria-hidden="true"
        >
          <CheckCircle2 className="w-8 h-8 text-acr-pos" />
        </div>

        <h3
          className="text-base font-semibold mb-1.5 text-foreground"
          data-testid="cleared-empty-title"
        >
          {headline}
        </h3>
        {subtitle && (
          <p
            className="text-sm text-muted-foreground max-w-sm mb-4"
            data-testid="cleared-empty-subtitle"
          >
            {subtitle}
          </p>
        )}

        {onShowArchive && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onShowArchive}
            aria-label={
              archiveCount !== undefined
                ? `${archiveLabel} (${archiveCount} item${archiveCount === 1 ? "" : "s"})`
                : archiveLabel
            }
            data-testid="cleared-empty-archive"
            className="gap-1.5"
          >
            <Archive className="w-3.5 h-3.5" aria-hidden="true" />
            {archiveLabel}
            {archiveCount !== undefined && archiveCount > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">
                ({archiveCount.toLocaleString()})
              </span>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
