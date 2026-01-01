import { Sidebar } from "@/components/layout-sidebar";
import { useProperties, useCreateProperty, useDeleteProperty } from "@/hooks/use-properties";
import { useFetchPropertyParcel } from "@/hooks/use-parcels";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertPropertySchema, type Property } from "@shared/schema";
import { z } from "zod";

// Client-side form schema that omits organizationId (added by server)
const propertyFormSchema = insertPropertySchema.omit({ organizationId: true });
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, MapPin, Ruler, DollarSign, Trash2, Loader2, Map as MapIcon, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { SinglePropertyMap } from "@/components/property-map";

export default function PropertiesPage() {
  const { data: properties, isLoading } = useProperties();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [deletingProperty, setDeletingProperty] = useState<Property | null>(null);
  const { mutate: deleteProperty, isPending: isDeleting } = useDeleteProperty();

  const handleDelete = () => {
    if (deletingProperty) {
      deleteProperty(deletingProperty.id, {
        onSuccess: () => setDeletingProperty(null),
      });
    }
  };

  return (
    <div className="flex min-h-screen bg-background desert-gradient">
      <Sidebar />
      <main className="flex-1 md:ml-[17rem] p-8">
        <div className="max-w-7xl mx-auto space-y-8">
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold" data-testid="text-page-title">Inventory</h1>
              <p className="text-muted-foreground">Track land parcels and their status.</p>
            </div>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button className="shadow-lg hover:shadow-primary/25" data-testid="button-add-property">
                  <Plus className="w-4 h-4 mr-2" /> Add Property
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle>Add New Property</DialogTitle>
                </DialogHeader>
                <PropertyForm onSuccess={() => setIsCreateOpen(false)} />
              </DialogContent>
            </Dialog>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1,2,3].map(i => (
                <div key={i} className="h-64 rounded-2xl bg-slate-200 dark:bg-slate-800 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {properties?.map((property) => (
                <PropertyCard 
                  key={property.id} 
                  property={property} 
                  onDelete={() => setDeletingProperty(property)}
                />
              ))}
              {properties?.length === 0 && (
                <div className="col-span-full">
                  <EmptyState
                    icon={MapPin}
                    title="No properties yet"
                    description="No properties in your inventory. Add your first property to start tracking land parcels and their status."
                    actionLabel="Add Your First Property"
                    onAction={() => setIsCreateOpen(true)}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <ConfirmDialog
        open={!!deletingProperty}
        onOpenChange={(open) => !open && setDeletingProperty(null)}
        title="Delete Property"
        description={`Are you sure you want to delete this property in ${deletingProperty?.county}, ${deletingProperty?.state} (APN: ${deletingProperty?.apn})? This action cannot be undone and will permanently remove the property from your inventory.`}
        confirmLabel="Delete Property"
        onConfirm={handleDelete}
        isLoading={isDeleting}
        variant="destructive"
      />
    </div>
  );
}

function PropertyCard({ property, onDelete }: { property: Property; onDelete: () => void }) {
  const { mutate: fetchParcel, isPending: isFetchingParcel } = useFetchPropertyParcel();
  const hasMapData = property.parcelBoundary && property.parcelCentroid;

  return (
    <Card className="card-hover border-border/50 group" data-testid={`card-property-${property.id}`}>
      <div className="h-40 bg-slate-100 dark:bg-slate-900 relative overflow-hidden">
        {hasMapData ? (
          <SinglePropertyMap
            boundary={property.parcelBoundary}
            centroid={property.parcelCentroid}
            apn={property.apn}
            height="160px"
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <MapPin className="w-8 h-8 text-slate-300 dark:text-slate-700 mx-auto mb-2" />
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  fetchParcel(property.id);
                }}
                disabled={isFetchingParcel}
                data-testid={`button-fetch-parcel-${property.id}`}
              >
                {isFetchingParcel ? (
                  <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Fetching...</>
                ) : (
                  <><MapIcon className="w-3 h-3 mr-1" /> Fetch Map</>
                )}
              </Button>
            </div>
          </div>
        )}
        <div className="absolute top-2 right-2 flex gap-1 z-10">
          <Badge variant={property.status === 'available' ? 'default' : 'secondary'} className="capitalize shadow-sm text-xs">
            {property.status.replace('_', ' ')}
          </Badge>
        </div>
        <div className="absolute top-2 left-2 flex gap-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button 
            variant="destructive" 
            size="icon"
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            data-testid={`button-delete-property-${property.id}`}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
          {hasMapData && (
            <Button 
              variant="secondary" 
              size="icon"
              className="h-7 w-7"
              onClick={(e) => {
                e.stopPropagation();
                fetchParcel(property.id);
              }}
              disabled={isFetchingParcel}
              data-testid={`button-refresh-parcel-${property.id}`}
            >
              <RefreshCw className={`w-3 h-3 ${isFetchingParcel ? 'animate-spin' : ''}`} />
            </Button>
          )}
        </div>
      </div>
      <CardContent className="p-4">
        <div className="mb-3">
          <h3 className="font-bold text-base truncate">{property.county}, {property.state}</h3>
          <p className="text-xs text-muted-foreground font-mono">APN: {property.apn}</p>
        </div>
        
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Ruler className="w-3.5 h-3.5" />
            <span>{property.sizeAcres} Acres</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <DollarSign className="w-3.5 h-3.5" />
            <span>${Number(property.marketValue || 0).toLocaleString()}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PropertyForm({ onSuccess }: { onSuccess: () => void }) {
  const { mutate, isPending } = useCreateProperty();
  const form = useForm<z.infer<typeof propertyFormSchema>>({
    resolver: zodResolver(propertyFormSchema),
    defaultValues: {
      apn: "",
      sizeAcres: "",
      county: "",
      state: "",
      purchasePrice: "",
      marketValue: "",
      description: "",
      status: "available",
    }
  });

  const onSubmit = (data: z.infer<typeof propertyFormSchema>) => {
    mutate(data, { onSuccess });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="apn"
            render={({ field }) => (
              <FormItem>
                <FormLabel>APN</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="123-456-789" data-testid="input-apn" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="sizeAcres"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Acres</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="5.0" data-testid="input-acres" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="county"
            render={({ field }) => (
              <FormItem>
                <FormLabel>County</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="San Bernardino" data-testid="input-county" />
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
                <FormControl>
                  <Input {...field} placeholder="CA" data-testid="input-state" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="purchasePrice"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Purchase Price</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="5000" type="number" data-testid="input-purchase-price" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="marketValue"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Market Value</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="15000" type="number" data-testid="input-market-value" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Beautiful desert lot with road access..." data-testid="input-description" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="pt-2">
          <Button type="submit" className="w-full" disabled={isPending} data-testid="button-submit-property">
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Adding...
              </>
            ) : (
              "Add Property"
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
