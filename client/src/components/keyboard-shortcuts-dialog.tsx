import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { Keyboard } from "lucide-react";

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
            <Keyboard className="h-5 w-5" />
            Keyboard Shortcuts
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Navigation</h3>
            <div className="space-y-2">
              {navigationShortcuts.map(([id, shortcut]) => (
                <div key={id} className="flex items-center justify-between">
                  <span className="text-sm">{shortcut.description}</span>
                  <ShortcutKeys keys={shortcut.key} />
                </div>
              ))}
            </div>
          </div>
          
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Actions</h3>
            <div className="space-y-2">
              {otherShortcuts.map(([id, shortcut]) => (
                <div key={id} className="flex items-center justify-between">
                  <span className="text-sm">{shortcut.description}</span>
                  <ShortcutKeys keys={shortcut.key} />
                </div>
              ))}
            </div>
          </div>
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
          <kbd className="px-2 py-1 text-xs font-mono bg-muted border rounded shadow-sm">
            {key === "/" ? "/" : key.toUpperCase()}
          </kbd>
        </span>
      ))}
    </div>
  );
}
