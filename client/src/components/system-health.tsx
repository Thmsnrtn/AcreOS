import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { 
  Activity, 
  RefreshCw, 
  ChevronDown, 
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Loader2
} from "lucide-react";

type ServiceStatus = 'healthy' | 'degraded' | 'unavailable' | 'unconfigured';

interface ServiceHealth {
  name: string;
  status: ServiceStatus;
  latency?: number;
  message?: string;
  lastChecked: string;
}

interface HealthCheckResult {
  overall: ServiceStatus;
  services: ServiceHealth[];
  timestamp: string;
}

function getStatusBadge(status: ServiceStatus) {
  switch (status) {
    case 'healthy':
      return (
        <Badge className="bg-green-500/10 text-green-600 border-green-500/20" data-testid="badge-status-healthy">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Healthy
        </Badge>
      );
    case 'degraded':
      return (
        <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20" data-testid="badge-status-degraded">
          <AlertTriangle className="w-3 h-3 mr-1" />
          Degraded
        </Badge>
      );
    case 'unavailable':
      return (
        <Badge className="bg-red-500/10 text-red-600 border-red-500/20" data-testid="badge-status-unavailable">
          <XCircle className="w-3 h-3 mr-1" />
          Unavailable
        </Badge>
      );
    case 'unconfigured':
      return (
        <Badge className="bg-gray-500/10 text-gray-600 border-gray-500/20" data-testid="badge-status-unconfigured">
          <HelpCircle className="w-3 h-3 mr-1" />
          Unconfigured
        </Badge>
      );
    default:
      return null;
  }
}

function getOverallStatusColor(status: ServiceStatus) {
  switch (status) {
    case 'healthy': return 'text-green-500';
    case 'degraded': return 'text-yellow-500';
    case 'unavailable': return 'text-red-500';
    case 'unconfigured': return 'text-gray-500';
    default: return 'text-muted-foreground';
  }
}

function formatServiceName(name: string) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function SystemHealth() {
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: healthData, isLoading, isFetching } = useQuery<HealthCheckResult>({
    queryKey: ['/api/health/cached'],
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/health");
      if (!res.ok) throw new Error("Failed to refresh health check");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['/api/health/cached'], data);
    },
  });

  const handleRefresh = () => {
    refreshMutation.mutate();
  };

  const isRefreshing = refreshMutation.isPending || isFetching;

  return (
    <Card data-testid="card-system-health">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Activity className="h-4 w-4" />
          System Health
        </CardTitle>
        <div className="flex items-center gap-2">
          {healthData && (
            <span className={`text-sm font-medium ${getOverallStatusColor(healthData.overall)}`} data-testid="text-overall-status">
              {healthData.overall === 'healthy' && 'All Systems Operational'}
              {healthData.overall === 'degraded' && 'Some Services Degraded'}
              {healthData.overall === 'unavailable' && 'Services Unavailable'}
              {healthData.overall === 'unconfigured' && 'Services Need Configuration'}
            </span>
          )}
          <Button 
            size="icon" 
            variant="ghost" 
            onClick={handleRefresh}
            disabled={isRefreshing}
            data-testid="button-refresh-health"
          >
            {isRefreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : healthData ? (
          <Collapsible open={isOpen} onOpenChange={setIsOpen}>
            <CollapsibleTrigger asChild>
              <Button 
                variant="ghost" 
                className="w-full justify-between px-2 hover-elevate"
                data-testid="button-toggle-services"
              >
                <span className="text-sm text-muted-foreground">
                  {healthData.services.length} services monitored
                </span>
                {isOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-2">
              {healthData.services.map((service) => (
                <div 
                  key={service.name} 
                  className="flex items-center justify-between py-2 px-2 rounded-md bg-muted/50"
                  data-testid={`row-service-${service.name}`}
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium" data-testid={`text-service-name-${service.name}`}>
                      {formatServiceName(service.name)}
                    </span>
                    {service.message && (
                      <span className="text-xs text-muted-foreground" data-testid={`text-service-message-${service.name}`}>
                        {service.message}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {service.latency !== undefined && (
                      <span className="text-xs text-muted-foreground" data-testid={`text-latency-${service.name}`}>
                        {service.latency}ms
                      </span>
                    )}
                    {getStatusBadge(service.status)}
                  </div>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        ) : (
          <div className="text-sm text-muted-foreground text-center py-4">
            No health data available
          </div>
        )}
      </CardContent>
    </Card>
  );
}
