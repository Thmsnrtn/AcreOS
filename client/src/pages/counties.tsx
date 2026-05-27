import { PageShell } from "@/components/page-shell";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useOptimisticUpdate } from "@/lib/optimistic-mutation";
import { type TargetCounty, insertTargetCountySchema } from "@shared/schema";
import { z } from "zod";
import { ListSkeleton } from "@/components/list-skeleton";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Plus, MapPin, Star, Trash2, Pencil, Database, TrendingUp, Users, Target, Loader2 } from "lucide-react";

const countyFormSchema = insertTargetCountySchema.omit({ organizationId: true });
type CountyFormValues = z.infer<typeof countyFormSchema>;

const statusOptions = [
  { value: "researching", label: "Researching", color: "bg-acr-accent text-acr-accent dark:bg-acr-accent/30 dark:text-acr-accent" },
  { value: "active", label: "Active", color: "bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/30 dark:text-acr-pos" },
  { value: "paused", label: "Paused", color: "bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn" },
  { value: "exhausted", label: "Exhausted", color: "bg-muted text-muted-foreground" },
];

const dataSourceTypes = [
  { value: "tax_delinquent", label: "Tax delinquent", color: "bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft/30 dark:text-acr-neg" },
  { value: "probate", label: "Probate", color: "bg-acr-brand-soft text-acr-brand dark:bg-acr-brand-soft/30 dark:text-acr-brand" },
  { value: "vacant", label: "Vacant", color: "bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn" },
  { value: "absentee", label: "Absentee", color: "bg-acr-accent text-acr-accent dark:bg-acr-accent/30 dark:text-acr-accent" },
];

const PRIORITY_LABELS: Record<number, string> = {
  1: "Highest",
  2: "High",
  3: "Medium",
  4: "Low",
  5: "Lowest",
};

const reassurance = "Your form input is unchanged — try again.";

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"
];

function useTargetCounties() {
  return useQuery<TargetCounty[]>({
    queryKey: ["/api/target-counties"],
  });
}

function useCreateTargetCounty() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: CountyFormValues) => {
      const res = await apiRequest("POST", "/api/target-counties", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/target-counties"] });
      toast({ title: "County added", description: "Target county created successfully." });
    },
    onError: () => {
      toast({ title: "Couldn't create county", description: `Network error. ${reassurance}`, variant: "destructive" });
    },
  });
}

function useUpdateTargetCounty() {
  // Optimistic update — county settings reflect instantly in the list,
  // rolling back via the shared `useOptimisticUpdate` snapshot on
  // server rejection. The destructive toast in the factory's onError
  // covers the previous hand-rolled rejection message.
  return useOptimisticUpdate<{ id: number } & Partial<CountyFormValues>>({
    mutationFn: async ({ id, ...data }) => {
      const res = await apiRequest("PUT", `/api/target-counties/${id}`, data);
      return res.json();
    },
    listKeys: [["/api/target-counties"]],
    getId: ({ id }) => id,
    successToast: { title: "County updated", description: "Target county updated successfully." },
  });
}

function useDeleteTargetCounty() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/target-counties/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/target-counties"] });
      toast({ title: "County deleted", description: "Target county removed successfully." });
    },
    onError: () => {
      toast({ title: "Couldn't delete county", description: "The county is still in your list. Try again in a moment.", variant: "destructive" });
    },
  });
}

