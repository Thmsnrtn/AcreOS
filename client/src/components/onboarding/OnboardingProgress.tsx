import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLeads } from "@/hooks/use-leads";
import { useProperties } from "@/hooks/use-properties";
import { useDeals } from "@/hooks/use-deals";
import { useOrganization, useUpdateOrganization } from "@/hooks/use-organization";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { 
  Users, 
  Map, 
  Handshake, 
  CreditCard, 
  Bot,
  CheckCircle2, 
  Circle,
  ArrowRight, 
  X, 
  Sparkles,
  PartyPopper
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface ChecklistItem {
  id: string;
  title: string;
  description: string;
  icon: typeof Users;
  href: string;
  isComplete: boolean;
}

type OnboardingStatus = {
  completed: boolean;
  currentStep: number;
  data: {
    businessType?: string;
    completedSteps?: number[];
    skippedSteps?: number[];
    stripeConnected?: boolean;
  };
  totalSteps: number;
};

function Confetti() {
  const colors = ["#f472b6", "#60a5fa", "#34d399", "#fbbf24", "#a78bfa"];
  const particles = Array.from({ length: 50 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    delay: Math.random() * 0.5,
    duration: 1 + Math.random() * 2,
    color: colors[Math.floor(Math.random() * colors.length)],
    size: 4 + Math.random() * 8,
  }));

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((particle) => (
        <motion.div
          key={particle.id}
          className="absolute rounded-full"
          style={{
            left: `${particle.x}%`,
            width: particle.size,
            height: particle.size,
            backgroundColor: particle.color,
          }}
          initial={{ y: -20, opacity: 1, rotate: 0 }}
          animate={{ 
            y: 200, 
            opacity: 0, 
            rotate: 360,
            x: (Math.random() - 0.5) * 100 
          }}
          transition={{
            duration: particle.duration,
            delay: particle.delay,
            ease: "easeOut",
          }}
        />
      ))}
    </div>
  );
}

export function OnboardingProgress() {
  const { data: organization } = useOrganization();
  const { data: leads = [] } = useLeads();
  const { data: properties = [] } = useProperties();
  const { data: deals = [] } = useDeals();
  const updateOrg = useUpdateOrganization();
  const { toast } = useToast();
  const [showConfetti, setShowConfetti] = useState(false);
  const [previousProgress, setPreviousProgress] = useState(0);

  const { data: onboardingStatus } = useQuery<OnboardingStatus>({
    queryKey: ["/api/onboarding/status"],
    enabled: !!organization,
    onError: (err) => {
      console.error("Failed to load onboarding status:", err);
      toast({
        title: "Failed to load onboarding status",
        description: "Some onboarding data may not be up to date.",
        variant: "destructive",
      });
    },
  });

  const settings = organization?.settings as Record<string, unknown> | null;
  const showTips = settings?.showTips !== false;
  const checklistDismissed = settings?.checklistDismissed === true;

  const stripeConnected = organization?.stripeCustomerId != null || 
    (onboardingStatus?.data?.stripeConnected === true);

  const checklistItems: ChecklistItem[] = [
    {
      id: "lead",
      title: "Add your first lead",
      description: "Import or create a seller/buyer lead",
      icon: Users,
      href: "/leads",
      isComplete: leads.length > 0,
    },
    {
      id: "property",
      title: "Create a property",
      description: "Add a property to track",
      icon: Map,
      href: "/properties",
      isComplete: properties.length > 0,
    },
    {
      id: "deal",
      title: "Start a deal",
      description: "Track an acquisition or sale",
      icon: Handshake,
      href: "/deals",
      isComplete: deals.length > 0,
    },
    {
      id: "stripe",
      title: "Connect Stripe",
      description: "Enable payments (optional)",
      icon: CreditCard,
      href: "/settings?tab=integrations",
      isComplete: stripeConnected,
    },
    {
      id: "atlas",
      title: "Chat with Atlas AI",
      description: "Try the AI assistant",
      icon: Bot,
      href: "/command-center",
      isComplete: (onboardingStatus?.data?.completedSteps?.includes(4) || false),
    },
  ];

  const completedCount = checklistItems.filter((item) => item.isComplete).length;
  const progress = (completedCount / checklistItems.length) * 100;
  const allComplete = completedCount === checklistItems.length;

  useEffect(() => {
    if (progress === 100 && previousProgress < 100 && previousProgress > 0) {
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3000);
    }
    setPreviousProgress(progress);
  }, [progress, previousProgress]);

  const handleDismiss = async () => {
    await updateOrg.mutateAsync({
      settings: {
        ...(organization?.settings || {}),
        checklistDismissed: true,
      },
    });
  };

  if (!showTips || checklistDismissed) {
    return null;
  }

  if (onboardingStatus?.completed && allComplete) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="relative overflow-hidden" data-testid="onboarding-progress">
        {showConfetti && <Confetti />}
        
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-3 right-3 z-10"
          onClick={handleDismiss}
          data-testid="button-dismiss-progress"
        >
          <X className="w-4 h-4" />
        </Button>
        
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2 flex-wrap">
            {allComplete ? (
              <PartyPopper className="w-5 h-5 text-green-500" />
            ) : (
              <Sparkles className="w-5 h-5 text-primary" />
            )}
            <CardTitle className="text-lg">
              {allComplete ? "All Done!" : "Getting Started"}
            </CardTitle>
            <Badge variant="secondary" className="ml-auto mr-8">
              {completedCount}/{checklistItems.length}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {allComplete 
              ? "Congratulations! You've completed all the setup steps."
              : "Complete these steps to get started with AcreOS"
            }
          </p>
          <Progress 
            value={progress} 
            className="mt-3 h-2" 
            data-testid="progress-getting-started" 
          />
        </CardHeader>
        
        <CardContent className="space-y-2">
          <AnimatePresence>
            {checklistItems.map((item, index) => {
              const ItemIcon = item.icon;
              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Link href={item.href}>
                    <div
                      className={`flex items-center gap-3 p-3 rounded-lg transition-colors cursor-pointer hover-elevate ${
                        item.isComplete
                          ? "bg-green-500/5"
                          : "bg-muted/50"
                      }`}
                      data-testid={`progress-item-${item.id}`}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                            item.isComplete
                              ? "bg-green-500/10 text-green-500"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {item.isComplete ? (
                            <CheckCircle2 className="w-4 h-4" />
                          ) : (
                            <Circle className="w-4 h-4" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p
                            className={`text-sm font-medium truncate ${
                              item.isComplete ? "text-muted-foreground line-through" : ""
                            }`}
                          >
                            {item.title}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {item.description}
                          </p>
                        </div>
                      </div>
                      {!item.isComplete && (
                        <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      )}
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  );
}
