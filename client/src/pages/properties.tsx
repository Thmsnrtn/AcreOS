import { Sidebar } from "@/components/layout-sidebar";
import { useProperties, useCreateProperty } from "@/hooks/use-properties";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertPropertySchema } from "@shared/schema";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, MapPin, Ruler, DollarSign } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function PropertiesPage() {
  const { data: properties, isLoading } = useProperties();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-8">
        <div className="max-w-7xl mx-auto space-y-8">
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">Inventory</h1>
              <p className="text-muted-foreground">Track land parcels and their status.</p>
            </div>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button className="shadow-lg hover:shadow-primary/25">
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
                <PropertyCard key={property.id} property={property} />
              ))}
              {properties?.length === 0 && (
                <div className="col-span-full text-center py-20 text-muted-foreground">
                  No properties in inventory.
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function PropertyCard({ property }: { property: any }) {
  return (
    <Card className="card-hover border-border/50 group">
      <div className="h-32 bg-slate-100 dark:bg-slate-900 relative overflow-hidden flex items-center justify-center">
        {/* Placeholder for map image - typically integration with Mapbox/Google Maps */}
        <MapPin className="w-12 h-12 text-slate-300 dark:text-slate-700" />
        <div className="absolute top-4 right-4">
          <Badge variant={property.status === 'available' ? 'default' : 'secondary'} className="capitalize shadow-sm">
            {property.status.replace('_', ' ')}
          </Badge>
        </div>
      </div>
      <CardContent className="p-6">
        <div className="mb-4">
          <h3 className="font-bold text-lg truncate">{property.county}, {property.state}</h3>
          <p className="text-sm text-muted-foreground font-mono">APN: {property.apn}</p>
        </div>
        
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
            <Ruler className="w-4 h-4" />
            <span>{property.sizeAcres} Acres</span>
          </div>
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
            <DollarSign className="w-4 h-4" />
            <span>${Number(property.marketValue).toLocaleString()}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PropertyForm({ onSuccess }: { onSuccess: () => void }) {
  const { mutate, isPending } = useCreateProperty();
  const form = useForm<z.infer<typeof insertPropertySchema>>({
    resolver: zodResolver(insertPropertySchema),
    defaultValues: {
      status: "available",
    }
  });

  const onSubmit = (data: z.infer<typeof insertPropertySchema>) => {
    mutate(data, { onSuccess });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">APN</label>
          <Input {...form.register("apn")} placeholder="123-456-789" />
          {form.formState.errors.apn && <p className="text-xs text-red-500">{form.formState.errors.apn.message}</p>}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Acres</label>
          <Input {...form.register("sizeAcres")} placeholder="5.0" />
          {form.formState.errors.sizeAcres && <p className="text-xs text-red-500">{form.formState.errors.sizeAcres.message}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">County</label>
          <Input {...form.register("county")} placeholder="San Bernardino" />
          {form.formState.errors.county && <p className="text-xs text-red-500">{form.formState.errors.county.message}</p>}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">State</label>
          <Input {...form.register("state")} placeholder="CA" />
          {form.formState.errors.state && <p className="text-xs text-red-500">{form.formState.errors.state.message}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Purchase Price</label>
          <Input {...form.register("purchasePrice")} placeholder="5000" type="number" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Market Value</label>
          <Input {...form.register("marketValue")} placeholder="15000" type="number" />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Description</label>
        <Input {...form.register("description")} placeholder="Beautiful desert lot with road access..." />
      </div>

      <div className="pt-2">
        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? "Adding..." : "Add Property"}
        </Button>
      </div>
    </form>
  );
}
