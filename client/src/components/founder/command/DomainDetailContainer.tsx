/**
 * DomainDetailContainer — responsive host for a domain's findings detail.
 *
 * Mobile (<768px): bottom-sheet (iOS-style swipe-to-dismiss via SheetContent).
 * Desktop: centered dialog. Both render the same DomainDetail body.
 */

import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { type DomainSummary, STATUS_CLASSES } from "./logic";
import { DomainDetail } from "./DomainDetail";

interface DomainDetailContainerProps {
  summary: DomainSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  pendingAction: { id: string; kind: "acknowledge" | "resolve" } | null;
}

function HeaderContent({ summary }: { summary: DomainSummary }) {
  const cls = STATUS_CLASSES[summary.status];
  const Icon = summary.meta.icon;
  const countLabel =
    summary.openCount === 0
      ? "All clear"
      : `${summary.openCount} open finding${summary.openCount === 1 ? "" : "s"}`;
  return (
    <div className="flex items-center gap-3">
      <span
        className={cn("h-2.5 w-2.5 shrink-0 rounded-full", cls.dot)}
        aria-hidden="true"
      />
      <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <span className="block truncate text-base font-semibold text-foreground">
          {summary.meta.label}
        </span>
      </div>
      <span className="ml-auto text-xs text-muted-foreground">{countLabel}</span>
    </div>
  );
}

export function DomainDetailContainer({
  summary,
  open,
  onOpenChange,
  onAcknowledge,
  onResolve,
  pendingAction,
}: DomainDetailContainerProps) {
  const { isMobile } = useIsMobile();

  if (!summary) return null;

  const body = (
    <DomainDetail
      summary={summary}
      onAcknowledge={onAcknowledge}
      onResolve={onResolve}
      pendingAction={pendingAction}
    />
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="max-h-[85vh] overflow-y-auto rounded-t-2xl"
          data-testid="command-domain-sheet"
        >
          <SheetHeader className="text-left">
            <SheetTitle asChild>
              <div>
                <HeaderContent summary={summary} />
              </div>
            </SheetTitle>
            <SheetDescription className="text-left">
              {summary.meta.blurb}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 pb-2">{body}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
        data-testid="command-domain-dialog"
      >
        <DialogHeader>
          <DialogTitle asChild>
            <div>
              <HeaderContent summary={summary} />
            </div>
          </DialogTitle>
          <DialogDescription>{summary.meta.blurb}</DialogDescription>
        </DialogHeader>
        <div className="mt-2">{body}</div>
      </DialogContent>
    </Dialog>
  );
}