function PriorityStars({ priority }: { priority: number }) {
  return (
    <div
      className="flex items-center gap-0.5"
      role="img"
      aria-label={`Priority ${priority} of 5 (${PRIORITY_LABELS[priority] ?? "unset"})`}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`w-3.5 h-3.5 ${
            star <= priority
              ? "fill-acr-warn text-acr-warn"
              : "text-muted-foreground/30"
          }`}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function CountyCard({ county, onEdit, onDelete }: { 
  county: TargetCounty; 
  onEdit: () => void; 
  onDelete: () => void;
}) {
  const statusConfig = statusOptions.find(s => s.value === county.status) || statusOptions[0];
  const metrics = county.metrics || {};
  const dataSources = county.dataSources || [];

  return (
    <Card data-testid={`card-county-${county.id}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="text-lg" data-testid={`text-county-name-${county.id}`}>
              {county.name}
            </CardTitle>
            <Badge className={statusConfig.color} data-testid={`badge-status-${county.id}`} aria-label={`Status: ${statusConfig.label}`}>
              {statusConfig.label}
            </Badge>
          </div>
          <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground">
            <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
            <span data-testid={`text-county-state-${county.id}`}>{county.state}</span>
            {county.fipsCode && <span className="text-xs tabular-nums" aria-label={`FIPS code ${county.fipsCode}`}>({county.fipsCode})</span>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={onEdit}
            aria-label={`Edit county: ${county.name}, ${county.state}`}
            data-testid={`button-edit-county-${county.id}`}
          >
            <Pencil className="w-4 h-4" aria-hidden="true" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onDelete}
            aria-label={`Delete county: ${county.name}, ${county.state}`}
            data-testid={`button-delete-county-${county.id}`}
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Priority</span>
          <PriorityStars priority={county.priority || 1} />
        </div>

        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 rounded-md bg-muted/50">
            <div className="flex items-center justify-center gap-1">
              <Users className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
            </div>
            <dd className="text-lg font-semibold tabular-nums" data-testid={`text-leads-${county.id}`}>
              {metrics.leadsGenerated ?? 0}
            </dd>
            <dt className="text-xs text-muted-foreground">Leads</dt>
          </div>
          <div className="p-2 rounded-md bg-muted/50">
            <div className="flex items-center justify-center gap-1">
              <Target className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
            </div>
            <dd className="text-lg font-semibold tabular-nums" data-testid={`text-deals-${county.id}`}>
              {metrics.dealsCompleted ?? 0}
            </dd>
            <dt className="text-xs text-muted-foreground">Deals</dt>
          </div>
          <div className="p-2 rounded-md bg-muted/50">
            <div className="flex items-center justify-center gap-1">
              <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
            </div>
            <dd className="text-lg font-semibold tabular-nums" data-testid={`text-response-rate-${county.id}`}>
              {metrics.responseRate ? `${(metrics.responseRate * 100).toFixed(1)}%` : "0%"}
            </dd>
            <dt className="text-xs text-muted-foreground">Response</dt>
          </div>
        </dl>

        {dataSources.length > 0 && (
          <div>
            <p id={`data-sources-label-${county.id}`} className="flex items-center gap-1 mb-2 text-sm text-muted-foreground">
              <Database className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Data sources</span>
            </p>
            <ul className="flex flex-wrap gap-1.5 list-none p-0 m-0" aria-labelledby={`data-sources-label-${county.id}`}>
              {dataSources.map((source, idx) => {
                const typeConfig = dataSourceTypes.find(t => t.value === source.type);
                return (
                  <li key={idx}>
                    <Badge
                      className={typeConfig?.color || ""}
                      data-testid={`badge-source-${county.id}-${idx}`}
                      aria-label={`${typeConfig?.label || source.type} source: ${source.name}${source.recordCount ? `, ${source.recordCount} records` : ""}`}
                    >
                      {source.name}
                      {source.recordCount && (
                        <span className="ml-1 opacity-70 tabular-nums">({source.recordCount})</span>
                      )}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {county.notes && (
          <p className="text-sm text-muted-foreground line-clamp-2" data-testid={`text-notes-${county.id}`}>
            {county.notes}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function CountyForm({ 
  county, 
  onSubmit, 
  onCancel, 
  isPending 
}: { 
  county?: TargetCounty | null;
  onSubmit: (data: CountyFormValues) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const form = useForm<CountyFormValues>({
    resolver: zodResolver(countyFormSchema),
    defaultValues: {
      name: county?.name || "",
      state: county?.state || "",
      fipsCode: county?.fipsCode || "",
      population: county?.population || undefined,
      medianHomeValue: county?.medianHomeValue || "",
      averageLotPrice: county?.averageLotPrice || "",
      status: county?.status || "researching",
      priority: county?.priority || 3,
      notes: county?.notes || "",
      dataSources: county?.dataSources || [],
      metrics: county?.metrics || {},
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>County name</FormLabel>
                <FormControl>
                  <Input 
                    placeholder="e.g., Maricopa" 
                    {...field} 
                    data-testid="input-county-name"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="state"
            render={({ field }) => (
              <FormItem>
                <FormLabel>State</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-state">
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {US_STATES.map((state) => (
                      <SelectItem key={state} value={state}>
                        {state}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="fipsCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>FIPS code</FormLabel>
                <FormControl>
                  <Input 
                    placeholder="e.g., 04013" 
                    {...field} 
                    value={field.value || ""}
                    data-testid="input-fips-code"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="population"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Population</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    inputMode="numeric"
                    placeholder="e.g., 4500000"
                    {...field}
                    value={field.value || ""}
                    onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                    data-testid="input-population"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-status">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {statusOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="priority"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Priority (1-5)</FormLabel>
                <Select onValueChange={(val) => field.onChange(parseInt(val))} value={String(field.value || 3)}>
                  <FormControl>
                    <SelectTrigger data-testid="select-priority">
                      <SelectValue placeholder="Select priority" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((p) => (
                      <SelectItem key={p} value={String(p)}>
                        {p} — {PRIORITY_LABELS[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="medianHomeValue"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Median home value</FormLabel>
                <FormControl>
                  <Input 
                    placeholder="e.g., 350000" 
                    {...field}
                    value={field.value || ""}
                    data-testid="input-median-home-value"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="averageLotPrice"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Average lot price</FormLabel>
                <FormControl>
                  <Input 
                    placeholder="e.g., 25000" 
                    {...field}
                    value={field.value || ""}
                    data-testid="input-avg-lot-price"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes</FormLabel>
              <FormControl>
                <Textarea 
                  placeholder="Notes about this county…"
                  className="resize-none"
                  rows={3}
                  {...field}
                  value={field.value || ""}
                  data-testid="textarea-notes"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onCancel} data-testid="button-cancel">
            Cancel
          </Button>
          <Button type="submit" disabled={isPending} data-testid="button-submit">
            {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
            {county ? "Update county" : "Add county"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

export default function CountiesPage() {
  useDocumentTitle("Target counties");
  const { data: counties, isLoading } = useTargetCounties();
  const { mutate: createCounty, isPending: isCreating } = useCreateTargetCounty();
  const { mutate: updateCounty, isPending: isUpdating } = useUpdateTargetCounty();
  const { mutate: deleteCounty, isPending: isDeleting } = useDeleteTargetCounty();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCounty, setEditingCounty] = useState<TargetCounty | null>(null);
  const [deletingCounty, setDeletingCounty] = useState<TargetCounty | null>(null);
  const [filterState, setFilterState] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const filterStateId = useId();
  const filterStatusId = useId();

  const filteredCounties = (counties || []).filter((county) => {
    if (filterState !== "all" && county.state !== filterState) return false;
    if (filterStatus !== "all" && county.status !== filterStatus) return false;
    return true;
  });

  const uniqueStates = Array.from(new Set((counties || []).map(c => c.state))).sort();

  const handleOpenCreate = () => {
    setEditingCounty(null);
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (county: TargetCounty) => {
    setEditingCounty(county);
    setIsDialogOpen(true);
  };

  const handleSubmit = (data: CountyFormValues) => {
    if (editingCounty) {
      updateCounty({ id: editingCounty.id, ...data }, {
        onSuccess: () => setIsDialogOpen(false),
      });
    } else {
      createCounty(data, {
        onSuccess: () => setIsDialogOpen(false),
      });
    }
  };

  const handleDelete = () => {
    if (deletingCounty) {
      deleteCounty(deletingCounty.id, {
        onSuccess: () => setDeletingCounty(null),
      });
    }
  };

  return (
    <PageShell label="Counties">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Target counties</h1>
            <p className="text-muted-foreground">
              Manage your target markets and data sources
            </p>
          </div>
          <Button onClick={handleOpenCreate} data-testid="button-add-county">
            <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
            Add county
          </Button>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <Label htmlFor={filterStateId} className="sr-only">Filter by state</Label>
            <Select value={filterState} onValueChange={setFilterState}>
              <SelectTrigger id={filterStateId} className="w-[180px]" data-testid="select-filter-state">
                <SelectValue placeholder="Filter by state" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All states</SelectItem>
                {uniqueStates.map((state) => (
                  <SelectItem key={state} value={state}>
                    {state}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor={filterStatusId} className="sr-only">Filter by status</Label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger id={filterStatusId} className="w-[180px]" data-testid="select-filter-status">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {statusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(filterState !== "all" || filterStatus !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilterState("all");
                setFilterStatus("all");
              }}
              data-testid="button-clear-filters"
            >
              Clear filters
            </Button>
          )}
        </div>

        {isLoading ? (
          <ListSkeleton count={6} />
        ) : filteredCounties.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title={counties?.length === 0 ? "No target counties yet" : "No counties match filters"}
            description={
              counties?.length === 0
                ? "Add your first target county to start tracking acquisition markets."
                : "Try adjusting your filters to see more results."
            }
            actionLabel={counties?.length === 0 ? "Add county" : undefined}
            onAction={counties?.length === 0 ? handleOpenCreate : undefined}
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 list-none p-0 m-0" aria-label="Target counties">
            {filteredCounties.map((county) => (
              <li key={county.id}>
                <CountyCard
                  county={county}
                  onEdit={() => handleOpenEdit(county)}
                  onDelete={() => setDeletingCounty(county)}
                />
              </li>
            ))}
          </ul>
        )}

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle data-testid="text-dialog-title">
                {editingCounty ? "Edit county" : "Add target county"}
              </DialogTitle>
              <DialogDescription>
                {editingCounty 
                  ? "Update the details of this target county."
                  : "Add a new county to your target markets."}
              </DialogDescription>
            </DialogHeader>
            <CountyForm
              county={editingCounty}
              onSubmit={handleSubmit}
              onCancel={() => setIsDialogOpen(false)}
              isPending={isCreating || isUpdating}
            />
          </DialogContent>
        </Dialog>

        <ConfirmDialog
          open={!!deletingCounty}
          onOpenChange={(open) => !open && setDeletingCounty(null)}
          title="Delete county"
          description={`Are you sure you want to delete "${deletingCounty?.name}, ${deletingCounty?.state}"? This action cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={handleDelete}
          variant="destructive"
          isLoading={isDeleting}
        />
    </PageShell>
  );
}
