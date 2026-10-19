import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/contexts/theme-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AppearanceControls } from "@/components/settings/appearance-controls";
import { cn } from "@/lib/utils";

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
        <AppearanceControls compact />
      </DialogContent>
    </Dialog>
  );
}
