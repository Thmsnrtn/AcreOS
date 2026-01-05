import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Search, 
  Phone, 
  Mail, 
  MapPin, 
  Users, 
  Loader2, 
  CheckCircle, 
  XCircle, 
  Clock,
  DollarSign,
  RefreshCw
} from "lucide-react";
import type { Lead } from "@shared/schema";

type SkipTraceResult = {
  phones?: Array<{ number: string; type: string; verified: boolean }>;
  emails?: Array<{ email: string; verified: boolean }>;
  addresses?: Array<{ address: string; type: string; current: boolean }>;
  relatives?: Array<{ name: string; relationship: string }>;
  ageRange?: string;
};

type SkipTrace = {
  id: number;
  organizationId: number;
  leadId: number;
  status: "pending" | "processing" | "completed" | "failed" | "no_results";
  results?: SkipTraceResult;
  costCents?: number;
  requestedAt?: string;
  completedAt?: string;
};

export function SkipTracePanel({ lead }: { lead: Lead }) {
  const { toast } = useToast();
  const [isPolling, setIsPolling] = useState(false);

  const { data: skipTrace, isLoading, refetch } = useQuery<SkipTrace | null>({
    queryKey: ['/api/skip-traces/lead', lead.id],
  });

  const runSkipTrace = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/skip-traces', { leadId: lead.id });
      return res;
    },
    onSuccess: () => {
      toast({ title: "Skip trace started", description: "Processing your request..." });
      setIsPolling(true);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to run skip trace", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPolling) {
      interval = setInterval(async () => {
        const result = await refetch();
        if (result.data?.status === 'completed' || result.data?.status === 'failed' || result.data?.status === 'no_results') {
          setIsPolling(false);
          queryClient.invalidateQueries({ queryKey: ['/api/skip-traces/lead', lead.id] });
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [isPolling, lead.id, refetch]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"><CheckCircle className="w-3 h-3 mr-1" />Completed</Badge>;
      case 'processing':
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300"><Clock className="w-3 h-3 mr-1" />Processing</Badge>;
      case 'failed':
        return <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
      case 'no_results':
        return <Badge className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">No Results</Badge>;
      default:
        return null;
    }
  };

  if (isLoading) {
    return (
      <Card className="glass-panel">
        <CardContent className="pt-6 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass-panel" data-testid="panel-skip-trace">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Search className="w-4 h-4" /> Skip Trace
          </span>
          {skipTrace && getStatusBadge(skipTrace.status)}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!skipTrace ? (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground mb-4">
              Run a skip trace to find additional contact information for this lead.
            </p>
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground mb-4">
              <DollarSign className="w-4 h-4" />
              <span>Cost: $0.50 per trace</span>
            </div>
            <Button 
              onClick={() => runSkipTrace.mutate()} 
              disabled={runSkipTrace.isPending}
              data-testid="button-run-skip-trace"
            >
              {runSkipTrace.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Starting...</>
              ) : (
                <><Search className="w-4 h-4 mr-2" /> Run Skip Trace</>
              )}
            </Button>
          </div>
        ) : skipTrace.status === 'processing' || skipTrace.status === 'pending' ? (
          <div className="text-center py-4">
            <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Processing skip trace...</p>
          </div>
        ) : skipTrace.status === 'completed' && skipTrace.results ? (
          <div className="space-y-4">
            {skipTrace.results.phones && skipTrace.results.phones.length > 0 && (
              <div data-testid="skip-trace-phones">
                <p className="text-xs text-muted-foreground uppercase mb-2 flex items-center gap-1">
                  <Phone className="w-3 h-3" /> Phone Numbers
                </p>
                <div className="space-y-1">
                  {skipTrace.results.phones.map((phone, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm" data-testid={`skip-trace-phone-${idx}`}>
                      <span className="font-medium">{phone.number}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{phone.type}</Badge>
                        {phone.verified && <CheckCircle className="w-3 h-3 text-emerald-500" />}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {skipTrace.results.emails && skipTrace.results.emails.length > 0 && (
              <div data-testid="skip-trace-emails">
                <p className="text-xs text-muted-foreground uppercase mb-2 flex items-center gap-1">
                  <Mail className="w-3 h-3" /> Email Addresses
                </p>
                <div className="space-y-1">
                  {skipTrace.results.emails.map((email, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm" data-testid={`skip-trace-email-${idx}`}>
                      <span className="font-medium">{email.email}</span>
                      {email.verified && <CheckCircle className="w-3 h-3 text-emerald-500" />}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {skipTrace.results.addresses && skipTrace.results.addresses.length > 0 && (
              <div data-testid="skip-trace-addresses">
                <p className="text-xs text-muted-foreground uppercase mb-2 flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> Addresses
                </p>
                <div className="space-y-2">
                  {skipTrace.results.addresses.map((addr, idx) => (
                    <div key={idx} className="text-sm" data-testid={`skip-trace-address-${idx}`}>
                      <p className="font-medium">{addr.address}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-xs">{addr.type}</Badge>
                        {addr.current && <Badge className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Current</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {skipTrace.results.relatives && skipTrace.results.relatives.length > 0 && (
              <div data-testid="skip-trace-relatives">
                <p className="text-xs text-muted-foreground uppercase mb-2 flex items-center gap-1">
                  <Users className="w-3 h-3" /> Relatives
                </p>
                <div className="space-y-1">
                  {skipTrace.results.relatives.map((rel, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm" data-testid={`skip-trace-relative-${idx}`}>
                      <span className="font-medium">{rel.name}</span>
                      <Badge variant="outline" className="text-xs capitalize">{rel.relationship}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {skipTrace.results.ageRange && (
              <div className="flex items-center justify-between text-sm" data-testid="skip-trace-age">
                <span className="text-muted-foreground">Age Range</span>
                <span className="font-medium">{skipTrace.results.ageRange}</span>
              </div>
            )}

            <div className="pt-3 border-t text-xs text-muted-foreground flex items-center justify-between">
              <span>Cost: ${((skipTrace.costCents || 50) / 100).toFixed(2)}</span>
              {skipTrace.completedAt && (
                <span>Completed: {new Date(skipTrace.completedAt).toLocaleDateString()}</span>
              )}
            </div>

            <Button 
              variant="outline" 
              size="sm" 
              className="w-full"
              onClick={() => runSkipTrace.mutate()} 
              disabled={runSkipTrace.isPending}
              data-testid="button-refresh-skip-trace"
            >
              <RefreshCw className="w-4 h-4 mr-2" /> Run New Skip Trace
            </Button>
          </div>
        ) : (
          <div className="text-center py-4">
            <XCircle className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-4">
              {skipTrace.status === 'no_results' ? 'No results found for this lead.' : 'Skip trace failed. Please try again.'}
            </p>
            <Button 
              variant="outline"
              onClick={() => runSkipTrace.mutate()} 
              disabled={runSkipTrace.isPending}
              data-testid="button-retry-skip-trace"
            >
              <RefreshCw className="w-4 h-4 mr-2" /> Try Again
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
