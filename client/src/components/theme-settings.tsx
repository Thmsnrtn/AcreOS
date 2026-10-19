import { lazy, Suspense } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/contexts/theme-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// The trigger mounts on every page (sidebar, phone top bar); the pickers only
// render once the dialog opens, so they load then instead of riding in the
// entry chunk (scripts/bundle-budget.json ceiling).
const AppearanceControls = lazy(() =>
  import("@/components/settings/appearance-controls").then((m) => ({ default: m.AppearanceControls })),
);

function AppearanceControlsSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <div className="space-y-2">
        <Skeleton className="h-4 w-20" />
        <div className="grid gap-2 sm:grid-cols-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-10" />
      </div>
    </div>
  );
}

/**
 * Quick appearance dialog — mounted in the page top bar. Renders the same
 * AppearanceControls as Settings → Appearance (compact), so both entry points
 * always offer identical choices. The trigger shows the current display mode.
 */
export function ThemeSettings({ className }: { className?: string }) {
  const { themeConfig, resolvedMode } = useTheme();
  const Icon = themeConfig.mode === "auto" ? Monitor : resolvedMode === "dark" ? Moon : Sun;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Appearance"
          data-testid="button-quick-appearance"
          className={cn(className)}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Appearance</DialogTitle>
          <DialogDescription>Changes apply instantly and follow you to your other devices.</DialogDescription>
        </DialogHeader>
        <Suspense fallback={<AppearanceControlsSkeleton />}>
          <AppearanceControls compact />
        </Suspense>
      </DialogContent>
    </Dialog>
  );
}
