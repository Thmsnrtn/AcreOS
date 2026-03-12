/**
 * T13 — Comprehensive Audit Log UI
 * Shows who did what, when, to which record — across the entire organization.
 * Mounted at /audit-log (accessible to org owners and admins)
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, Filter, Search, RefreshCw, User, FileText, DollarSign, Home, Handshake } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/hooks/use-auth";

interface AuditEntry {
  id: number;
  action: string;
  entityType: string | null;
  entityId: number | null;
  userId: string | null;
  userEmail?: string;
  metadata: Record<string, any> | null;
  createdAt: string;
  ipAddress?: string;
}

interface AuditResponse {
  entries: AuditEntry[];
  total: number;
  page: number;
  limit: number;
}

const ENTITY_ICONS: Record<string, React.ElementType> = {
  lead: User,
  property: Home,
  deal: Handshake,
  note: DollarSign,
  document: FileText,
};

const ACTION_COLORS: Record<string, string> = {
  created: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  updated: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  deleted: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  sent: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  logged: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

function getActionColor(action: string): string {
  for (const [key, cls] of Object.entries(ACTION_COLORS)) {
    if (action.toLowerCase().includes(key)) return cls;
  }
  return "bg-muted text-muted-foreground";
}

export default function AuditLog() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("all");
  const [page, setPage] = useState(1);
  const limit = 50;

  const params = new URLSearchParams({
    limit: String(limit),
    offset: String((page - 1) * limit),
    ...(entityFilter !== "all" && { entityType: entityFilter }),
    ...(search && { search }),
  });

  const { data, isLoading, refetch } = useQuery<AuditResponse>({
    queryKey: [`/api/activity?${params}`],
    staleTime: 30_000,
  });

  const totalPages = Math.ceil((data?.total ?? 0) / limit);

  function exportCsv() {
    const rows = [
      ["Timestamp", "Action", "Entity Type", "Entity ID", "User", "Details"],
      ...(data?.entries ?? []).map((e) => [
        e.createdAt,
        e.action,
        e.entityType || "",
        String(e.entityId || ""),
        e.userEmail || e.userId || "",
        JSON.stringify(e.metadata || {}),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Audit Log</h1>
          <p className="text-sm text-muted-foreground">
            Every action taken in your organization, with who, when, and what changed.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1.5" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-4 w-4 mr-1.5" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search actions, users, entities..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="pl-9"
              />
            </div>
            <Select value={entityFilter} onValueChange={(v) => { setEntityFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[160px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Entity type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All entities</SelectItem>
                <SelectItem value="lead">Leads</SelectItem>
                <SelectItem value="property">Properties</SelectItem>
                <SelectItem value="deal">Deals</SelectItem>
                <SelectItem value="note">Notes</SelectItem>
                <SelectItem value="document">Documents</SelectItem>
                <SelectItem value="campaign">Campaigns</SelectItem>
                <SelectItem value="payment">Payments</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">When</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }).map((_, j) => (
                        <TableCell key={j}>
                          <div className="h-4 bg-muted animate-pulse rounded w-3/4" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (data?.entries ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                      No audit log entries found
                    </TableCell>
                  </TableRow>
                ) : (
                  (data?.entries ?? []).map((entry) => {
                    const EntityIcon = entry.entityType
                      ? (ENTITY_ICONS[entry.entityType.toLowerCase()] ?? FileText)
                      : FileText;
                    return (
                      <TableRow key={entry.id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
                        </TableCell>
                        <TableCell>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${getActionColor(entry.action)}`}>
                            {entry.action.replace(/_/g, " ")}
                          </span>
                        </TableCell>
                        <TableCell>
                          {entry.entityType && (
                            <div className="flex items-center gap-1.5 text-sm">
                              <EntityIcon className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="capitalize">{entry.entityType}</span>
                              {entry.entityId && (
                                <span className="text-muted-foreground">#{entry.entityId}</span>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {entry.userEmail || entry.userId || "System"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">
                          {entry.metadata
                            ? Object.entries(entry.metadata)
                                .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                                .join(", ")
                                .slice(0, 120)
                            : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages} — {data?.total ?? 0} total entries
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
