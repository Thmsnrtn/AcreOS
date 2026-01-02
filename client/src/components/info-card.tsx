import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Info, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface InfoCardProps {
  icon?: ReactNode;
  title: string;
  description: string;
  details?: string;
  learnMoreUrl?: string;
  learnMoreText?: string;
  className?: string;
  "data-testid"?: string;
}

export function InfoCard({
  icon,
  title,
  description,
  details,
  learnMoreUrl,
  learnMoreText = "Learn more",
  className,
  "data-testid": testId,
}: InfoCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      className={cn(
        "rounded-md border border-border/50 bg-muted/30 p-4",
        className
      )}
      data-testid={testId}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5 text-muted-foreground">
          {icon || <Info className="w-4 h-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-foreground">{title}</h4>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>

          {details && (
            <Collapsible open={isOpen} onOpenChange={setIsOpen}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto p-0 mt-2 text-xs text-muted-foreground"
                  data-testid={testId ? `${testId}-toggle` : undefined}
                >
                  {isOpen ? (
                    <>
                      <ChevronUp className="w-3 h-3 mr-1" />
                      Show less
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3 h-3 mr-1" />
                      Show more
                    </>
                  )}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <p
                  className="text-sm text-muted-foreground mt-2 pt-2 border-t border-border/50"
                  data-testid={testId ? `${testId}-details` : undefined}
                >
                  {details}
                </p>
              </CollapsibleContent>
            </Collapsible>
          )}

          {learnMoreUrl && (
            <a
              href={learnMoreUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-2"
              data-testid={testId ? `${testId}-learn-more` : undefined}
            >
              {learnMoreText}
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
