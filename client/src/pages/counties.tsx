import { Sidebar } from "@/components/layout-sidebar";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { type TargetCounty, insertTargetCountySchema } from "@shared/schema";
import { z } from "zod";
import { ListSkeleton } from "@/components/list-skeleton";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/hooks/use-toast";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Plus, MapPin, Star, Trash2, Pencil, Database, TrendingUp, Users, Target, Loader2 } from "lucide-react";

const countyFormSchema = insertTargetCountySchema.omit({ organizationId: true });
type CountyFormValues = z.infer<typeof countyFormSchema>;

const statusOptions = [
  { value: "researching", label: "Researching", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
  { value: "active", label: "Active", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400" },
  { value: "paused", label: "Paused", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" },
  { value: "exhausted", label: "Exhausted", color: "bg-muted text-muted-foreground" },
];

const dataSourceTypes = [
  { value: "tax_delinquent", label: "Tax Delinquent", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
  { value: "probate", label: "Probate", color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400" },
  { value: "vacant", label: "Vacant", color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400" },
  { value: "absentee", label: "Absentee", color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400" },
];

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
      toast({ title: "Error", description: "Failed to create county.", variant: "destructive" });
    },
  });
}

function useUpdateTargetCounty() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: number } & Partial<CountyFormValues>) => {
      const res = await apiRequest("PUT", `/api/target-counties/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/target-counties"] });
      toast({ title: "County updated", description: "Target county updated successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update county.", variant: "destructive" });
    },
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
      toast({ title: "Error", description: "Failed to delete county.", variant: "destructive" });
    },
  });
}

function PriorityStars({ priority }: { priority: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`w-3.5 h-3.5 ${
            star <= priority
              ? "fill-amber-400 text-amber-400"
              : "text-muted-foreground/30"
          }`}
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
            <Badge size="sm" className={statusConfig.color} data-testid={`badge-status-${county.id}`}>
              {statusConfig.label}
            </Badge>
          </div>
          <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground">
            <MapPin className="w-3.5 h-3.5" />
            <span data-testid={`text-county-state-${county.id}`}>{county.state}</span>
            {county.fipsCode && <span className="text-xs">({county.fipsCode})</span>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={onEdit}
            data-testid={`button-edit-county-${county.id}`}
          >
            <Pencil className="w-4 h-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onDelete}
            data-testid={`button-delete-county-${county.id}`}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Priority</span>
          <PriorityStars priority={county.priority || 1} />
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 rounded-md bg-muted/50">
            <div className="flex items-center justify-center gap-1">
              <Users className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <div className="text-lg font-semibold" data-testid={`text-leads-${county.id}`}>
              {metrics.leadsGenerated ?? 0}
            </div>
            <div className="text-xs text-muted-foreground">Leads</div>
          </div>
          <div className="p-2 rounded-md bg-muted/50">
            <div className="flex items-center justify-center gap-1">
              <Target className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <div className="text-lg font-semibold" data-testid={`text-deals-${county.id}`}>
              {metrics.dealsCompleted ?? 0}
            </div>
            <div className="text-xs text-muted-foreground">Deals</div>
          </div>
          <div className="p-2 rounded-md bg-muted/50">
            <div className="flex items-center justify-center gap-1">
              <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <div className="text-lg font-semibold" data-testid={`text-response-rate-${county.id}`}>
              {metrics.responseRate ? `${(metrics.responseRate * 100).toFixed(1)}%` : "0%"}
            </div>
            <div className="text-xs text-muted-foreground">Response</div>
          </div>
        </div>

        {dataSources.length > 0 && (
          <div>
            <div className="flex items-center gap-1 mb-2 text-sm text-muted-foreground">
              <Database className="w-3.5 h-3.5" />
              <span>Data Sources</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {dataSources.map((source, idx) => {
                const typeConfig = dataSourceTypes.find(t => t.value === source.type);
                return (
                  <Badge
                    key={idx}
                    size="sm"
                    className={typeConfig?.color || ""}
                    data-testid={`badge-source-${county.id}-${idx}`}
                  >
                    {source.name}
                    {source.recordCount && (
                      <span className="ml-1 opacity-70">({source.recordCount})</span>
                    )}
                  </Badge>
                );
              })}
            </div>
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
                <FormLabel>County Name</FormLabel>
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
                <FormLabel>FIPS Code</FormLabel>
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
                        {p} - {p === 1 ? "Highest" : p === 5 ? "Lowest" : ""}
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
                <FormLabel>Median Home Value</FormLabel>
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
                <FormLabel>Average Lot Price</FormLabel>
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
                  placeholder="Notes about this county..." 
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
            {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {county ? "Update County" : "Add County"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

export default function CountiesPage() {
  const { data: counties, isLoading } = useTargetCounties();
  const { mutate: createCounty, isPending: isCreating } = useCreateTargetCounty();
  const { mutate: updateCounty, isPending: isUpdating } = useUpdateTargetCounty();
  const { mutate: deleteCounty, isPending: isDeleting } = useDeleteTargetCounty();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCounty, setEditingCounty] = useState<TargetCounty | null>(null);
  const [deletingCounty, setDeletingCounty] = useState<TargetCounty | null>(null);
  const [filterState, setFilterState] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const filteredCounties = (counties || []).filter((county) => {
    if (filterState !== "all" && county.state !== filterState) return false;
    if (filterStatus !== "all" && county.status !== filterStatus) return false;
    return true;
  });

  const uniqueStates = [...new Set((counties || []).map(c => c.state))].sort();

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
    <Sidebar>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Target Counties</h1>
            <p className="text-muted-foreground">
              Manage your target markets and data sources
            </p>
          </div>
          <Button onClick={handleOpenCreate} data-testid="button-add-county">
            <Plus className="w-4 h-4 mr-2" />
            Add County
          </Button>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <Select value={filterState} onValueChange={setFilterState}>
            <SelectTrigger className="w-[180px]" data-testid="select-filter-state">
              <SelectValue placeholder="Filter by state" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All States</SelectItem>
              {uniqueStates.map((state) => (
                <SelectItem key={state} value={state}>
                  {state}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[180px]" data-testid="select-filter-status">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {statusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

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
            action={
              counties?.length === 0 ? (
                <Button onClick={handleOpenCreate} data-testid="button-add-county-empty">
                  <Plus className="w-4 h-4 mr-2" />
                  Add County
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredCounties.map((county) => (
              <CountyCard
                key={county.id}
                county={county}
                onEdit={() => handleOpenEdit(county)}
                onDelete={() => setDeletingCounty(county)}
              />
            ))}
          </div>
        )}

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle data-testid="text-dialog-title">
                {editingCounty ? "Edit County" : "Add Target County"}
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
          title="Delete County"
          description={`Are you sure you want to delete "${deletingCounty?.name}, ${deletingCounty?.state}"? This action cannot be undone.`}
          confirmText="Delete"
          onConfirm={handleDelete}
          variant="destructive"
          isLoading={isDeleting}
        />
      </div>
    </Sidebar>
  );
}
