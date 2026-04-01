import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { TrendingUp, TrendingDown, Minus, ArrowRight, MapPin } from "lucide-react";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/animations";

interface StateMarketData {
  state: string;
  avgPricePerAcre: number;
  topCounties: string[];
  trend: "rising" | "stable" | "falling";
}

interface MarketDataResponse {
  title: string;
  generatedAt: string;
  states: StateMarketData[];
  cta: string;
}

function TrendIcon({ trend }: { trend: string }) {
  switch (trend) {
    case "rising":
      return <TrendingUp className="w-4 h-4 text-emerald-500" />;
    case "falling":
      return <TrendingDown className="w-4 h-4 text-red-500" />;
    default:
      return <Minus className="w-4 h-4 text-amber-500" />;
  }
}

function trendColor(trend: string): string {
  switch (trend) {
    case "rising": return "text-emerald-600";
    case "falling": return "text-red-600";
    default: return "text-amber-600";
  }
}

export default function MarketDataPage() {
  const { data, isLoading } = useQuery<MarketDataResponse>({
    queryKey: ["/api/market-intelligence/public/data"],
  });

  return (
    <div className="min-h-screen bg-background">
      {/* SEO Header */}
      <div className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <h1 className="text-3xl md:text-4xl font-bold">
            Land Prices by State
          </h1>
          <p className="text-muted-foreground mt-2 text-lg">
            AcreOS Market Intelligence — real-time real estate market data
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4 space-y-3">
                  <Skeleton className="h-6 w-16" />
                  <Skeleton className="h-8 w-24" />
                  <Skeleton className="h-4 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
          >
            {data?.states.map((state) => (
              <motion.div key={state.state} variants={staggerItem}>
                <Card className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{state.state}</CardTitle>
                      <div className="flex items-center gap-1">
                        <TrendIcon trend={state.trend} />
                        <span className={`text-xs font-medium capitalize ${trendColor(state.trend)}`}>
                          {state.trend}
                        </span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="text-2xl font-bold">
                        ${state.avgPricePerAcre.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">avg $/acre</p>
                    </div>

                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Top appreciating counties:</p>
                      <div className="flex flex-wrap gap-1">
                        {state.topCounties.map((county) => (
                          <Badge key={county} variant="secondary" className="text-[10px]">
                            <MapPin className="w-2.5 h-2.5 mr-0.5" />
                            {county}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        )}

        {/* CTA */}
        <Card className="mt-8 border-primary/20">
          <CardContent className="p-6 text-center space-y-3">
            <p className="text-lg font-semibold">
              {data?.cta || "Get detailed reports and AI deal finding."}
            </p>
            <p className="text-sm text-muted-foreground">
              AcreOS uses AI to find undervalued land, automate due diligence, and track your path to financial freedom.
            </p>
            <Link href="/auth">
              <Button>
                Start Free <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
