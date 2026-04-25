import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { Keyboard } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";

export function KeyboardShortcutsDialog() {
  const { shortcuts, isDialogOpen, setDialogOpen } = useKeyboardShortcuts();
  
  const shortcutList = Array.from(shortcuts.entries())
    .filter(([, s]) => s.global)
    .sort((a, b) => a[1].key.localeCompare(b[1].key));

  const navigationShortcuts = shortcutList.filter(([, s]) => s.key.startsWith("g "));
  const otherShortcuts = shortcutList.filter(([, s]) => !s.key.startsWith("g "));

  return (
    <Dialog open={isDialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="max-w-md" data-testid="dialog-keyboard-shortcuts">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" aria-hidden="true" />
            Keyboard shortcuts
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <section aria-labelledby="kbd-nav-heading">
            <h3 id="kbd-nav-heading" className="text-sm font-medium text-muted-foreground mb-3">Navigation</h3>
            <ul className="space-y-2 list-none p-0 m-0">
              {navigationShortcuts.map(([id, shortcut]) => (
                <li key={id} className="flex items-center justify-between">
                  <span className="text-sm">{shortcut.description}</span>
                  <ShortcutKeys keys={shortcut.key} />
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="kbd-actions-heading">
            <h3 id="kbd-actions-heading" className="text-sm font-medium text-muted-foreground mb-3">Actions</h3>
            <ul className="space-y-2 list-none p-0 m-0">
              {otherShortcuts.map(([id, shortcut]) => (
                <li key={id} className="flex items-center justify-between">
                  <span className="text-sm">{shortcut.description}</span>
                  <ShortcutKeys keys={shortcut.key} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ShortcutKeys({ keys }: { keys: string }) {
  const parts = keys.split(" ");
  
  return (
    <div className="flex items-center gap-1">
      {parts.map((key, index) => (
        <span key={index}>
          {index > 0 && <span className="text-muted-foreground text-xs mx-0.5">then</span>}
          <Kbd>{key === "/" ? "/" : key.toUpperCase()}</Kbd>
        </span>
      ))}
    </div>
  );
}
