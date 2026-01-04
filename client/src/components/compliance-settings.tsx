import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  Shield, 
  FileText, 
  Clock, 
  Trash2, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  User, 
  Calendar,
  Loader2,
  RefreshCw,
  Search,
  PhoneOff
} from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";
import type { AuditLogEntry } from "@shared/schema";

interface RetentionPolicy {
  enabled: boolean;
  retentionDays: number;
}

interface RetentionPolicies {
  leads: RetentionPolicy;
  closedDeals: RetentionPolicy;
  auditLogs: RetentionPolicy;
  communications: RetentionPolicy;
}

interface TcpaStats {
  total: number;
  withConsent: number;
  withoutConsent: number;
  optedOut: number;
}

export function ComplianceSettings() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"audit" | "tcpa" | "retention">("audit");
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Shield className="w-5 h-5" />
          Compliance & Data Governance
        </h2>
        <p className="text-muted-foreground text-sm">
          Manage audit logs, TCPA compliance, and data retention policies.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant={activeTab === "audit" ? "default" : "outline"}
          onClick={() => setActiveTab("audit")}
          data-testid="button-tab-audit"
        >
          <FileText className="w-4 h-4 mr-2" />
          Audit Log
        </Button>
        <Button
          variant={activeTab === "tcpa" ? "default" : "outline"}
          onClick={() => setActiveTab("tcpa")}
          data-testid="button-tab-tcpa"
        >
          <PhoneOff className="w-4 h-4 mr-2" />
          TCPA Compliance
        </Button>
        <Button
          variant={activeTab === "retention" ? "default" : "outline"}
          onClick={() => setActiveTab("retention")}
          data-testid="button-tab-retention"
        >
          <Clock className="w-4 h-4 mr-2" />
          Data Retention
        </Button>
      </div>

      {activeTab === "audit" && <AuditLogViewer />}
      {activeTab === "tcpa" && <TcpaCompliancePanel />}
      {activeTab === "retention" && <RetentionPoliciesPanel />}
    </div>
  );
}

