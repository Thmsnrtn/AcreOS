import { type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  className = "",
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 px-4 ${className}`} data-testid="empty-state">
      <div className="p-4 rounded-full bg-muted/50 mb-4">
        <Icon className="w-10 h-10 text-muted-foreground/50" />
      </div>
      <h3 className="text-lg font-medium mb-2" data-testid="empty-state-title">{title}</h3>
      <p className="text-muted-foreground text-center max-w-sm mb-6" data-testid="empty-state-description">
        {description}
      </p>
      <Button onClick={onAction} data-testid="empty-state-action">
        <Plus className="w-4 h-4 mr-2" />
        {actionLabel}
      </Button>
    </div>
  );
}
