/**
 * ActionQueueTile — the things that want the founder's attention.
 *
 * Each row: tone-dot · title · meta. Whole row navigates if `href` is
 * present; an inline `↗︎` pipes the action context into Atlas instead.
 * Max 5 rows visible; if more, the tile shows "+N more" footer that
 * routes to the full queue page.
 */
import { Link } from "wouter";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { BridgeTile } from "./BridgeTile";

export interface ActionItem {
  id: string;
  title: string;
  /** Short context line — e.g. "Bucket transfer pending · $4,200". */
  meta?: string;
  /** Severity tone. Amber for "needs you," green for healthy, neutral default. */
  tone?: "neutral" | "info" | "warn";
  /** Optional route; whole row becomes a link. */
  href?: string;
  /** Optional Atlas handoff — pipes "about <title>: " into composer. */
  discussPrefill?: string;
}

export interface ActionQueueTileProps {
  items: ActionItem[];
  isLoading?: boolean;
  /** Receives the prefill string; the Bridge wires this to the composer. */
  onDiscussItem?: (prefill: string) => void;
  /** Click handler for the tile-level "discuss" affordance. */
  onDiscuss?: () => void;
  /** Cap for the rendered list (default 5). */
  maxVisible?: number;
  /** Optional href for the "+N more" footer. */
  viewAllHref?: string;
}

export function ActionQueueTile({
  items,
  isLoading,
  onDiscussItem,
  onDiscuss,
  maxVisible = 5,
  viewAllHref,
}: ActionQueueTileProps) {
  const visible = items.slice(0, maxVisible);
  const overflow = Math.max(0, items.length - maxVisible);

  return (
    <BridgeTile label="Action queue" onDiscuss={onDiscuss} testId="bridge-tile-action-queue">
      <div className="flex flex-col gap-2 p-4 md:p-5">
        <div className="flex items-center justify-between pb-1">
          <span className="text-caption uppercase tracking-[0.08em] text-muted-foreground">
            Action queue
          </span>
          <span className="font-mono text-caption text-muted-foreground/80 tabular-nums">
            {isLoading ? "—" : items.length}
          </span>
        </div>
        {isLoading ? (
          <ul className="space-y-1.5">
            {[0, 1, 2].map((i) => (
              <li key={i} className="h-10 animate-pulse rounded-card bg-muted/20" />
            ))}
          </ul>
        ) : visible.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">Nothing in the queue. You're caught up.</p>
        ) : (
          <ul className="space-y-0.5">
            {visible.map((item) => (
              <li key={item.id}>
                <ActionRow item={item} onDiscussItem={onDiscussItem} />
              </li>
            ))}
          </ul>
        )}
        {overflow > 0 && viewAllHref && (
          <Link
            href={viewAllHref}
            className="mt-1 inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            +{overflow} more <ChevronRight className="h-3 w-3" />
          </Link>
        )}
      </div>
    </BridgeTile>
  );
}

function ActionRow({
  item,
  onDiscussItem,
}: {
  item: ActionItem;
  onDiscussItem?: (prefill: string) => void;
}) {
  const tone =
    item.tone === "warn"
      ? "bg-acr-bridge-accent"
      : item.tone === "info"
        ? "bg-acr-accent"
        : "bg-muted-foreground/60";

  const inner = (
    <div className="flex items-center gap-3 rounded-card px-2 py-2 transition-colors [@media(pointer:fine)]:hover:bg-white/[0.03]">
      <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground/95">{item.title}</p>
        {item.meta && (
          <p className="truncate text-caption text-muted-foreground tabular-nums">{item.meta}</p>
        )}
      </div>
      {item.discussPrefill && onDiscussItem && (
        <button
          type="button"
          aria-label={`Discuss "${item.title}" with Atlas`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDiscussItem(item.discussPrefill!);
          }}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/60",
            "transition-colors duration-150",
            "[@media(pointer:fine)]:hover:bg-white/[0.06] [@media(pointer:fine)]:hover:text-foreground/90",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB547]/60",
          )}
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );

  return item.href ? (
    <Link href={item.href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}
