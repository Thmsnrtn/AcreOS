import { type LucideIcon, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  className?: string;
  secondaryDescription?: string;
  learnMoreUrl?: string;
  learnMoreLabel?: string;
  tips?: string[];
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  className = "",
  secondaryDescription,
  learnMoreUrl,
  learnMoreLabel = "Learn more",
  tips,
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 px-4 ${className}`} data-testid="empty-state">
      <div className="p-4 rounded-full bg-muted/50 mb-4">
        <Icon className="w-10 h-10 text-muted-foreground/50" />
      </div>
      <h3 className="text-lg font-medium mb-2" data-testid="empty-state-title">{title}</h3>
      <p className="text-muted-foreground text-center max-w-sm mb-2" data-testid="empty-state-description">
        {description}
      </p>
      {secondaryDescription && (
        <p className="text-sm text-muted-foreground/80 text-center max-w-md mb-4" data-testid="empty-state-secondary-description">
          {secondaryDescription}
        </p>
      )}
      {tips && tips.length > 0 && (
        <ul className="text-sm text-muted-foreground/80 text-left max-w-sm mb-4 space-y-1" data-testid="empty-state-tips">
          {tips.map((tip, index) => (
            <li key={index} className="flex items-start gap-2">
              <span className="text-primary/70 mt-0.5">-</span>
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      )}
      {learnMoreUrl && (
        <a
          href={learnMoreUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary/80 hover:text-primary flex items-center gap-1 mb-4"
          data-testid="empty-state-learn-more"
        >
          {learnMoreLabel}
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
      <Button onClick={onAction} data-testid="empty-state-action" className="mt-2">
        <Plus className="w-4 h-4 mr-2" />
        {actionLabel}
      </Button>
    </div>
  );
}
