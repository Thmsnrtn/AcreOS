import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { PropertyListing, Property } from "@shared/schema";
import { PageShell } from "@/components/page-shell";
import { ListSkeleton } from "@/components/list-skeleton";
import { EmptyState } from "@/components/empty-state";
import { PaymentCalculator } from "@/components/payment-calculator";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { 
  Plus, DollarSign, Eye, MessageSquare, Trash2, Loader2, 
  Globe, Share2, Edit, Building, MapPin, ImageIcon,
  Calculator
} from "lucide-react";

const SYNDICATION_TARGETS = [
  { id: "facebook_marketplace", name: "Facebook Marketplace", icon: Globe },
  { id: "craigslist", name: "Craigslist", icon: Globe },
  { id: "landwatch", name: "LandWatch", icon: Globe },
  { id: "landflip", name: "LandFlip", icon: Globe },
  { id: "lands_of_america", name: "Lands of America", icon: Globe },
  { id: "zillow", name: "Zillow", icon: Building },
];

const listingFormSchema = z.object({
  propertyId: z.number({ error: "Please select a property" }),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  askingPrice: z.string().min(1, "Asking price is required"),
  minimumPrice: z.string().optional(),
  sellerFinancingAvailable: z.boolean().default(true),
  downPaymentMin: z.string().optional(),
  monthlyPaymentMin: z.string().optional(),
  interestRate: z.string().optional(),
  termMonths: z.number().optional(),
  photoUrl: z.string().optional(),
  syndicationTargets: z.array(z.string()).default([]),
});

type ListingFormValues = z.infer<typeof listingFormSchema>;

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300",
  pending_sale: "bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300",
  sold: "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300",
  withdrawn: "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300",
};

