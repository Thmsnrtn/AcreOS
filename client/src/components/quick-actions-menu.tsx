import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { 
  Plus, 
  X, 
  Users, 
  Map, 
  Briefcase, 
  Bot,
  Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

interface QuickAction {
  icon: typeof Plus;
  label: string;
  href?: string;
  onClick?: () => void;
  color: string;
  testId: string;
}

export function QuickActionsMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [, setLocation] = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);
  const { isMobile } = useIsMobile();

  const quickActions: QuickAction[] = [
    {
      icon: Users,
      label: "New Lead",
      href: "/leads?action=new",
      color: "bg-blue-500 hover:bg-blue-600",
      testId: "quick-action-lead",
    },
    {
      icon: Map,
      label: "New Property",
      href: "/properties?action=new",
      color: "bg-green-500 hover:bg-green-600",
      testId: "quick-action-property",
    },
    {
      icon: Briefcase,
      label: "New Deal",
      href: "/deals?action=new",
      color: "bg-purple-500 hover:bg-purple-600",
      testId: "quick-action-deal",
    },
    {
      icon: Sparkles,
      label: "Ask Atlas",
      href: "/command-center",
      color: "bg-amber-500 hover:bg-amber-600",
      testId: "quick-action-atlas",
    },
  ];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen]);

  const handleActionClick = (action: QuickAction) => {
    if (action.onClick) {
      action.onClick();
    } else if (action.href) {
      setLocation(action.href);
    }
    setIsOpen(false);
  };

  if (!isMobile) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="fixed z-50 bottom-20 right-4 safe-area-bottom"
      data-testid="quick-actions-fab"
    >
      {isOpen && (
        <div className="absolute bottom-16 right-0 mb-2 flex flex-col-reverse gap-3">
          {quickActions.map((action, index) => (
            <button
              key={action.testId}
              onClick={() => handleActionClick(action)}
              className={cn(
                "flex items-center gap-3 pl-4 pr-3 py-2.5 rounded-full text-white shadow-lg",
                "transition-all duration-200",
                "animate-in slide-in-from-bottom-2 fade-in",
                action.color
              )}
              style={{ animationDelay: `${index * 50}ms` }}
              data-testid={action.testId}
            >
              <span className="text-sm font-medium whitespace-nowrap">{action.label}</span>
              <action.icon className="w-5 h-5" />
            </button>
          ))}
        </div>
      )}

      <Button
        size="lg"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "rounded-full shadow-lg transition-transform duration-200 h-14 w-14",
          isOpen && "rotate-45 bg-muted text-muted-foreground"
        )}
        data-testid="quick-actions-toggle"
      >
        {isOpen ? <X className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
      </Button>
    </div>
  );
}
