// @ts-nocheck
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { CheckCircle, Circle, Award, BookOpen, Users, Star, Zap } from "lucide-react";
import { Link } from "wouter";

const TIERS = [
  {
    name: "Bronze",
    color: "bg-amber-700 text-white",
    borderColor: "border-amber-700",
    badgeColor: "bg-amber-100 text-amber-800",
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
    color: "bg-gray-400 text-white",
    borderColor: "border-gray-400",
    badgeColor: "bg-gray-100 text-gray-700",
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
    color: "bg-yellow-500 text-white",
    borderColor: "border-yellow-500",
    badgeColor: "bg-yellow-100 text-yellow-800",
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
    color: "bg-blue-600 text-white",
    borderColor: "border-blue-600",
    badgeColor: "bg-blue-100 text-blue-800",
    icon: "💎",
    requirements: [
      "Complete ALL platform courses",
      "Pass all quizzes (85%+ average score)",
      "Complete a portfolio review with Atlas AI",
      "Mentor at least 2 Bronze/Silver members",
    ],
    benefits: ["Platinum badge", "Co-marketing opportunities", "Early feature access", "Dedicated account manager"],
    xpNeeded: 10000,
  },
  {
    name: "Elite",
    color: "bg-purple-700 text-white",
    borderColor: "border-purple-700",
    badgeColor: "bg-purple-100 text-purple-800",
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Certification Requirements</h1>
          <p className="text-muted-foreground">Requirements and benefits for each certification tier</p>
        </div>
        <Link href="/certification-leaderboard">
          <Button variant="outline">
            <Award className="h-4 w-4 mr-2" /> View Leaderboard
          </Button>
        </Link>
      </div>

      {/* Current Progress */}
      {userTier !== "none" && (
        <Card className="border-primary">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <Award className="h-6 w-6 text-primary" />
                <div>
                  <div className="font-semibold">Your Current Tier: {userTier}</div>
                  <div className="text-sm text-muted-foreground">{userXP.toLocaleString()} XP earned</div>
                </div>
              </div>
              <Badge className="text-base px-3 py-1">
                {TIERS.find(t => t.name === userTier)?.icon} {userTier}
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
                      <span>{userXP.toLocaleString()} / {nextTier.xpNeeded.toLocaleString()} XP</span>
                    </div>
                    <Progress value={pct} />
                  </div>
                );
              }
              return <p className="text-sm text-green-600 font-medium">🎉 You've reached the highest tier!</p>;
            })()}
          </CardContent>
        </Card>
      )}

      {/* Tier Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {TIERS.map(tier => {
          const status = getTierStatus(tier.name);
          return (
            <Card
              key={tier.name}
              className={`relative ${status === "achieved" ? "opacity-80" : ""} border-2 ${status === "next" ? tier.borderColor : "border-border"}`}
            >
              {status === "achieved" && (
                <div className="absolute top-3 right-3">
                  <CheckCircle className="h-6 w-6 text-green-500" />
                </div>
              )}
              {status === "next" && (
                <div className="absolute top-3 right-3">
                  <Badge className={tier.badgeColor}>Next Goal</Badge>
                </div>
              )}
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <span className="text-3xl">{tier.icon}</span>
                  <div>
                    <div className="text-xl">{tier.name}</div>
                    <div className="text-sm font-normal text-muted-foreground">{tier.xpNeeded.toLocaleString()} XP required</div>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex items-center gap-2 mb-2 text-sm font-semibold">
                    <BookOpen className="h-4 w-4" /> Requirements
                  </div>
                  <ul className="space-y-1">
                    {tier.requirements.map((req, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        {status === "achieved" ? (
                          <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                        ) : (
                          <Circle className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        )}
                        {req}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-2 text-sm font-semibold">
                    <Star className="h-4 w-4" /> Benefits
                  </div>
                  <ul className="space-y-1">
                    {tier.benefits.map((b, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Zap className="h-3 w-3 text-yellow-500 flex-shrink-0" /> {b}
                      </li>
                    ))}
                  </ul>
                </div>
                {status === "next" && (
                  <Link href="/academy">
                    <Button className="w-full" size="sm">
                      Start Working Toward {tier.name}
                    </Button>
                  </Link>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
