import { type LucideIcon, ExternalLink, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Icon rendered inside the action button. Defaults to Plus;
   *  pass `null` when the action isn't a create ("Connect account",
   *  "Import CSV", etc). */
  actionIcon?: LucideIcon | null;
  className?: string;
  secondaryDescription?: string;
  learnMoreUrl?: string;
  learnMoreLabel?: string;
  tips?: string[];
  testId?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  actionIcon,
  className = "",
  secondaryDescription,
  learnMoreUrl,
  learnMoreLabel = "Learn more",
  tips,
  testId = "empty-state",
}: EmptyStateProps) {
  // Default action icon: Plus (a sensible default for most "empty" →
  // "create" flows). Caller can opt out by passing `actionIcon={null}`.
  const ActionIcon = actionIcon === null ? null : (actionIcon ?? Plus);
  return (
    <div
      className={`flex flex-col items-center justify-center py-16 px-4 ${className}`}
      data-testid={testId}
    >
      <div className="p-4 rounded-full bg-muted/60 mb-4" aria-hidden="true">
        <Icon className="w-10 h-10 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-medium mb-2" data-testid="empty-state-title">
        {title}
      </h3>
      <p
        className="text-muted-foreground text-center max-w-sm mb-2"
        data-testid="empty-state-description"
      >
        {description}
      </p>
      {secondaryDescription && (
        <p
          className="text-sm text-muted-foreground/80 text-center max-w-md mb-4"
          data-testid="empty-state-secondary-description"
        >
          {secondaryDescription}
        </p>
      )}
      {tips && tips.length > 0 && (
        <ul
          className="text-sm text-muted-foreground/90 text-left max-w-sm mb-4 space-y-1.5 list-disc pl-5"
          data-testid="empty-state-tips"
        >
          {tips.map((tip, index) => (
            <li key={index} className="marker:text-primary/60">
              {tip}
            </li>
          ))}
        </ul>
      )}
      {learnMoreUrl && (
        <a
          href={learnMoreUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary/90 hover:text-primary inline-flex items-center gap-1 mb-4 underline-offset-2 hover:underline"
          data-testid="empty-state-learn-more"
        >
          {learnMoreLabel}
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </a>
      )}
      {actionLabel && onAction && (
        <Button onClick={onAction} data-testid="empty-state-action" className="mt-2">
          {ActionIcon && <ActionIcon className="w-4 h-4 mr-2" aria-hidden="true" />}
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
