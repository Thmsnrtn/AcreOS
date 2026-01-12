import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { Keyboard, Navigation, Zap, Bot, Command, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ShortcutCategory {
  name: string;
  icon: typeof Keyboard;
  shortcuts: Array<{ key: string; description: string }>;
}

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    name: "Navigation",
    icon: Navigation,
    shortcuts: [
      { key: "g h", description: "Go to Home/Dashboard" },
      { key: "g l", description: "Go to Leads" },
      { key: "g p", description: "Go to Properties" },
      { key: "g d", description: "Go to Deals" },
      { key: "g f", description: "Go to Finance" },
      { key: "g a", description: "Go to AI Command Center" },
      { key: "g s", description: "Go to Settings" },
    ],
  },
  {
    name: "Actions",
    icon: Zap,
    shortcuts: [
      { key: "⌘ K", description: "Open command palette" },
      { key: "⌘ N", description: "New item (context-aware)" },
      { key: "⌘ /", description: "Toggle sidebar" },
      { key: "⌘ ?", description: "Open help panel" },
      { key: "/", description: "Focus search" },
      { key: "Esc", description: "Close modal/dialog" },
    ],
  },
  {
    name: "AI",
    icon: Bot,
    shortcuts: [
      { key: "⌘ J", description: "Open AI assistant" },
      { key: "g a", description: "Go to AI Command Center" },
    ],
  },
  {
    name: "Help",
    icon: HelpCircle,
    shortcuts: [
      { key: "⌘ ?", description: "Open help panel" },
      { key: "g h", description: "Go to Help & Support page" },
    ],
  },
];

export function KeyboardShortcutsModal() {
  const { isDialogOpen, setDialogOpen, shortcuts } = useKeyboardShortcuts();
  
  const registeredShortcuts = Array.from(shortcuts.entries())
    .filter(([, s]) => s.global)
    .map(([id, s]) => ({ id, ...s }));

  return (
    <Dialog open={isDialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent 
        className="max-w-lg max-h-[80vh]" 
        data-testid="keyboard-shortcuts-modal"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            Keyboard Shortcuts
            <Badge variant="secondary" className="ml-2">Power User</Badge>
          </DialogTitle>
        </DialogHeader>
        
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-6">
            {SHORTCUT_CATEGORIES.map((category) => (
              <div key={category.name}>
                <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                  <category.icon className="h-4 w-4" />
                  {category.name}
                </h3>
                <div className="space-y-2">
                  {category.shortcuts.map((shortcut, index) => (
                    <div 
                      key={index} 
                      className="flex items-center justify-between py-1"
                    >
                      <span className="text-sm">{shortcut.description}</span>
                      <ShortcutKeys keys={shortcut.key} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            
            {registeredShortcuts.length > 0 && (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                  <Command className="h-4 w-4" />
                  Custom Shortcuts
                </h3>
                <div className="space-y-2">
                  {registeredShortcuts
                    .filter(s => !SHORTCUT_CATEGORIES.some(c => 
                      c.shortcuts.some(cs => cs.key.toLowerCase().includes(s.key))
                    ))
                    .map((shortcut) => (
                      <div 
                        key={shortcut.id} 
                        className="flex items-center justify-between py-1"
                      >
                        <span className="text-sm">{shortcut.description}</span>
                        <ShortcutKeys keys={shortcut.key} />
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
        
        <div className="border-t pt-4 text-center text-xs text-muted-foreground">
          Press <kbd className="px-1.5 py-0.5 rounded border bg-muted font-mono text-[10px]">?</kbd> anytime to show this dialog
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
        <span key={index} className="flex items-center gap-1">
          {index > 0 && <span className="text-muted-foreground text-xs">then</span>}
          <kbd className="px-2 py-1 text-xs font-mono bg-muted border rounded shadow-sm min-w-[24px] text-center">
            {formatKey(key)}
          </kbd>
        </span>
      ))}
    </div>
  );
}

function formatKey(key: string): string {
  const keyMap: Record<string, string> = {
    "⌘": "⌘",
    "cmd": "⌘",
    "ctrl": "⌃",
    "alt": "⌥",
    "shift": "⇧",
    "esc": "Esc",
  };
  return keyMap[key.toLowerCase()] || key.toUpperCase();
}

export { KeyboardShortcutsModal as KeyboardShortcutsReference };
