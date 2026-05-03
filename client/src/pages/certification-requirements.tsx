// @ts-nocheck
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { CheckCircle, Circle, Award, BookOpen, Star, Zap } from "lucide-react";
import { Link } from "wouter";
import { useDocumentTitle } from "@/hooks/use-document-title";

const TIERS = [
  {
    name: "Bronze",
    color: "bg-acr-warn text-white",
    borderColor: "border-acr-warn",
    badgeColor: "bg-acr-warn-soft text-acr-warn",
    icon: "🥉",
    requirements: [
      "Complete 3 core modules",
      "Pass 1 certification quiz (70%+ score)",
      "Create your first property analysis",
    ],
    benefits: ["Bronze badge on profile", "Access to community forums", "Monthly newsletter"],
    xpNeeded: 500,
  },
  {
    name: "Silver",
    color: "bg-muted text-white",
    borderColor: "border-border",
    badgeColor: "bg-muted text-foreground",
    icon: "🥈",
    requirements: [
      "Complete 8 modules across 2 learning paths",
      "Pass 3 certification quizzes (75%+ score each)",
      "Complete 1 official AcreOS certificate",
      "Submit 5 deal analyses",
    ],
    benefits: ["Silver badge", "Priority support", "Advanced tools access", "Invite to webinars"],
    xpNeeded: 2000,
  },
  {
    name: "Gold",
    color: "bg-acr-warn text-white",
    borderColor: "border-acr-warn",
    badgeColor: "bg-acr-warn-soft text-acr-warn",
    icon: "🥇",
    requirements: [
      "Complete 15 modules across all learning paths",
      "Pass all core quizzes (80%+ score)",
      "Attend or watch 1 live mentor session",
      "Close or analyze 10+ deals in the platform",
    ],
    benefits: ["Gold badge", "Mentorship eligibility", "Featured in directory", "Priority deal room access"],
    xpNeeded: 5000,
  },
  {
    name: "Platinum",
    color: "bg-acr-accent text-white",
    borderColor: "border-acr-accent",
    badgeColor: "bg-acr-accent text-acr-accent",
    icon: "💎",
    requirements: [
      "Complete ALL platform courses",
      "Pass all quizzes (85%+ average score)",
      "Complete a portfolio review with Pax",
      "Mentor at least 2 Bronze/Silver members",
    ],
    benefits: ["Platinum badge", "Co-marketing opportunities", "Early feature access", "Dedicated account manager"],
    xpNeeded: 10000,
  },
  {
    name: "Elite",
    color: "bg-acr-brand text-white",
    borderColor: "border-acr-brand",
    badgeColor: "bg-acr-brand-soft text-acr-brand",
    icon: "⭐",
    requirements: [
      "All Platinum requirements",
      "Post 3 educational forum contributions (upvoted)",
      "Conduct 1 group mentoring session",
      "Achieve top 10% deal performance score",
    ],
    benefits: [
      "Elite badge",
      "AcreOS Ambassador status",
      "Revenue sharing opportunities",
      "Advisory board invitation",
      "White-label licensing discount",
    ],
    xpNeeded: 25000,
  },
];