function AuditLogViewer() {
  const { toast } = useToast();
  const [filters, setFilters] = useState({
    action: "",
    entityType: "",
    limit: 50,
    offset: 0
  });

  const { data, isLoading, refetch, isFetching } = useQuery<{ logs: AuditLogEntry[]; count: number }>({
    queryKey: ["/api/audit-log", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.action) params.set("action", filters.action);
      if (filters.entityType) params.set("entityType", filters.entityType);
      params.set("limit", filters.limit.toString());
      params.set("offset", filters.offset.toString());
      
      const res = await fetch(`/api/audit-log?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch audit logs");
      return res.json();
    }
  });

  const getActionBadge = (action: string) => {
    switch (action) {
      case "create":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Create</Badge>;
      case "update":
        return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Update</Badge>;
      case "delete":
        return <Badge variant="destructive">Delete</Badge>;
      case "consent_granted":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Consent Granted</Badge>;
      case "consent_revoked":
        return <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">Consent Revoked</Badge>;
      case "data_purge":
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">Data Purge</Badge>;
      default:
        return <Badge variant="secondary">{action}</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="w-4 h-4" />
          Audit Trail
        </CardTitle>
        <CardDescription>
          Complete record of all system activities for compliance and security.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <Label>Action</Label>
            <Select value={filters.action} onValueChange={(v) => setFilters(f => ({ ...f, action: v, offset: 0 }))}>
              <SelectTrigger className="w-[180px]" data-testid="select-audit-action">
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All actions</SelectItem>
                <SelectItem value="create">Create</SelectItem>
                <SelectItem value="update">Update</SelectItem>
                <SelectItem value="delete">Delete</SelectItem>
                <SelectItem value="consent_granted">Consent Granted</SelectItem>
                <SelectItem value="consent_revoked">Consent Revoked</SelectItem>
                <SelectItem value="data_purge">Data Purge</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-1">
            <Label>Entity Type</Label>
            <Select value={filters.entityType} onValueChange={(v) => setFilters(f => ({ ...f, entityType: v, offset: 0 }))}>
              <SelectTrigger className="w-[180px]" data-testid="select-audit-entity">
                <SelectValue placeholder="All entities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All entities</SelectItem>
                <SelectItem value="lead">Lead</SelectItem>
                <SelectItem value="property">Property</SelectItem>
                <SelectItem value="deal">Deal</SelectItem>
                <SelectItem value="note">Note</SelectItem>
                <SelectItem value="settings">Settings</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-audit"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : data?.logs && data.logs.length > 0 ? (
          <>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.logs.map((log) => (
                    <TableRow key={log.id} data-testid={`row-audit-${log.id}`}>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {log.createdAt ? format(new Date(log.createdAt), "MMM d, yyyy HH:mm") : "N/A"}
                      </TableCell>
                      <TableCell>{getActionBadge(log.action)}</TableCell>
                      <TableCell>
                        <span className="capitalize">{log.entityType}</span>
                        {log.entityId && <span className="text-muted-foreground ml-1">#{log.entityId}</span>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {log.userId || "System"}
                      </TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate">
                        {log.changes?.fields?.join(", ") || log.metadata?.purgedCount ? `${log.metadata.purgedCount} records` : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Showing {data.logs.length} of {data.count} entries
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={filters.offset === 0}
                  onClick={() => setFilters(f => ({ ...f, offset: Math.max(0, f.offset - f.limit) }))}
                  data-testid="button-audit-prev"
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={filters.offset + filters.limit >= (data.count || 0)}
                  onClick={() => setFilters(f => ({ ...f, offset: f.offset + f.limit }))}
                  data-testid="button-audit-next"
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No audit log entries found</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TcpaCompliancePanel() {
  const { toast } = useToast();

  const { data: stats, isLoading: statsLoading } = useQuery<TcpaStats>({
    queryKey: ["/api/compliance/tcpa/stats"],
  });

  const { data: noConsentLeads, isLoading: noConsentLoading } = useQuery<any[]>({
    queryKey: ["/api/compliance/tcpa/no-consent"],
  });

  const consentRate = stats ? ((stats.withConsent / stats.total) * 100).toFixed(1) : "0";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <PhoneOff className="w-4 h-4" />
            TCPA Compliance Overview
          </CardTitle>
          <CardDescription>
            Track consent status for SMS and call communications.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {statsLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-lg bg-muted/50" data-testid="stat-total-leads">
                <p className="text-2xl font-bold">{stats?.total || 0}</p>
                <p className="text-sm text-muted-foreground">Total Leads</p>
              </div>
              <div className="p-4 rounded-lg bg-green-100 dark:bg-green-900/30" data-testid="stat-with-consent">
                <p className="text-2xl font-bold text-green-700 dark:text-green-400">{stats?.withConsent || 0}</p>
                <p className="text-sm text-green-600 dark:text-green-500">With Consent</p>
              </div>
              <div className="p-4 rounded-lg bg-orange-100 dark:bg-orange-900/30" data-testid="stat-without-consent">
                <p className="text-2xl font-bold text-orange-700 dark:text-orange-400">{stats?.withoutConsent || 0}</p>
                <p className="text-sm text-orange-600 dark:text-orange-500">Without Consent</p>
              </div>
              <div className="p-4 rounded-lg bg-red-100 dark:bg-red-900/30" data-testid="stat-opted-out">
                <p className="text-2xl font-bold text-red-700 dark:text-red-400">{stats?.optedOut || 0}</p>
                <p className="text-sm text-red-600 dark:text-red-500">Opted Out</p>
              </div>
            </div>
          )}
          
          <div className="mt-4 p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Consent Rate</span>
              <span className="text-sm font-bold">{consentRate}%</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className="bg-green-500 h-2 rounded-full transition-all"
                style={{ width: `${consentRate}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Leads Requiring Consent</CardTitle>
          <CardDescription>
            These leads cannot receive SMS or calls until consent is obtained.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {noConsentLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : noConsentLeads && noConsentLeads.length > 0 ? (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {noConsentLeads.slice(0, 10).map((lead) => (
                    <TableRow key={lead.id} data-testid={`row-no-consent-${lead.id}`}>
                      <TableCell>{lead.firstName} {lead.lastName}</TableCell>
                      <TableCell className="text-muted-foreground">{lead.phone || "-"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
                          <XCircle className="w-3 h-3 mr-1" />
                          No Consent
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {lead.createdAt ? format(new Date(lead.createdAt), "MMM d, yyyy") : "N/A"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle2 className="w-12 h-12 mx-auto mb-2 text-green-500" />
              <p>All leads have TCPA consent</p>
            </div>
          )}
          
          {noConsentLeads && noConsentLeads.length > 10 && (
            <p className="text-sm text-muted-foreground mt-2">
              Showing 10 of {noConsentLeads.length} leads without consent
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RetentionPoliciesPanel() {
  const { toast } = useToast();
  const [purgeType, setPurgeType] = useState<string>("");
  const [purgeDays, setPurgeDays] = useState<number>(365);

  const { data: policies, isLoading } = useQuery<RetentionPolicies>({
    queryKey: ["/api/compliance/retention-policies"],
  });

  const updatePoliciesMutation = useMutation({
    mutationFn: async (newPolicies: RetentionPolicies) => {
      const res = await apiRequest("PATCH", "/api/compliance/retention-policies", newPolicies);
      if (!res.ok) throw new Error("Failed to update policies");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/compliance/retention-policies"] });
      toast({
        title: "Policies updated",
        description: "Data retention policies have been saved.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update retention policies.",
        variant: "destructive",
      });
    },
  });

  const purgeDataMutation = useMutation({
    mutationFn: async ({ dataType, beforeDate }: { dataType: string; beforeDate: string }) => {
      const res = await apiRequest("POST", "/api/compliance/purge-data", { dataType, beforeDate });
      if (!res.ok) throw new Error("Failed to purge data");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries();
      toast({
        title: "Data purged",
        description: `${data.purgedCount} ${data.dataType} records have been deleted.`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to purge data.",
        variant: "destructive",
      });
    },
  });

  const handleTogglePolicy = (key: keyof RetentionPolicies, enabled: boolean) => {
    if (!policies) return;
    const updated = {
      ...policies,
      [key]: { ...policies[key], enabled }
    };
    updatePoliciesMutation.mutate(updated);
  };

  const handleUpdateDays = (key: keyof RetentionPolicies, days: number) => {
    if (!policies) return;
    const updated = {
      ...policies,
      [key]: { ...policies[key], retentionDays: days }
    };
    updatePoliciesMutation.mutate(updated);
  };

  const handlePurge = () => {
    if (!purgeType) return;
    const beforeDate = new Date();
    beforeDate.setDate(beforeDate.getDate() - purgeDays);
    purgeDataMutation.mutate({
      dataType: purgeType,
      beforeDate: beforeDate.toISOString()
    });
  };

  const policyItems = [
    { key: "leads" as const, label: "Dead Leads", description: "Leads marked as dead/unresponsive" },
    { key: "closedDeals" as const, label: "Closed Deals", description: "Deals that have been closed" },
    { key: "auditLogs" as const, label: "Audit Logs", description: "Historical audit log entries" },
    { key: "communications" as const, label: "Communications", description: "Email and SMS records" },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Retention Policies
          </CardTitle>
          <CardDescription>
            Configure automatic data retention periods for compliance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {policyItems.map((item) => (
                <div
                  key={item.key}
                  className="flex flex-wrap items-center justify-between gap-4 p-4 border rounded-lg"
                  data-testid={`policy-${item.key}`}
                >
                  <div className="flex-1 min-w-[200px]">
                    <p className="font-medium">{item.label}</p>
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={30}
                        max={3650}
                        value={policies?.[item.key]?.retentionDays || 365}
                        onChange={(e) => handleUpdateDays(item.key, parseInt(e.target.value) || 365)}
                        className="w-20"
                        disabled={!policies?.[item.key]?.enabled}
                        data-testid={`input-retention-${item.key}`}
                      />
                      <span className="text-sm text-muted-foreground">days</span>
                    </div>
                    <Switch
                      checked={policies?.[item.key]?.enabled || false}
                      onCheckedChange={(checked) => handleTogglePolicy(item.key, checked)}
                      data-testid={`switch-${item.key}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Trash2 className="w-4 h-4" />
            Manual Data Purge
          </CardTitle>
          <CardDescription>
            Immediately delete old data. This action cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label>Data Type</Label>
              <Select value={purgeType} onValueChange={setPurgeType}>
                <SelectTrigger className="w-[200px]" data-testid="select-purge-type">
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="leads">Dead Leads</SelectItem>
                  <SelectItem value="closedDeals">Closed Deals</SelectItem>
                  <SelectItem value="auditLogs">Audit Logs</SelectItem>
                  <SelectItem value="communications">Communications</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Older than (days)</Label>
              <Input
                type="number"
                min={30}
                value={purgeDays}
                onChange={(e) => setPurgeDays(parseInt(e.target.value) || 365)}
                className="w-24"
                data-testid="input-purge-days"
              />
            </div>
            <Button
              variant="destructive"
              onClick={handlePurge}
              disabled={!purgeType || purgeDataMutation.isPending}
              data-testid="button-purge-data"
            >
              {purgeDataMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Purge Data
            </Button>
          </div>
          
          <div className="mt-4 p-3 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-orange-700 dark:text-orange-300">
              Data purging is permanent and cannot be reversed. Consider exporting data before purging.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}