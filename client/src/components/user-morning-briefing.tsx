import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sun, ArrowRight, DollarSign, MessageSquare, Target, X } from "lucide-react";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { useState } from "react";
import { Link } from "wouter";

interface BriefingData {
  greeting: string;
  overnightItems: { icon: string; text: string }[];
  priority: { headline: string; ctaLabel: string; ctaRoute: string } | null;
}

async function fetchBriefing(): Promise<BriefingData> {
  // Canonical endpoint lives on the dashboard router. /api/today/priorities
  // was the old path that never shipped server-side.
  const res = await fetch("/api/dashboard/today-priorities", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch briefing");
  const data = await res.json();

  // Build briefing from priority action data
  const overnight: { icon: string; text: string }[] = [];
  if (data.action) {
    overnight.push({ icon: "target", text: data.headline || "You have a priority action today" });
  }

  return {
    greeting: `Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}`,
    overnightItems: overnight,
    priority: data.action
      ? { headline: data.headline || "Review your priorities", ctaLabel: data.ctaLabel || "View", ctaRoute: data.ctaRoute || "/today" }
      : null,
  };
}

const ICON_MAP: Record<string, React.ReactNode> = {
  target: <Target className="h-4 w-4 text-primary" />,
  dollar: <DollarSign className="h-4 w-4 text-emerald-500" />,
  message: <MessageSquare className="h-4 w-4 text-blue-500" />,
};

export function UserMorningBriefing() {
  const [dismissed, setDismissed] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["/api/dashboard/today-priorities"],
    queryFn: fetchBriefing,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  if (dismissed) return null;

  if (isLoading) {
    return (
      <Card className="mb-6">
        <CardContent className="p-6">
          <Skeleton className="h-6 w-48 mb-3" />
          <Skeleton className="h-4 w-64 mb-2" />
          <Skeleton className="h-4 w-56" />
        </CardContent>
      </Card>
    );
  }

  if (!data || (!data.overnightItems.length && !data.priority)) return null;

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate">
      <Card className="mb-6 border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Sun className="h-5 w-5 text-amber-500" />
            <CardTitle className="text-lg">{data.greeting}</CardTitle>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setDismissed(true)} aria-label="Dismiss briefing">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.overnightItems.length > 0 && (
            <motion.div variants={staggerItem}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Overnight</p>
              <ul className="space-y-1">
                {data.overnightItems.map((item, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    {ICON_MAP[item.icon] || <Target className="h-4 w-4" />}
                    {item.text}
                  </li>
                ))}
              </ul>
            </motion.div>
          )}

          {data.priority && (
            <motion.div variants={staggerItem} className="pt-2 border-t">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Today's priority</p>
              <p className="text-sm mb-2">{data.priority.headline}</p>
              <Button asChild size="sm" className="gap-1">
                <Link href={data.priority.ctaRoute}>
                  {data.priority.ctaLabel}
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              </Button>
            </motion.div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
