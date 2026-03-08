import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { MapPin, Plus, DollarSign, Ruler, Calendar, Tag, Pencil, Trash2, Loader2 } from 'lucide-react';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
];

function daysOnMarket(createdAt: string) {
  const diff = Date.now() - new Date(createdAt).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function listingTypeBadgeVariant(type: string): 'default' | 'secondary' | 'outline' {
  if (type === 'wholesale') return 'default';
  if (type === 'assignment') return 'secondary';
  return 'outline';
}

function CardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-5 w-3/4 mb-1" />
        <Skeleton className="h-4 w-1/2" />
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-6 w-1/3" />
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
        <Skeleton className="h-8 w-full mt-2" />
      </CardContent>
    </Card>
  );
}

function MyListingStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    under_offer: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    sold: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    expired: 'bg-muted text-muted-foreground',
    cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? map.active}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

export default function MarketplacePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Filters for browse tab
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [filterState, setFilterState] = useState('');
  const [filterType, setFilterType] = useState('');

  // Create listing dialog
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createPropertyId, setCreatePropertyId] = useState('');
  const [createAskingPrice, setCreateAskingPrice] = useState('');
  const [createListingType, setCreateListingType] = useState('wholesale');
  const [createDescription, setCreateDescription] = useState('');

  // Build query string for listings
  const browseParams = new URLSearchParams();
  if (minPrice) browseParams.set('minPrice', minPrice);
  if (maxPrice) browseParams.set('maxPrice', maxPrice);
  if (filterState && filterState !== 'all') browseParams.set('state', filterState);
  if (filterType && filterType !== 'all') browseParams.set('listingType', filterType);

  const { data: listingsData, isLoading: browseLoading } = useQuery({
    queryKey: ['marketplace-browse', minPrice, maxPrice, filterState, filterType],
    queryFn: async () => {
      const res = await fetch(`/api/marketplace/listings?${browseParams.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch listings');
      return res.json();
    },
  });
  const listings = listingsData?.listings ?? [];

  // My listings — same endpoint, server excludes own org; we re-fetch with a distinct key
  // In lieu of a dedicated "my listings" endpoint, use the seller org filter via stats
  const { data: myListingsData, isLoading: myLoading } = useQuery({
    queryKey: ['marketplace-my-listings'],
    queryFn: async () => {
      // Fetch all listings without excluding own org
      const res = await fetch('/api/marketplace/listings?includeOwn=true', {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch listings');
      return res.json();
    },
  });
  const myListings = myListingsData?.listings ?? [];

  const { data: propertiesData } = useQuery({
    queryKey: ['properties'],
    queryFn: async () => {
      const res = await fetch('/api/properties', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch properties');
      return res.json();
    },
  });
  const properties = (propertiesData as any)?.properties ?? propertiesData ?? [];

  const createMutation = useMutation({
    mutationFn: async (body: object) => {
      const res = await fetch('/api/marketplace/listings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create listing');
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Listing created', description: 'Your property is now live on the marketplace.' });
      queryClient.invalidateQueries({ queryKey: ['marketplace-browse'] });
      queryClient.invalidateQueries({ queryKey: ['marketplace-my-listings'] });
      setIsCreateOpen(false);
      setCreatePropertyId('');
      setCreateAskingPrice('');
      setCreateListingType('wholesale');
      setCreateDescription('');
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/marketplace/listings/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to remove listing');
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Listing removed' });
      queryClient.invalidateQueries({ queryKey: ['marketplace-my-listings'] });
      queryClient.invalidateQueries({ queryKey: ['marketplace-browse'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!createPropertyId || !createAskingPrice) {
      toast({ title: 'Missing fields', description: 'Please select a property and enter an asking price.', variant: 'destructive' });
      return;
    }
    createMutation.mutate({
      propertyId: parseInt(createPropertyId),
      askingPrice: createAskingPrice,
      listingType: createListingType,
      description: createDescription,
    });
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Marketplace</h1>
          <p className="text-muted-foreground mt-1">Buy and sell land directly with verified investors</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Create Listing
        </Button>
      </div>

      {/* Main tabs */}
      <Tabs defaultValue="browse" className="space-y-4">
        <TabsList>
          <TabsTrigger value="browse">Browse Listings</TabsTrigger>
          <TabsTrigger value="mine">My Listings</TabsTrigger>
        </TabsList>

        {/* ── BROWSE LISTINGS ── */}
        <TabsContent value="browse" className="space-y-4">
          {/* Filter bar */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Min Price</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      type="number"
                      placeholder="0"
                      className="pl-8 w-28"
                      value={minPrice}
                      onChange={(e) => setMinPrice(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Max Price</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      type="number"
                      placeholder="Any"
                      className="pl-8 w-28"
                      value={maxPrice}
                      onChange={(e) => setMaxPrice(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">State</Label>
                  <Select value={filterState} onValueChange={setFilterState}>
                    <SelectTrigger className="w-32">
                      <SelectValue placeholder="All states" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All states</SelectItem>
                      {US_STATES.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Listing Type</Label>
                  <Select value={filterType} onValueChange={setFilterType}>
                    <SelectTrigger className="w-36">
                      <SelectValue placeholder="All types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      <SelectItem value="wholesale">Wholesale</SelectItem>
                      <SelectItem value="assignment">Assignment</SelectItem>
                      <SelectItem value="retail">Retail</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(minPrice || maxPrice || (filterState && filterState !== 'all') || (filterType && filterType !== 'all')) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setMinPrice('');
                      setMaxPrice('');
                      setFilterState('');
                      setFilterType('');
                    }}
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Listing grid */}
          {browseLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)}
            </div>
          ) : listings.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <MapPin className="w-10 h-10 text-muted-foreground/30 mb-3" />
                <p className="font-medium text-muted-foreground">No listings match your filters</p>
                <p className="text-sm text-muted-foreground mt-1">Try adjusting the price range, state, or listing type</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {listings.map((row: any) => {
                const listing = row.listing ?? row;
                const property = row.property ?? null;
                const seller = row.seller ?? null;
                const address = property?.address || property
                  ? `${property?.county ?? '—'}, ${property?.state ?? '—'}`
                  : listing.title;
                const acres = property?.sizeAcres ?? '—';
                const state = property?.state ?? '—';
                const dom = listing.createdAt ? daysOnMarket(listing.createdAt) : '—';

                return (
                  <Card key={listing.id} className="hover:shadow-md transition-shadow">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <CardTitle className="text-base truncate">
                            {listing.title || address}
                          </CardTitle>
                          <CardDescription className="flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3 shrink-0" />
                            {address}
                          </CardDescription>
                        </div>
                        <Badge variant={listingTypeBadgeVariant(listing.listingType)} className="shrink-0 capitalize text-xs">
                          {listing.listingType}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-xl font-bold">
                        ${Number(listing.askingPrice).toLocaleString()}
                      </p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Ruler className="w-3 h-3" />
                          {acres} acres
                        </span>
                        <span className="flex items-center gap-1">
                          <Tag className="w-3 h-3" />
                          {state}
                        </span>
                        <span className="flex items-center gap-1 col-span-2">
                          <Calendar className="w-3 h-3" />
                          {dom} {dom === 1 ? 'day' : 'days'} on market
                          {seller?.name && <span className="ml-auto truncate max-w-[100px]">by {seller.name}</span>}
                        </span>
                      </div>
                      <Button variant="outline" size="sm" className="w-full">
                        View Details
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── MY LISTINGS ── */}
        <TabsContent value="mine" className="space-y-4">
          {myLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4 flex items-center gap-4">
                    <Skeleton className="h-10 w-10 rounded" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                    <Skeleton className="h-8 w-20" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : myListings.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Plus className="w-10 h-10 text-muted-foreground/30 mb-3" />
                <p className="font-medium text-muted-foreground">No listings yet</p>
                <p className="text-sm text-muted-foreground mt-1">List a property to connect with buyers on the marketplace</p>
                <Button className="mt-4" onClick={() => setIsCreateOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create your first listing
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {myListings.map((row: any) => {
                const listing = row.listing ?? row;
                const property = row.property ?? null;

                return (
                  <Card key={listing.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold truncate">
                              {listing.title || (property
                                ? `${property.county}, ${property.state}`
                                : `Listing #${listing.id}`)}
                            </span>
                            <MyListingStatusBadge status={listing.status} />
                            <Badge variant={listingTypeBadgeVariant(listing.listingType)} className="text-xs capitalize">
                              {listing.listingType}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            ${Number(listing.askingPrice).toLocaleString()}
                            {property && ` · ${property.sizeAcres} acres · ${property.state}`}
                            {listing.views != null && ` · ${listing.views} views`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm">
                            <Pencil className="w-3.5 h-3.5 mr-1" />
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            disabled={removeMutation.isPending}
                            onClick={() => removeMutation.mutate(listing.id)}
                          >
                            {removeMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Create Listing Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Marketplace Listing</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSubmit} className="space-y-4">
            {/* Property select */}
            <div className="space-y-1.5">
              <Label htmlFor="create-property">Property</Label>
              <Select value={createPropertyId} onValueChange={setCreatePropertyId}>
                <SelectTrigger id="create-property">
                  <SelectValue placeholder="Select a property" />
                </SelectTrigger>
                <SelectContent>
                  {(Array.isArray(properties) ? properties : []).map((p: any) => (
                    <SelectItem key={p.id} value={p.id.toString()}>
                      {p.address || `APN ${p.apn}`} — {p.county}, {p.state}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Asking price */}
            <div className="space-y-1.5">
              <Label htmlFor="create-price">Asking Price</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="create-price"
                  type="number"
                  placeholder="50000"
                  className="pl-9"
                  value={createAskingPrice}
                  onChange={(e) => setCreateAskingPrice(e.target.value)}
                />
              </div>
            </div>

            {/* Listing type */}
            <div className="space-y-1.5">
              <Label htmlFor="create-type">Listing Type</Label>
              <Select value={createListingType} onValueChange={setCreateListingType}>
                <SelectTrigger id="create-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="wholesale">Wholesale</SelectItem>
                  <SelectItem value="assignment">Assignment</SelectItem>
                  <SelectItem value="retail">Retail</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="create-description">Description (optional)</Label>
              <Textarea
                id="create-description"
                placeholder="Describe the property, terms, or any special conditions…"
                rows={3}
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Create Listing
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
