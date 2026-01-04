import { useState, useEffect, createContext, useContext } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { X, Lightbulb, HelpCircle, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type FeatureHint = {
  id: string;
  target: string;
  title: string;
  description: string;
  position?: "top" | "bottom" | "left" | "right";
  priority: number;
};

type HintsContextValue = {
  showTips: boolean;
  dismissedHints: string[];
  dismissHint: (id: string) => void;
  dismissAllHints: () => void;
  resetHints: () => void;
  getHintForTarget: (target: string) => FeatureHint | undefined;
};

const HintsContext = createContext<HintsContextValue | null>(null);

const FEATURE_HINTS: FeatureHint[] = [
  {
    id: "leads-overview",
    target: "leads-page",
    title: "Manage Your Leads",
    description: "Track potential sellers and buyers. Import existing contacts or add them manually.",
    position: "bottom",
    priority: 1,
  },
  {
    id: "properties-overview",
    target: "properties-page",
    title: "Property Pipeline",
    description: "Track properties from prospect to sold. Add due diligence notes and manage listings.",
    position: "bottom",
    priority: 2,
  },
  {
    id: "campaigns-overview",
    target: "campaigns-page",
    title: "Marketing Campaigns",
    description: "Create direct mail, email, and SMS campaigns to reach your target audience.",
    position: "bottom",
    priority: 3,
  },
  {
    id: "notes-overview",
    target: "notes-page",
    title: "Seller Finance Notes",
    description: "Manage seller-financed notes, track payments, and monitor your portfolio.",
    position: "bottom",
    priority: 4,
  },
  {
    id: "add-lead-btn",
    target: "button-add-lead",
    title: "Add Your First Lead",
    description: "Click here to add a new lead. You can also import leads from a CSV file.",
    position: "left",
    priority: 1,
  },
  {
    id: "add-property-btn",
    target: "button-add-property",
    title: "Add a Property",
    description: "Track properties you're interested in acquiring or have already purchased.",
    position: "left",
    priority: 2,
  },
  {
    id: "dashboard-stats",
    target: "dashboard-stats-section",
    title: "Your Performance Overview",
    description: "See key metrics at a glance: total leads, properties, pipeline value, and more.",
    position: "bottom",
    priority: 1,
  },
  {
    id: "search-leads",
    target: "input-search-leads",
    title: "Search & Filter",
    description: "Quickly find leads by name, email, or phone. Use filters to segment your data.",
    position: "bottom",
    priority: 3,
  },
];

export function HintsProvider({ children }: { children: React.ReactNode }) {
  const [dismissedHints, setDismissedHints] = useState<string[]>([]);
  
  const { data: organization } = useQuery<any>({
    queryKey: ["/api/organization"],
  });
  
  const showTips = organization?.settings?.showTips !== false;
  
  useEffect(() => {
    const stored = localStorage.getItem("dismissed_hints");
    if (stored) {
      try {
        setDismissedHints(JSON.parse(stored));
      } catch (e) {
        setDismissedHints([]);
      }
    }
  }, []);
  
  const dismissHint = (id: string) => {
    const updated = [...dismissedHints, id];
    setDismissedHints(updated);
    localStorage.setItem("dismissed_hints", JSON.stringify(updated));
  };
  
  const dismissAllHints = () => {
    const allIds = FEATURE_HINTS.map(h => h.id);
    setDismissedHints(allIds);
    localStorage.setItem("dismissed_hints", JSON.stringify(allIds));
  };
  
  const resetHints = () => {
    setDismissedHints([]);
    localStorage.removeItem("dismissed_hints");
  };
  
  const getHintForTarget = (target: string) => {
    if (!showTips) return undefined;
    const hint = FEATURE_HINTS.find(h => h.target === target);
    if (hint && !dismissedHints.includes(hint.id)) {
      return hint;
    }
    return undefined;
  };
  
  return (
    <HintsContext.Provider value={{
      showTips,
      dismissedHints,
      dismissHint,
      dismissAllHints,
      resetHints,
      getHintForTarget,
    }}>
      {children}
    </HintsContext.Provider>
  );
}

export function useHints() {
  const context = useContext(HintsContext);
  if (!context) {
    throw new Error("useHints must be used within a HintsProvider");
  }
  return context;
}

export function FeatureHint({ 
  target, 
  children 
}: { 
  target: string; 
  children: React.ReactNode;
}) {
  const { getHintForTarget, dismissHint } = useHints();
  const hint = getHintForTarget(target);
  const [isOpen, setIsOpen] = useState(false);
  
  useEffect(() => {
    if (hint) {
      const timer = setTimeout(() => {
        setIsOpen(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [hint]);
  
  if (!hint) {
    return <>{children}</>;
  }
  
  const handleDismiss = () => {
    setIsOpen(false);
    setTimeout(() => dismissHint(hint.id), 200);
  };
  
  return (
    <Tooltip open={isOpen} onOpenChange={setIsOpen}>
      <TooltipTrigger asChild>
        <div className="relative inline-block" data-testid={`hint-${target}`}>
          {children}
          <AnimatePresence>
            {isOpen && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-500 rounded-full z-10"
              />
            )}
          </AnimatePresence>
        </div>
      </TooltipTrigger>
      <TooltipContent 
        side={hint.position || "bottom"} 
        className="max-w-xs p-0"
        data-testid={`tooltip-${hint.id}`}
      >
        <Card className="border-yellow-500/30 bg-card">
          <CardContent className="p-3">
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                <span className="font-medium text-sm">{hint.title}</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 -mt-1 -mr-1"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDismiss();
                }}
                data-testid={`button-dismiss-hint-${hint.id}`}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{hint.description}</p>
          </CardContent>
        </Card>
      </TooltipContent>
    </Tooltip>
  );
}

export function HelpHint({ 
  title, 
  description,
  position = "top",
}: { 
  title: string; 
  description: string;
  position?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-5 w-5"
          data-testid="button-help-hint"
        >
          <HelpCircle className="w-3.5 h-3.5 text-muted-foreground" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side={position} className="max-w-xs">
        <div className="space-y-1">
          <p className="font-medium text-sm">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function FirstTimeVisitBanner() {
  const [dismissed, setDismissed] = useState(false);
  const [isFirstVisit, setIsFirstVisit] = useState(false);
  
  useEffect(() => {
    const visited = localStorage.getItem("has_visited");
    if (!visited) {
      setIsFirstVisit(true);
      localStorage.setItem("has_visited", "true");
    }
  }, []);
  
  if (!isFirstVisit || dismissed) {
    return null;
  }
  
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="mb-4"
        data-testid="banner-first-visit"
      >
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Lightbulb className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">Welcome to AcreOS!</p>
                <p className="text-sm text-muted-foreground">
                  Look for the yellow hints to learn about key features.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDismissed(true)}
                data-testid="button-dismiss-welcome"
              >
                Got it
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </AnimatePresence>
  );
}

export function TipsToggle() {
  const { showTips, dismissAllHints, resetHints } = useHints();
  
  const updateSettingsMutation = useMutation({
    mutationFn: async (showTips: boolean) => {
      const res = await apiRequest("PATCH", "/api/organization/settings", { showTips });
      if (!res.ok) throw new Error("Failed to update settings");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
    },
  });
  
  const handleToggle = () => {
    const newValue = !showTips;
    updateSettingsMutation.mutate(newValue);
    if (!newValue) {
      dismissAllHints();
    } else {
      resetHints();
    }
  };
  
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="font-medium">Feature Tips</p>
        <p className="text-sm text-muted-foreground">
          Show helpful tooltips for features
        </p>
      </div>
      <Button
        variant={showTips ? "default" : "outline"}
        size="sm"
        onClick={handleToggle}
        disabled={updateSettingsMutation.isPending}
        data-testid="button-toggle-tips"
      >
        {showTips ? "Tips On" : "Tips Off"}
      </Button>
    </div>
  );
}
