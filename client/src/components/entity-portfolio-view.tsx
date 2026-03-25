/**
 * Entity-Aware Portfolio View — filter properties by owning entity,
 * see per-entity tax data, and spot OZ-eligible parcels.
 */

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, Filter, MapPin, Landmark } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface Entity {
  name: string;
  type: string;
  propertyCount: number;
  totalValue: number;
}

interface EntityPortfolioData {
  entities: Entity[];
}

interface PortfolioByEntity {
  entity: string | null;
  properties: {
    id: number;
    address: string;
    county: string;
    state: string;
    acres: string;
    status: string;
    owningEntity: string | null;
    estimatedValue: number;
  }[];
  totalValue: number;
  totalAcres: number;
}

interface OzResult {
  properties: { id: number; address: string; isInOZ: boolean; tractId: string | null }[];
  ozCount: number;
}

function fmt$(n: number): string {
  if (!n || !isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

export function EntityPortfolioView() {
  const [selectedEntity, setSelectedEntity] = useState<string>("all");

  const { data: entityData, isLoading: loadingEntities } = useQuery<EntityPortfolioData>({
    queryKey: ["/api/portfolio/entities"],
  });

  const { data: portfolio, isLoading: loadingPortfolio } = useQuery<PortfolioByEntity>({
    queryKey: ["/api/portfolio/by-entity", selectedEntity],
    queryFn: async () => {
      const param = selectedEntity !== "all" ? `?entity=${encodeURIComponent(selectedEntity)}` : "";
      const res = await fetch(`/api/portfolio/by-entity${param}`);
      return res.json();
    },
  });

  const { data: ozData } = useQuery<OzResult>({
    queryKey: ["/api/portfolio/opportunity-zones"],
    staleTime: 10 * 60 * 1000,
  });

  if (loadingEntities) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const entities = entityData?.entities || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={selectedEntity} onValueChange={setSelectedEntity}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="All entities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Entities</SelectItem>
            {entities.map((e) => (
              <SelectItem key={e.name} value={e.name}>
                <span className="flex items-center gap-2">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  {e.name} ({e.propertyCount})
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Entity summary cards */}
      {selectedEntity === "all" && entities.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {entities.map((e) => (
            <Card
              key={e.name}
              className={cn(
                "cursor-pointer hover:border-primary/40 transition-colors",
                selectedEntity === e.name && "border-primary"
              )}
              onClick={() => setSelectedEntity(e.name)}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm font-medium truncate">{e.name}</span>
                </div>
                <p className="text-xs text-muted-foreground">{e.type}</p>
                <div className="mt-2 flex justify-between text-xs">
                  <span>{e.propertyCount} properties</span>
                  <span className="font-medium">{fmt$(e.totalValue)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Property list */}
      {loadingPortfolio ? (
        <Skeleton className="h-48 w-full" />
      ) : portfolio?.properties && portfolio.properties.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              {selectedEntity === "all" ? "All Properties" : selectedEntity}
              <Badge variant="secondary" className="text-xs ml-auto">
                {portfolio.properties.length} · {fmt$(portfolio.totalValue)}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {portfolio.properties.map((p) => {
              const isOZ = ozData?.properties?.find(oz => oz.id === p.id)?.isInOZ;
              return (
                <div key={p.id} className="flex items-center gap-2 text-sm py-1 border-b last:border-0">
                  <span className="truncate flex-1">{p.address || `${p.county}, ${p.state}`}</span>
                  <span className="text-xs text-muted-foreground">{parseFloat(p.acres || "0").toFixed(1)} ac</span>
                  {isOZ && (
                    <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                      <Landmark className="h-3 w-3 mr-1" /> OZ
                    </Badge>
                  )}
                  {p.owningEntity && selectedEntity === "all" && (
                    <Badge variant="outline" className="text-xs">{p.owningEntity}</Badge>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No properties found{selectedEntity !== "all" ? ` for ${selectedEntity}` : ""}.
          </CardContent>
        </Card>
      )}

      {/* OZ summary */}
      {ozData && ozData.ozCount > 0 && (
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-sm">
              <Landmark className="h-4 w-4 text-green-600" />
              <span className="font-medium">{ozData.ozCount} Opportunity Zone {ozData.ozCount === 1 ? "property" : "properties"}</span>
              <span className="text-xs text-muted-foreground ml-auto">
                Potential tax deferral and exclusion benefits
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
