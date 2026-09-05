/**
 * The one failure surface for the founder chat reads.
 *
 * Both reads behind the chat — the thread list and a thread's message
 * history — used to collapse any failure into `[]`, so a founder with months
 * of history saw a blank transcript and a fresh-looking account. An empty
 * MessageList reads as "no messages yet"; it is not allowed to also mean "we
 * could not read them".
 *
 * Which read failed changes what the founder is looking at, so the copy
 * branches: without the thread list there is no conversation to show at all;
 * with it, the conversation is on screen but incomplete.
 *
 * Every chat surface renders THIS component rather than its own copy of the
 * block — the Dock, the Bridge pane and the Bridge sheet all read the same
 * two queries, and a failure message that lives in only one of them is a lie
 * in the other two.
 */
import { cn } from "@/lib/utils";

export interface ChatUnavailableProps {
  /** Which read failed. Threads-failed wins when both did — with no thread list there is nothing to be incomplete. */
  variant: "threads" | "history";
  onRetry: () => void;
  /** True while the retry is in flight. */
  retrying?: boolean;
  className?: string;
}

export function ChatUnavailable({
  variant,
  onRetry,
  retrying = false,
  className,
}: ChatUnavailableProps) {
  const threads = variant === "threads";
  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid={`chat-unavailable-${variant}`}
      className={cn(
        "flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center",
        className,
      )}
    >
      <p className="text-sm font-medium">
        {threads
          ? "Couldn't load your conversations"
          : "Couldn't load this conversation's history"}
      </p>
      <p className="text-xs text-muted-foreground max-w-xs">
        {threads
          ? "This isn't an empty account — we couldn't read your threads just now."
          : "The messages above may be incomplete. This isn't an empty thread."}
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="mt-1 text-xs underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        {retrying ? "Retrying…" : "Try again"}
      </button>
    </div>
  );
}
