import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Users, Map, Briefcase, X, FileText, DollarSign } from "lucide-react";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { cn } from "@/lib/utils";

interface NewItemOption {
  icon: typeof Users;
  label: string;
  description: string;
  href: string;
  color: string;
  testId: string;
}

const newItemOptions: NewItemOption[] = [
  {
    icon: Users,
    label: "New Lead",
    description: "Add a new contact or seller lead",
    href: "/leads?action=new",
    color: "bg-blue-500",
    testId: "new-item-lead",
  },
  {
    icon: Map,
    label: "New Property",
    description: "Add a property to your inventory",
    href: "/properties?action=new",
    color: "bg-green-500",
    testId: "new-item-property",
  },
  {
    icon: Briefcase,
    label: "New Deal",
    description: "Start a new acquisition or sale",
    href: "/deals?action=new",
    color: "bg-purple-500",
    testId: "new-item-deal",
  },
  {
    icon: FileText,
    label: "New Document",
    description: "Create a document from template",
    href: "/documents?action=new",
    color: "bg-amber-500",
    testId: "new-item-document",
  },
  {
    icon: DollarSign,
    label: "New Note",
    description: "Create a seller financing note",
    href: "/finance?action=new",
    color: "bg-emerald-500",
    testId: "new-item-note",
  },
];

export function NewItemMenu() {
  const { isNewMenuOpen, setNewMenuOpen } = useKeyboardShortcuts();
  const [, setLocation] = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setNewMenuOpen(false);
      }
    }

    if (isNewMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isNewMenuOpen, setNewMenuOpen]);

  const handleSelect = (href: string) => {
    setNewMenuOpen(false);
    setLocation(href);
  };

  return (
    <AnimatePresence>
      {isNewMenuOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
            onClick={() => setNewMenuOpen(false)}
            data-testid="new-item-menu-backdrop"
          />
          <motion.div
            ref={containerRef}
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-[400px] -translate-x-1/2 -translate-y-1/2 p-4"
            data-testid="new-item-menu"
          >
            <div className="rounded-xl border bg-card shadow-xl overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b">
                <div>
                  <h2 className="font-semibold">Create New</h2>
                  <p className="text-sm text-muted-foreground">
                    Choose what to create
                  </p>
                </div>
                <button
                  onClick={() => setNewMenuOpen(false)}
                  className="p-2 rounded-lg hover:bg-muted transition-colors"
                  data-testid="close-new-item-menu"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              
              <div className="p-2 space-y-1">
                {newItemOptions.map((option) => (
                  <button
                    key={option.testId}
                    onClick={() => handleSelect(option.href)}
                    className={cn(
                      "w-full flex items-center gap-3 p-3 rounded-lg text-left",
                      "hover-elevate active-elevate-2 transition-all"
                    )}
                    data-testid={option.testId}
                  >
                    <div className={cn(
                      "w-10 h-10 rounded-lg flex items-center justify-center text-white",
                      option.color
                    )}>
                      <option.icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{option.label}</div>
                      <div className="text-sm text-muted-foreground truncate">
                        {option.description}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              
              <div className="p-3 border-t text-center">
                <span className="text-xs text-muted-foreground">
                  Press{" "}
                  <kbd className="px-[6px] py-0.5 rounded border bg-muted font-mono text-[10px]">
                    ⌘N
                  </kbd>{" "}
                  to toggle this menu
                </span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