export default function CertificationRequirements() {
  useDocumentTitle("Certification requirements");
  const { data: progressData } = useQuery({
    queryKey: ["/api/certification/progress"],
    queryFn: () => fetch("/api/certification/progress", { credentials: "include" })
      .then(r => r.ok ? r.json() : { progress: {} })
      .catch(() => ({ progress: {} })),
  });

  const progress = progressData?.progress || {};
  const userXP = progress.xp || 0;
  const userTier = progress.tier || "none";

  const getTierStatus = (tierName: string) => {
    const tierOrder = ["Bronze", "Silver", "Gold", "Platinum", "Elite"];
    const userIdx = tierOrder.indexOf(userTier);
    const tierIdx = tierOrder.indexOf(tierName);
    if (userIdx >= tierIdx) return "achieved";
    if (tierIdx === userIdx + 1) return "next";
    return "locked";
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Certification requirements</h1>
          <p className="text-muted-foreground">Requirements and benefits for each certification tier.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/certification-leaderboard">
            <Award className="h-4 w-4 mr-2" aria-hidden="true" /> View leaderboard
          </Link>
        </Button>
      </div>

      {userTier !== "none" && (
        <Card className="border-primary">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <Award className="h-6 w-6 text-primary" aria-hidden="true" />
                <div>
                  <div className="font-semibold">Your current tier: {userTier}</div>
                  <div className="text-sm text-muted-foreground tabular-nums">{userXP.toLocaleString()} XP earned</div>
                </div>
              </div>
              <Badge className="text-base px-3 py-1">
                <span aria-hidden="true">{TIERS.find(t => t.name === userTier)?.icon}</span> {userTier}
              </Badge>
            </div>
            {(() => {
              const tierOrder = ["Bronze", "Silver", "Gold", "Platinum", "Elite"];
              const nextIdx = tierOrder.indexOf(userTier) + 1;
              if (nextIdx < tierOrder.length) {
                const nextTier = TIERS[nextIdx];
                const pct = Math.min(100, (userXP / nextTier.xpNeeded) * 100);
                return (
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Progress to {nextTier.name}</span>
                      <span className="tabular-nums">{userXP.toLocaleString()} / {nextTier.xpNeeded.toLocaleString()} XP</span>
                    </div>
                    <Progress
                      value={pct}
                      aria-label={`Progress to ${nextTier.name}: ${userXP.toLocaleString()} of ${nextTier.xpNeeded.toLocaleString()} XP, ${Math.round(pct)}%`}
                    />
                  </div>
                );
              }
              return <p className="text-sm text-acr-pos font-medium" role="status"><span aria-hidden="true">🎉 </span>You've reached the highest tier!</p>;
            })()}
          </CardContent>
        </Card>
      )}

      <ul className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6" aria-label="Certification tiers">
        {TIERS.map(tier => {
          const status = getTierStatus(tier.name);
          return (
            <li key={tier.name}>
              <Card
                className={`relative h-full ${status === "achieved" ? "opacity-80" : ""} border-2 ${status === "next" ? tier.borderColor : "border-border"}`}
              >
                {status === "achieved" && (
                  <div className="absolute top-3 right-3">
                    <CheckCircle className="h-6 w-6 text-acr-pos" aria-label="Tier achieved" />
                  </div>
                )}
                {status === "next" && (
                  <div className="absolute top-3 right-3">
                    <Badge className={tier.badgeColor}>Next goal</Badge>
                  </div>
                )}
                <CardHeader>
                  <CardTitle className="flex items-center gap-3">
                    <span className="text-3xl" aria-hidden="true">{tier.icon}</span>
                    <div>
                      <div className="text-xl">{tier.name}</div>
                      <div className="text-sm font-normal text-muted-foreground tabular-nums">{tier.xpNeeded.toLocaleString()} XP required</div>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2 text-sm font-semibold">
                      <BookOpen className="h-4 w-4" aria-hidden="true" /> Requirements
                    </div>
                    <ul className="space-y-1" aria-label={`${tier.name} requirements`}>
                      {tier.requirements.map((req, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          {status === "achieved" ? (
                            <CheckCircle className="h-4 w-4 text-acr-pos mt-0.5 flex-shrink-0" aria-label="Done" />
                          ) : (
                            <Circle className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" aria-label="Open" />
                          )}
                          {req}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-2 text-sm font-semibold">
                      <Star className="h-4 w-4" aria-hidden="true" /> Benefits
                    </div>
                    <ul className="space-y-1" aria-label={`${tier.name} benefits`}>
                      {tier.benefits.map((b, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Zap className="h-3 w-3 text-acr-warn flex-shrink-0" aria-hidden="true" /> {b}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {status === "next" && (
                    <Button asChild className="w-full" size="sm">
                      <Link href="/academy" aria-label={`Start working toward ${tier.name} tier`}>
                        Start working toward {tier.name}
                      </Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
