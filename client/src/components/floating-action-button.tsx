import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Plus, X, Users, Map, Briefcase, Search, FileText, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface QuickAction {
  icon: typeof Plus;
  label: string;
  href?: string;
  onClick?: () => void;
  testId: string;
}

export function FloatingActionButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [, setLocation] = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);

  const quickActions: QuickAction[] = [
    {
      icon: Users,
      label: "New Lead",
      href: "/leads?action=new",
      testId: "fab-new-lead",
    },
    {
      icon: Map,
      label: "New Property",
      href: "/properties?action=new",
      testId: "fab-new-property",
    },
    {
      icon: Briefcase,
      label: "New Deal",
      href: "/deals?action=new",
      testId: "fab-new-deal",
    },
    {
      icon: FileText,
      label: "Documents",
      href: "/documents",
      testId: "fab-documents",
    },
    {
      icon: MessageSquare,
      label: "AI Assistant",
      href: "/command-center",
      testId: "fab-ai-assistant",
    },
    {
      icon: Search,
      label: "Search",
      onClick: () => {
        const searchInput = document.querySelector('[data-testid="input-global-search"]') as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
        }
        setIsOpen(false);
      },
      testId: "fab-search",
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

  return (
    <div
      ref={containerRef}
      className="fixed z-50 bottom-20 right-4 md:bottom-6 md:right-6"
      data-testid="floating-action-button-container"
    >
      {isOpen && (
        <div className="absolute bottom-16 right-0 mb-2 flex flex-col gap-2 items-end">
          {quickActions.map((action, index) => (
            <button
              key={action.testId}
              onClick={() => handleActionClick(action)}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-full bg-card border border-border shadow-lg",
                "hover-elevate active-elevate-2 transition-all duration-200",
                "animate-in slide-in-from-bottom-2 fade-in"
              )}
              style={{ animationDelay: `${index * 50}ms` }}
              data-testid={action.testId}
            >
              <span className="text-sm font-medium whitespace-nowrap">{action.label}</span>
              <action.icon className="w-5 h-5 text-primary" />
            </button>
          ))}
        </div>
      )}

      <Button
        size="lg"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "rounded-full shadow-lg transition-transform duration-200",
          isOpen && "rotate-45"
        )}
        data-testid="fab-toggle"
      >
        {isOpen ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
      </Button>
    </div>
  );
}
