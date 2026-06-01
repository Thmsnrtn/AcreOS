/**
 * Entity Portfolio View
 *
 * Displays properties grouped by owning entity (LLC, trust, individual, etc.)
 * with per-entity value summaries, Opportunity Zone badges, and tax optimization
 * suggestions. Supports filtering by entity via dropdown.
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, Filter, MapPin, Landmark, TrendingUp, AlertTriangle, Lightbulb } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/animations";

// ── Types ────────────────────────────────────────────────────────────────

interface OwningEntity {
  name: string;
  propertyCount: number;
  totalValue: number;
  type: "llc" | "trust" | "individual" | "corporation" | "unknown";
}

interface EntityProperty {
  id: number;
  address: string | null;
  county: string;
  state: string;
  sizeAcres: string;
  marketValue: string | null;
  purchasePrice: string | null;
  status: string;
  owningEntity: string;
  isOpportunityZone: boolean;
}

interface EntityPortfolio {
  entity: string;
  entityType: "llc" | "trust" | "individual" | "corporation" | "unknown";
  properties: EntityProperty[];
  totalValue: number;
  propertyCount: number;
}

interface EntityTaxSummary {
  entity: string;
  entityType: string;
  propertyCount: number;
  totalMarketValue: number;
  totalPurchasePrice: number;
  estimatedGains: number;
  ozPropertyCount: number;
  suggestions: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────

const ENTITY_TYPE_LABELS: Record<string, string> = {
  llc: "LLC",
  trust: "Trust",
  individual: "Individual",
  corporation: "Corporation",
  unknown: "Other",
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

// ── Loading Skeleton ─────────────────────────────────────────────────────

function PortfolioSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-[220px]" />
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-24 mt-1" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Property Row ─────────────────────────────────────────────────────────

function PropertyRow({ property }: { property: EntityProperty }) {
  const value = parseFloat(property.marketValue ?? property.purchasePrice ?? "0");

  return (
    <motion.div
      variants={staggerItem}
      className="flex items-center justify-between py-2 border-b border-border/50 last:border-0"
    >
      <div className="flex items-center gap-2 min-w-0">
        <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-sm truncate">
          {property.address ?? `${property.county}, ${property.state}`}
        </span>
        {property.isOpportunityZone && (
          <Badge variant="secondary" className="text-xs shrink-0 bg-acr-pos/10 text-acr-pos dark:text-acr-pos">
            OZ
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0 ml-2">
        <span className="text-xs text-muted-foreground">{property.sizeAcres} ac</span>
        {value > 0 && (
          <span className="text-sm font-medium tabular-nums">{formatCurrency(value)}</span>
        )}
      </div>
    </motion.div>
  );
}

// ── Entity Card ──────────────────────────────────────────────────────────

function EntityCard({ portfolio, taxSummary }: { portfolio: EntityPortfolio; taxSummary?: EntityTaxSummary }) {
  const ozCount = portfolio.properties.filter((p) => p.isOpportunityZone).length;

  return (
    <motion.div variants={staggerItem}>
      <Card className="hover:shadow-md transition-shadow h-full">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <CardTitle className="text-base truncate">{portfolio.entity}</CardTitle>
              </div>
              <CardDescription className="mt-0.5">
                {ENTITY_TYPE_LABELS[portfolio.entityType] ?? "Entity"} — {portfolio.propertyCount}{" "}
                {portfolio.propertyCount === 1 ? "property" : "properties"}
              </CardDescription>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-semibold tabular-nums">{formatCurrency(portfolio.totalValue)}</p>
              <p className="text-xs text-muted-foreground">Total value</p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* OZ summary */}
          {ozCount > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-acr-pos dark:text-acr-pos">
              <Landmark className="h-3.5 w-3.5 shrink-0" aria-label="Opportunity Zone" />
              {ozCount} {ozCount === 1 ? "property" : "properties"} in Opportunity Zones
            </div>
          )}

          {/* Gains indicator */}
          {taxSummary && taxSummary.estimatedGains !== 0 && (
            <div className="flex items-center gap-1.5 text-xs">
              <TrendingUp
                className={`h-3.5 w-3.5 shrink-0 ${
                  taxSummary.estimatedGains > 0 ? "text-acr-pos" : "text-acr-neg"
                }`}
              />
              <span className={taxSummary.estimatedGains > 0 ? "text-acr-pos" : "text-acr-neg"}>
                {formatCurrency(Math.abs(taxSummary.estimatedGains))}{" "}
                {taxSummary.estimatedGains > 0 ? "unrealized gain" : "unrealized loss"}
              </span>
            </div>
          )}

          {/* Property list */}
          <motion.div variants={staggerContainer} initial="hidden" animate="visible">
            {portfolio.properties.slice(0, 5).map((prop) => (
              <PropertyRow key={prop.id} property={prop} />
            ))}
          </motion.div>
          {portfolio.properties.length > 5 && (
            <p className="text-xs text-muted-foreground text-center">
              +{portfolio.properties.length - 5} more {portfolio.properties.length - 5 === 1 ? "property" : "properties"}
            </p>
          )}

          {/* Tax suggestions */}
          {taxSummary && taxSummary.suggestions.length > 0 && (
            <div className="pt-2 border-t border-border/50 space-y-1.5">
              <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <Lightbulb className="h-3 w-3" />
                Tax optimization
              </div>
              {taxSummary.suggestions.map((suggestion, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <AlertTriangle className="h-3 w-3 shrink-0 text-acr-warn mt-0.5" />
                  <p className="text-xs text-muted-foreground leading-relaxed">{suggestion}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────

export function EntityPortfolioView() {
  const [selectedEntity, setSelectedEntity] = useState<string>("all");

  const {
    data: entities,
    isLoading: entitiesLoading,
    error: entitiesError,
    refetch: refetchEntities,
  } = useQuery<OwningEntity[]>({
    queryKey: ["/api/entity-portfolio/entities"],
  });

  const {
    data: portfolios,
    isLoading: portfoliosLoading,
    error: portfoliosError,
    refetch: refetchPortfolios,
  } = useQuery<EntityPortfolio[]>({
    queryKey: [
      "/api/entity-portfolio/portfolio",
      selectedEntity !== "all" ? selectedEntity : undefined,
    ],
  });

  const {
    data: taxSummaries,
  } = useQuery<EntityTaxSummary[]>({
    queryKey: ["/api/entity-portfolio/tax-summary"],
  });

  const isLoading = entitiesLoading || portfoliosLoading;
  const error = entitiesError || portfoliosError;

  // Build a map of entity name -> tax summary for quick lookup
  const taxMap = useMemo(() => {
    if (!taxSummaries) return new Map<string, EntityTaxSummary>();
    return new Map(taxSummaries.map((s) => [s.entity, s]));
  }, [taxSummaries]);

  // Filter portfolios by selected entity client-side (server also filters)
  const filteredPortfolios = useMemo(() => {
    if (!portfolios) return [];
    if (selectedEntity === "all") return portfolios;
    return portfolios.filter((p) => p.entity === selectedEntity);
  }, [portfolios, selectedEntity]);

  // Aggregate stats
  const totalProperties = filteredPortfolios.reduce((sum, p) => sum + p.propertyCount, 0);
  const totalValue = filteredPortfolios.reduce((sum, p) => sum + p.totalValue, 0);

  if (isLoading) {
    return <PortfolioSkeleton />;
  }

  if (error) {
    return (
      <QueryErrorState
        error={error}
        onRetry={() => {
          refetchEntities();
          refetchPortfolios();
        }}
      />
    );
  }

  if (!portfolios || portfolios.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        headline="No entity portfolio data"
        subtitle="Properties with status 'owned' will appear here, grouped by their owning entity."
        // TODO(cta): entity portfolio is a derived view — action is to add properties via the Properties surface
        cta={{ label: "", _noOp: true }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header controls */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Select value={selectedEntity} onValueChange={setSelectedEntity}>
            <SelectTrigger className="w-[220px]" aria-label="Filter by entity">
              <SelectValue placeholder="All entities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All entities</SelectItem>
              {entities?.map((entity) => (
                <SelectItem key={entity.name} value={entity.name}>
                  {entity.name} ({entity.propertyCount})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>
            {totalProperties} {totalProperties === 1 ? "property" : "properties"}
          </span>
          <span className="font-medium text-foreground">{formatCurrency(totalValue)}</span>
        </div>
      </div>

      {/* Entity cards grid */}
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
      >
        {filteredPortfolios.map((portfolio) => (
          <EntityCard
            key={portfolio.entity}
            portfolio={portfolio}
            taxSummary={taxMap.get(portfolio.entity)}
          />
        ))}
      </motion.div>
    </div>
  );
}
