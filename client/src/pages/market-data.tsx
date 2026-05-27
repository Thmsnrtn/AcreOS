import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { TrendingUp, TrendingDown, Minus, ArrowRight, MapPin } from "lucide-react";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";

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
      return <TrendingUp className="w-4 h-4 text-acr-pos" aria-hidden="true" />;
    case "falling":
      return <TrendingDown className="w-4 h-4 text-acr-neg" aria-hidden="true" />;
    default:
      return <Minus className="w-4 h-4 text-acr-warn" aria-hidden="true" />;
  }
}

function trendColor(trend: string): string {
  switch (trend) {
    case "rising": return "text-acr-pos";
    case "falling": return "text-acr-neg";
    default: return "text-acr-warn";
  }
}

export default function MarketDataPage() {
  useDocumentTitle("Land prices by state");
  const { data, isLoading } = useQuery<MarketDataResponse>({
    queryKey: ["/api/market-intelligence/public/data"],
  });

  return (
    <div className="min-h-screen bg-background">
      {/* SEO Header */}
      <div className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <h1 className="text-3xl md:text-4xl font-bold">
            Land prices by state
          </h1>
          <p className="text-muted-foreground mt-2 text-lg">
            AcreOS Market Intelligence — real-time real estate market data.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {isLoading ? (
          <div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
            role="status"
            aria-live="polite"
          >
            <span className="sr-only">Loading market data…</span>
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
        ) : !data?.states || data.states.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <MapPin className="w-10 h-10 mx-auto mb-3 opacity-30" aria-hidden="true" />
            <p className="text-sm">No market data available yet. Check back soon.</p>
          </div>
        ) : (
          <motion.ul
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
            aria-label="Land prices by state"
          >
            {data.states.map((state) => (
              <motion.li key={state.state} variants={staggerItem}>
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
                    <dl>
                      <dd className="text-2xl font-bold tabular-nums">
                        {usd(state.avgPricePerAcre, { noCents: Number.isInteger(state.avgPricePerAcre) })}
                      </dd>
                      <dt className="text-xs text-muted-foreground">avg $/acre</dt>
                    </dl>

                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Top appreciating counties:</p>
                      <ul className="flex flex-wrap gap-1" aria-label={`Top appreciating counties in ${state.state}`}>
                        {state.topCounties.map((county) => (
                          <li key={county}>
                            <Badge variant="secondary" className="text-micro">
                              <MapPin className="w-2.5 h-2.5 mr-0.5" aria-hidden="true" />
                              {county}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              </motion.li>
            ))}
          </motion.ul>
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
            <Button asChild className="min-h-11">
              <Link href="/auth">
                Start free <ArrowRight className="w-4 h-4 ml-1" aria-hidden="true" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