export default function ListingsPage() {
  useDocumentTitle("Listings");
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedListing, setSelectedListing] = useState<PropertyListing | null>(null);
  const [publishTargets, setPublishTargets] = useState<string[]>([]);
  const [isPublishOpen, setIsPublishOpen] = useState(false);
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PropertyListing | null>(null);
  const [pendingUnpublish, setPendingUnpublish] = useState<PropertyListing | null>(null);

  const { data: listings, isLoading } = useQuery<PropertyListing[]>({
    queryKey: ["/api/listings"],
  });

  const { data: properties } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: ListingFormValues) => {
      const photos = data.photoUrl ? [{ url: data.photoUrl, isPrimary: true, order: 0 }] : [];
      return apiRequest("POST", "/api/listings", {
        propertyId: data.propertyId,
        title: data.title,
        description: data.description || null,
        askingPrice: data.askingPrice,
        minimumPrice: data.minimumPrice || null,
        sellerFinancingAvailable: data.sellerFinancingAvailable,
        downPaymentMin: data.downPaymentMin || null,
        monthlyPaymentMin: data.monthlyPaymentMin || null,
        interestRate: data.interestRate || null,
        termMonths: data.termMonths || null,
        photos: photos.length > 0 ? photos : null,
        status: "draft",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      setIsCreateOpen(false);
      toast({ title: "Listing created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Couldn't create listing", description: `${error.message} — your draft is preserved.`, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/listings/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      toast({ title: "Listing deleted" });
    },
    onError: (error: any) => {
      toast({ title: "Couldn't delete listing", description: `${error.message} — the listing is still live.`, variant: "destructive" });
    },
  });

  const publishMutation = useMutation({
    mutationFn: async ({ id, targets }: { id: number; targets: string[] }) => {
      return apiRequest("POST", `/api/listings/${id}/publish`, { targets });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      setIsPublishOpen(false);
      setPublishTargets([]);
      setPublishingId(null);
      toast({ title: "Listing published to selected platforms" });
    },
    onError: (error: any) => {
      toast({ title: "Couldn't publish listing", description: `${error.message} — no platforms received the listing.`, variant: "destructive" });
    },
  });

  const unpublishMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("POST", `/api/listings/${id}/unpublish`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      toast({ title: "Listing unpublished" });
    },
    onError: (error: any) => {
      toast({ title: "Couldn't unpublish listing", description: `${error.message} — the listing is still live on its current platforms.`, variant: "destructive" });
    },
  });

  const form = useForm<ListingFormValues>({
    resolver: zodResolver(listingFormSchema) as any,
    defaultValues: {
      title: "",
      description: "",
      askingPrice: "",
      minimumPrice: "",
      sellerFinancingAvailable: true,
      downPaymentMin: "",
      monthlyPaymentMin: "",
      interestRate: "9.9",
      termMonths: 60,
      photoUrl: "",
      syndicationTargets: [],
    },
  });

  const onSubmit = (values: ListingFormValues) => {
    createMutation.mutate(values);
  };

  const handleOpenPublish = (id: number) => {
    setPublishingId(id);
    setPublishTargets([]);
    setIsPublishOpen(true);
  };

  const handlePublish = () => {
    if (publishingId && publishTargets.length > 0) {
      publishMutation.mutate({ id: publishingId, targets: publishTargets });
    }
  };

  // P1 money-precision: canonical usd() preserves cents at boundaries; pages that
  // intentionally hide cents on listing prices opt in via { noCents: true }.
  const formatCurrency = (value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === "") return "$0";
    const num = typeof value === "string" ? parseFloat(value) : value;
    if (!Number.isFinite(num)) return "$0";
    return usd(num, { noCents: true });
  };

  const getProperty = (propertyId: number) => {
    return properties?.find((p) => p.id === propertyId);
  };

  const getPrimaryPhoto = (listing: PropertyListing) => {
    const photos = listing.photos as { url: string; isPrimary?: boolean }[] | null;
    if (!photos || photos.length === 0) return null;
    return photos.find((p) => p.isPrimary)?.url || photos[0]?.url;
  };

  return (
    <PageShell>
        <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Listings</h1>
            <p className="text-muted-foreground">Manage property listings and syndication</p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-listing">
                <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
                Create listing
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create new listing</DialogTitle>
                <DialogDescription>
                  Create a property listing to market for sale.
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField
                    control={form.control}
                    name="propertyId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Property</FormLabel>
                        <Select
                          onValueChange={(value) => field.onChange(parseInt(value))}
                          value={field.value?.toString()}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-property">
                              <SelectValue placeholder="Select a property" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {properties?.map((property) => (
                              <SelectItem
                                key={property.id}
                                value={property.id.toString()}
                              >
                                {property.apn || property.address} - {property.county}, {property.state}
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
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Listing title</FormLabel>
                        <FormControl>
                          <Input
                            data-testid="input-title"
                            placeholder="e.g., Beautiful 5-acre wooded lot"
                            autoCapitalize="words"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea
                            data-testid="input-description"
                            placeholder="Describe the property…"
                            rows={4}
                            autoCapitalize="sentences"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="askingPrice"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Asking price</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                              <Input
                                data-testid="input-asking-price"
                                type="number"
                                inputMode="decimal"
                                className="pl-9 tabular-nums"
                                placeholder="25000"
                                {...field}
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="minimumPrice"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Minimum price (optional)</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                              <Input
                                data-testid="input-minimum-price"
                                type="number"
                                inputMode="decimal"
                                className="pl-9 tabular-nums"
                                placeholder="20000"
                                {...field}
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="border rounded-md p-4 space-y-4">
                    <FormField
                      control={form.control}
                      name="sellerFinancingAvailable"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between gap-4">
                          <div>
                            <FormLabel>Seller financing available</FormLabel>
                            <p className="text-sm text-muted-foreground">
                              Allow buyers to pay over time.
                            </p>
                          </div>
                          <FormControl>
                            <Switch
                              data-testid="switch-seller-financing"
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    {form.watch("sellerFinancingAvailable") && (
                      <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                        <FormField
                          control={form.control}
                          name="downPaymentMin"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Min down payment %</FormLabel>
                              <FormControl>
                                <Input
                                  data-testid="input-down-payment"
                                  type="number"
                                  inputMode="decimal"
                                  className="tabular-nums"
                                  placeholder="10"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="interestRate"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Interest rate %</FormLabel>
                              <FormControl>
                                <Input
                                  data-testid="input-interest-rate"
                                  type="number"
                                  inputMode="decimal"
                                  step="0.1"
                                  className="tabular-nums"
                                  placeholder="9.9"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="termMonths"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Term (months)</FormLabel>
                              <Select
                                onValueChange={(value) => field.onChange(parseInt(value))}
                                value={field.value?.toString()}
                              >
                                <FormControl>
                                  <SelectTrigger data-testid="select-term-months">
                                    <SelectValue placeholder="Select term" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="12">12 months</SelectItem>
                                  <SelectItem value="24">24 months</SelectItem>
                                  <SelectItem value="36">36 months</SelectItem>
                                  <SelectItem value="48">48 months</SelectItem>
                                  <SelectItem value="60">60 months</SelectItem>
                                  <SelectItem value="84">84 months</SelectItem>
                                  <SelectItem value="120">120 months</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="monthlyPaymentMin"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Min monthly payment</FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                                  <Input
                                    data-testid="input-monthly-payment"
                                    type="number"
                                    inputMode="decimal"
                                    className="pl-9 tabular-nums"
                                    placeholder="250"
                                    {...field}
                                  />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    )}
                  </div>

                  <FormField
                    control={form.control}
                    name="photoUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Photo URL (optional)</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <ImageIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                            <Input
                              data-testid="input-photo-url"
                              type="url"
                              inputMode="url"
                              autoCapitalize="none"
                              autoCorrect="off"
                              spellCheck={false}
                              className="pl-9"
                              placeholder="https://example.com/photo.jpg"
                              {...field}
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsCreateOpen(false)}
                      data-testid="button-cancel-create"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={createMutation.isPending}
                      data-testid="button-submit-listing"
                    >
                      {createMutation.isPending && (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                      )}
                      Create listing
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <ListSkeleton />
        ) : !listings || listings.length === 0 ? (
          <EmptyState
            icon={Building}
            title="No listings yet"
            description="Create your first property listing to start marketing."
            actionLabel="Create listing"
            onAction={() => setIsCreateOpen(true)}
          />
        ) : (
          <Tabs defaultValue="grid" className="space-y-4">
            <TabsList>
              <TabsTrigger value="grid" data-testid="tab-grid-view">Grid view</TabsTrigger>
              <TabsTrigger value="detail" data-testid="tab-detail-view">Detail view</TabsTrigger>
            </TabsList>

            <TabsContent value="grid">
              <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 list-none p-0 m-0" aria-label={`${listings.length} listing${listings.length === 1 ? "" : "s"}`}>
                {listings.map((listing) => {
                  const property = getProperty(listing.propertyId);
                  const photoUrl = getPrimaryPhoto(listing);
                  const views = listing.viewCount || 0;
                  const inquiries = listing.inquiryCount || 0;
                  const statusLabel = listing.status.replace(/_/g, " ");

                  return (
                    <li key={listing.id}>
                    <Card
                      data-testid={`card-listing-${listing.id}`}
                      className="overflow-hidden h-full"
                    >
                      <div className="relative h-40 bg-muted">
                        {photoUrl ? (
                          <img
                            src={photoUrl}
                            alt={`Photo of ${listing.title}`}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="flex items-center justify-center h-full" role="img" aria-label="No photo available">
                            <ImageIcon className="h-12 w-12 text-muted-foreground" aria-hidden="true" />
                          </div>
                        )}
                        <Badge
                          className={`absolute top-2 right-2 ${STATUS_COLORS[listing.status] || ""}`}
                          data-testid={`badge-status-${listing.id}`}
                          aria-label={`Status: ${statusLabel}`}
                        >
                          {statusLabel}
                        </Badge>
                      </div>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-lg line-clamp-1">
                          {listing.title}
                        </CardTitle>
                        {property && (
                          <p className="text-sm text-muted-foreground flex items-center gap-1">
                            <MapPin className="h-3 w-3" aria-hidden="true" />
                            {property.county}, {property.state}
                          </p>
                        )}
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-xl font-bold tabular-nums" data-testid={`text-price-${listing.id}`} aria-label={`Asking price ${formatCurrency(listing.askingPrice)}`}>
                            {formatCurrency(listing.askingPrice)}
                          </span>
                          {listing.sellerFinancingAvailable && (
                            <Badge variant="outline">
                              Owner finance
                            </Badge>
                          )}
                        </div>
                        <dl className="flex items-center gap-4 text-sm text-muted-foreground m-0">
                          <div className="flex items-center gap-1" data-testid={`text-views-${listing.id}`}>
                            <Eye className="h-4 w-4" aria-hidden="true" />
                            <dt className="sr-only">Views</dt>
                            <dd className="m-0 tabular-nums">{views} view{views === 1 ? "" : "s"}</dd>
                          </div>
                          <div className="flex items-center gap-1" data-testid={`text-inquiries-${listing.id}`}>
                            <MessageSquare className="h-4 w-4" aria-hidden="true" />
                            <dt className="sr-only">Inquiries</dt>
                            <dd className="m-0 tabular-nums">{inquiries} {inquiries === 1 ? "inquiry" : "inquiries"}</dd>
                          </div>
                        </dl>
                      </CardContent>
                      <CardFooter className="pt-0 flex gap-2 flex-wrap">
                        {listing.status === "draft" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenPublish(listing.id)}
                            data-testid={`button-publish-${listing.id}`}
                            aria-label={`Publish ${listing.title}`}
                          >
                            <Share2 className="h-4 w-4 mr-1" aria-hidden="true" />
                            Publish
                          </Button>
                        )}
                        {listing.status === "active" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPendingUnpublish(listing)}
                            disabled={unpublishMutation.isPending}
                            data-testid={`button-unpublish-${listing.id}`}
                            aria-label={`Unpublish ${listing.title}`}
                          >
                            Unpublish
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedListing(listing)}
                          data-testid={`button-view-${listing.id}`}
                          aria-label={`Open payment calculator for ${listing.title}`}
                        >
                          <Calculator className="h-4 w-4 mr-1" aria-hidden="true" />
                          Calculator
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setPendingDelete(listing)}
                          disabled={deleteMutation.isPending}
                          aria-label={`Delete listing ${listing.title}`}
                          data-testid={`button-delete-${listing.id}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </CardFooter>
                    </Card>
                    </li>
                  );
                })}
              </ul>
            </TabsContent>
            
            <TabsContent value="detail">
              <ul className="space-y-4 list-none p-0 m-0">
                {listings.map((listing) => {
                  const property = getProperty(listing.propertyId);
                  const views = listing.viewCount || 0;
                  const inquiries = listing.inquiryCount || 0;
                  const statusLabel = listing.status.replace(/_/g, " ");

                  return (
                    <li key={listing.id}>
                    <Card data-testid={`card-detail-listing-${listing.id}`}>
                      <CardContent className="p-6">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                          <div>
                            <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
                              <div>
                                <h3 className="text-xl font-semibold">{listing.title}</h3>
                                {property && (
                                  <p className="text-muted-foreground">
                                    {property.county}, {property.state}
                                  </p>
                                )}
                              </div>
                              <Badge className={STATUS_COLORS[listing.status] || ""} aria-label={`Status: ${statusLabel}`}>
                                {statusLabel}
                              </Badge>
                            </div>

                            <p className="text-2xl font-bold tabular-nums mb-4" aria-label={`Asking price ${formatCurrency(listing.askingPrice)}`}>
                              {formatCurrency(listing.askingPrice)}
                            </p>

                            {listing.description && (
                              <p className="text-muted-foreground mb-4">
                                {listing.description}
                              </p>
                            )}

                            <dl className="flex items-center gap-4 text-sm mb-4 m-0">
                              <div className="flex items-center gap-1">
                                <Eye className="h-4 w-4" aria-hidden="true" />
                                <dt className="sr-only">Views</dt>
                                <dd className="m-0 tabular-nums">{views} view{views === 1 ? "" : "s"}</dd>
                              </div>
                              <div className="flex items-center gap-1">
                                <MessageSquare className="h-4 w-4" aria-hidden="true" />
                                <dt className="sr-only">Inquiries</dt>
                                <dd className="m-0 tabular-nums">{inquiries} {inquiries === 1 ? "inquiry" : "inquiries"}</dd>
                              </div>
                            </dl>

                            {listing.syndicationTargets && (listing.syndicationTargets as any[]).length > 0 && (
                              <div className="space-y-2">
                                <p className="text-sm font-medium">Syndication:</p>
                                <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
                                  {(listing.syndicationTargets as any[]).map((target, index) => (
                                    <li key={index}>
                                      <Badge
                                        variant={target.status === "active" ? "default" : "secondary"}
                                        aria-label={`${target.platform.replace(/_/g, " ")}: ${target.status}`}
                                      >
                                        {target.platform.replace(/_/g, " ")}
                                      </Badge>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>

                          <PaymentCalculator
                            listingPrice={parseFloat(listing.askingPrice?.toString() || "0")}
                            sellerFinancingAvailable={listing.sellerFinancingAvailable ?? true}
                            defaultDownPaymentPercent={listing.downPaymentMin ? parseFloat(listing.downPaymentMin.toString()) : 10}
                            defaultInterestRate={listing.interestRate ? parseFloat(listing.interestRate.toString()) : 9.9}
                            defaultTermMonths={listing.termMonths || 60}
                            onApply={() => toast({ title: "Application submitted" })}
                          />
                        </div>
                      </CardContent>
                    </Card>
                    </li>
                  );
                })}
              </ul>
            </TabsContent>
          </Tabs>
        )}

        <Dialog open={isPublishOpen} onOpenChange={setIsPublishOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Publish listing</DialogTitle>
              <DialogDescription>
                Select platforms to syndicate your listing to.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (publishTargets.length > 0 && !publishMutation.isPending) handlePublish();
              }}
            >
              <fieldset className="space-y-2 border-0 p-0 m-0">
                <legend className="sr-only">Syndication platforms</legend>
                <ul className="space-y-2 list-none p-0 m-0">
                  {SYNDICATION_TARGETS.map((target) => {
                    const checked = publishTargets.includes(target.id);
                    const cbId = `publish-target-${target.id}`;
                    return (
                      <li
                        key={target.id}
                        className="flex items-center justify-between gap-4 p-3 border rounded-md"
                      >
                        <Label htmlFor={cbId} className="flex items-center gap-3 cursor-pointer flex-1">
                          <target.icon className="h-5 w-5" aria-hidden="true" />
                          <span>{target.name}</span>
                        </Label>
                        <Checkbox
                          id={cbId}
                          data-testid={`checkbox-target-${target.id}`}
                          checked={checked}
                          onCheckedChange={(c) => {
                            if (c) setPublishTargets([...publishTargets, target.id]);
                            else setPublishTargets(publishTargets.filter((t) => t !== target.id));
                          }}
                        />
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
              <div className="flex justify-end gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsPublishOpen(false)}
                  data-testid="button-cancel-publish"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={publishTargets.length === 0 || publishMutation.isPending}
                  data-testid="button-confirm-publish"
                >
                  {publishMutation.isPending && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                  )}
                  Publish to {publishTargets.length} platform{publishTargets.length === 1 ? "" : "s"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={!!selectedListing} onOpenChange={(open) => !open && setSelectedListing(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Payment calculator</DialogTitle>
              <DialogDescription>
                {selectedListing?.title}
              </DialogDescription>
            </DialogHeader>
            {selectedListing && (
              <PaymentCalculator
                listingPrice={parseFloat(selectedListing.askingPrice?.toString() || "0")}
                sellerFinancingAvailable={selectedListing.sellerFinancingAvailable ?? true}
                defaultDownPaymentPercent={selectedListing.downPaymentMin ? parseFloat(selectedListing.downPaymentMin.toString()) : 10}
                defaultInterestRate={selectedListing.interestRate ? parseFloat(selectedListing.interestRate.toString()) : 9.9}
                defaultTermMonths={selectedListing.termMonths || 60}
                onApply={() => toast({ title: "Application submitted" })}
              />
            )}
          </DialogContent>
        </Dialog>

        <ConfirmDialog
          open={!!pendingDelete}
          onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
          title={`Delete listing "${pendingDelete?.title}"?`}
          description="This permanently removes the listing and any pending syndications. Inquiry history is preserved on the underlying property."
          confirmLabel="Delete listing"
          variant="destructive"
          onConfirm={() => {
            if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
            setPendingDelete(null);
          }}
        />

        <ConfirmDialog
          open={!!pendingUnpublish}
          onOpenChange={(open) => { if (!open) setPendingUnpublish(null); }}
          title={`Unpublish "${pendingUnpublish?.title}"?`}
          description="This pulls the listing from every active syndication target. View counts and inquiries to date are preserved; you can re-publish later."
          confirmLabel="Unpublish"
          onConfirm={() => {
            if (pendingUnpublish) unpublishMutation.mutate(pendingUnpublish.id);
            setPendingUnpublish(null);
          }}
        />
    </PageShell>
  );
}
