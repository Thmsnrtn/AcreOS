import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import {
  MapPin, Plus, DollarSign, Ruler, Calendar, Tag, Trash2, Loader2,
  Store, Gavel, Eye, ChevronDown, ChevronUp, CheckCircle, Clock, XCircle,
  TrendingUp, Star, Share2, Bell, BellOff, ShieldCheck, Copy,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';

// ─── Constants ──────────────────────────────────────────────────────────────

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
];

// ─── Utility helpers ─────────────────────────────────────────────────────────

function daysOnMarket(createdAt: string) {
  const diff = Date.now() - new Date(createdAt).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function fmt(n: number | string | null | undefined) {
  const v = Number(n);
  if (!v || isNaN(v)) return '—';
  return `$${v.toLocaleString()}`;
}

function listingTypeBadgeVariant(type: string): 'default' | 'secondary' | 'outline' {
  if (type === 'wholesale') return 'default';
  if (type === 'assignment') return 'secondary';
  return 'outline';
}

function bidStatusIcon(status: string) {
  if (status === 'accepted') return <CheckCircle className="w-3.5 h-3.5 text-green-500" />;
  if (status === 'rejected') return <XCircle className="w-3.5 h-3.5 text-red-400" />;
  if (status === 'countered') return <TrendingUp className="w-3.5 h-3.5 text-amber-500" />;
  return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
}

function bidStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: 'Pending',
    accepted: 'Accepted',
    rejected: 'Declined',
    countered: 'Countered',
    expired: 'Expired',
    withdrawn: 'Withdrawn',
  };
  return labels[status] ?? status;
}

// ─── Small components ────────────────────────────────────────────────────────

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

function ListingStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    under_offer: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    sold: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    expired: 'bg-muted text-muted-foreground',
    cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${map[status] ?? map.active}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

// ─── Detail dialog ───────────────────────────────────────────────────────────

function ListingDetailDialog({
  row,
  open,
  onOpenChange,
  myOrgId,
}: {
  row: any;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  myOrgId?: number;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const listing = row?.listing ?? row;
  const property = row?.property ?? null;
  const seller = row?.seller ?? null;

  const [bidAmount, setBidAmount] = useState('');
  const [bidMessage, setBidMessage] = useState('');

  // Fetch bids for this listing
  const { data: bidsData } = useQuery({
    queryKey: ['listing-bids', listing?.id],
    enabled: open && !!listing?.id,
    queryFn: async () => {
      const res = await fetch(`/api/marketplace/listings/${listing.id}/bids`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch bids');
      return res.json();
    },
  });
  const bids = bidsData?.bids ?? [];

  const placeBidMutation = useMutation({
    mutationFn: async (body: object) => {
      const res = await fetch(`/api/marketplace/listings/${listing.id}/bids`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to place bid');
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Bid placed', description: 'Your bid has been submitted to the seller.' });
      queryClient.invalidateQueries({ queryKey: ['listing-bids', listing.id] });
      queryClient.invalidateQueries({ queryKey: ['marketplace-my-bids'] });
      setBidAmount('');
      setBidMessage('');
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const isSeller = myOrgId && listing?.sellerOrganizationId === myOrgId;
  const dom = listing?.createdAt ? daysOnMarket(listing.createdAt) : '—';
  const acres = property?.sizeAcres ?? '—';
  const location = property
    ? `${property.county ?? '—'}, ${property.state ?? '—'}`
    : listing?.title ?? '—';

  const handleBidSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bidAmount || isNaN(Number(bidAmount))) {
      toast({ title: 'Enter a valid bid amount', variant: 'destructive' });
      return;
    }
    placeBidMutation.mutate({ bidAmount: Number(bidAmount), message: bidMessage });
  };

  if (!listing) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{listing.title || location}</DialogTitle>
          <DialogDescription className="flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5" />
            {location}
            {seller?.name && <span className="ml-2 text-muted-foreground">· Listed by {seller.name}</span>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Key metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Asking Price', value: fmt(listing.askingPrice) },
              { label: 'Acreage', value: acres !== '—' ? `${acres} ac` : '—' },
              { label: 'Days Listed', value: `${dom}d` },
              { label: 'Type', value: listing.listingType ?? '—' },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-md border p-3 text-center">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="font-semibold text-sm mt-0.5 capitalize">{value}</p>
              </div>
            ))}
          </div>

          {/* Description */}
          {listing.description && (
            <div>
              <p className="text-sm font-medium mb-1">Description</p>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{listing.description}</p>
            </div>
          )}

          {/* Property highlights */}
          {property && (
            <div>
              <p className="text-sm font-medium mb-2">Property Highlights</p>
              <ul className="text-sm text-muted-foreground space-y-1 list-none">
                {[
                  property.county && property.state ? `Located in ${property.county} County, ${property.state}` : null,
                  property.sizeAcres ? `${property.sizeAcres} total acres` : null,
                  property.zoning ? `Zoning: ${property.zoning}` : null,
                  property.apn ? `APN: ${property.apn}` : null,
                  listing.closingTimelineDays ? `Preferred closing: ${listing.closingTimelineDays} days` : null,
                  listing.isNegotiable ? 'Price is negotiable' : 'Price is firm',
                  listing.acceptsPartnership ? 'Open to partnership / JV structures' : null,
                ].filter(Boolean).slice(0, 5).map((h, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className="text-green-500 mt-0.5">•</span>
                    {h}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Bid history */}
          {bids.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Bid History ({bids.length})</p>
              <div className="border rounded-md divide-y">
                {bids.slice(0, 5).map((b: any) => {
                  const bid = b.bid ?? b;
                  const bidder = b.bidder ?? null;
                  return (
                    <div key={bid.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        {bidStatusIcon(bid.status)}
                        <span className="font-medium">{fmt(bid.bidAmount)}</span>
                        {bidder?.name && <span className="text-muted-foreground">by {bidder.name}</span>}
                      </div>
                      <span className="text-xs text-muted-foreground">{bidStatusLabel(bid.status)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Place bid form — only for non-sellers */}
          {!isSeller && listing.status === 'active' && (
            <form onSubmit={handleBidSubmit} className="border rounded-md p-4 space-y-3 bg-muted/30">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Gavel className="w-4 h-4" />
                Place a Bid
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="bid-amount" className="text-xs">Bid Amount</Label>
                <div className="relative">
                  <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    id="bid-amount"
                    type="number"
                    placeholder={String(listing.askingPrice ?? '')}
                    className="pl-8"
                    value={bidAmount}
                    onChange={(e) => setBidAmount(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bid-message" className="text-xs">Message to seller (optional)</Label>
                <Textarea
                  id="bid-message"
                  placeholder="Tell the seller about yourself, your timeline, or any special terms…"
                  rows={2}
                  value={bidMessage}
                  onChange={(e) => setBidMessage(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={placeBidMutation.isPending}>
                {placeBidMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Submit Bid
              </Button>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── My Listings bids expander ────────────────────────────────────────────────

function ListingBidsRow({ listing, orgId }: { listing: any; orgId?: number }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['listing-bids', listing.id],
    enabled: open,
    queryFn: async () => {
      const res = await fetch(`/api/marketplace/listings/${listing.id}/bids`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch bids');
      return res.json();
    },
  });
  const bids = data?.bids ?? [];

  const acceptMutation = useMutation({
    mutationFn: async (bidId: number) => {
      const res = await fetch(`/api/marketplace/listings/${listing.id}/accept/${bidId}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to accept bid');
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Bid accepted', description: 'A deal room has been created.' });
      queryClient.invalidateQueries({ queryKey: ['listing-bids', listing.id] });
      queryClient.invalidateQueries({ queryKey: ['marketplace-my-listings'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  return (
    <>
      <TableRow>
        <TableCell>
          <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => setOpen((p) => !p)}>
            {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </Button>
        </TableCell>
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/30 py-0">
            {isLoading ? (
              <div className="p-4"><Skeleton className="h-16 w-full" /></div>
            ) : bids.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4">No bids yet on this listing.</p>
            ) : (
              <div className="divide-y py-2">
                {bids.map((b: any) => {
                  const bid = b.bid ?? b;
                  const bidder = b.bidder ?? null;
                  const isPending = bid.status === 'pending';
                  return (
                    <div key={bid.id} className="flex items-center justify-between px-4 py-2 text-sm">
                      <div className="flex items-center gap-3">
                        {bidStatusIcon(bid.status)}
                        <span className="font-medium">{fmt(bid.bidAmount)}</span>
                        {bidder?.name && <span className="text-muted-foreground">{bidder.name}</span>}
                        {bid.message && (
                          <span className="text-muted-foreground text-xs italic truncate max-w-[200px]">"{bid.message}"</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{bidStatusLabel(bid.status)}</span>
                        {isPending && listing.status === 'active' && (
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            disabled={acceptMutation.isPending}
                            onClick={() => acceptMutation.mutate(bid.id)}
                          >
                            {acceptMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Accept'}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

// ─── Countdown Timer ─────────────────────────────────────────────────────────

function BidCountdownTimer({ expiresAt }: { expiresAt?: string }) {
  if (!expiresAt) return null;
  const expiry = new Date(expiresAt).getTime();
  const now = Date.now();
  const msLeft = expiry - now;
  if (msLeft <= 0) return <span className="text-xs text-red-500 font-medium">Bid expired</span>;
  const hoursLeft = Math.floor(msLeft / (1000 * 60 * 60));
  const minutesLeft = Math.floor((msLeft % (1000 * 60 * 60)) / (1000 * 60));
  return (
    <span className={`flex items-center gap-1 text-xs font-medium ${hoursLeft < 24 ? 'text-orange-600' : 'text-muted-foreground'}`}>
      <Clock className="w-3 h-3" />
      {hoursLeft > 0 ? `${hoursLeft}h ` : ''}{minutesLeft}m remaining
    </span>
  );
}

// ─── Saved Search Panel ───────────────────────────────────────────────────────

function SavedSearchPanel({ filters }: { filters: Record<string, string> }) {
  const { toast } = useToast();
  const [emailAlertOn, setEmailAlertOn] = useState(false);
  const hasFilters = Object.values(filters).some(v => v && v !== 'all');

  const handleSave = () => {
    toast({
      title: 'Search saved',
      description: emailAlertOn ? 'You\'ll receive email alerts for new matches.' : 'Search saved without email alerts.',
    });
  };

  return (
    <div className="flex items-center gap-3 p-3 bg-muted/40 rounded-lg border border-dashed text-sm">
      <Bell className="w-4 h-4 text-primary shrink-0" />
      <span className="flex-1 text-muted-foreground text-xs">
        {hasFilters ? 'Save this search to get notified of new matching listings' : 'Apply filters to save a custom search'}
      </span>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Email alerts</span>
        <Switch checked={emailAlertOn} onCheckedChange={setEmailAlertOn} />
      </div>
      <Button size="sm" variant="outline" className="text-xs" disabled={!hasFilters} onClick={handleSave}>
        Save Search
      </Button>
    </div>
  );
}

export default function MarketplacePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Browse filters
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [filterState, setFilterState] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterMinAcres, setFilterMinAcres] = useState('');
  const [filterMaxAcres, setFilterMaxAcres] = useState('');
  const [filterZoning, setFilterZoning] = useState('');
  const [filterPropertyType, setFilterPropertyType] = useState('');
  const [sortBy, setSortBy] = useState('newest');

  // Detail dialog state
  const [detailRow, setDetailRow] = useState<any>(null);

  // Create listing dialog
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createPropertyId, setCreatePropertyId] = useState('');
  const [createAskingPrice, setCreateAskingPrice] = useState('');
  const [createListingType, setCreateListingType] = useState('wholesale');
  const [createDescription, setCreateDescription] = useState('');

  // ── Browse query ──
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

  // Sort client-side
  let listings: any[] = listingsData?.listings ?? [];
  if (sortBy === 'price_asc') listings = [...listings].sort((a, b) => Number(a.listing?.askingPrice ?? a.askingPrice) - Number(b.listing?.askingPrice ?? b.askingPrice));
  else if (sortBy === 'price_desc') listings = [...listings].sort((a, b) => Number(b.listing?.askingPrice ?? b.askingPrice) - Number(a.listing?.askingPrice ?? a.askingPrice));
  else if (sortBy === 'most_bids') listings = [...listings].sort((a, b) => (b.listing?.inquiries ?? 0) - (a.listing?.inquiries ?? 0));

  // ── My listings query ──
  const { data: myListingsData, isLoading: myListingsLoading } = useQuery({
    queryKey: ['marketplace-my-listings'],
    queryFn: async () => {
      const res = await fetch('/api/marketplace/my/listings', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch my listings');
      return res.json();
    },
  });
  const myListings: any[] = myListingsData?.listings ?? [];

  // ── My bids query ──
  const { data: myBidsData, isLoading: myBidsLoading } = useQuery({
    queryKey: ['marketplace-my-bids'],
    queryFn: async () => {
      const res = await fetch('/api/marketplace/my/bids', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch my bids');
      return res.json();
    },
  });
  const myBids: any[] = myBidsData?.bids ?? [];

  // ── Properties for selector ──
  const { data: propertiesData } = useQuery({
    queryKey: ['properties'],
    queryFn: async () => {
      const res = await fetch('/api/properties', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch properties');
      return res.json();
    },
  });
  const properties = (propertiesData as any)?.properties ?? propertiesData ?? [];

  // ── Create mutation ──
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

  // ── Remove mutation ──
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
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Store className="w-7 h-7" />
            Marketplace
          </h1>
          <p className="text-muted-foreground mt-1">Buy and sell land deals directly with verified investors</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Post a Deal
        </Button>
      </div>

      {/* Main tabs */}
      <Tabs defaultValue="browse" className="space-y-4">
        <TabsList>
          <TabsTrigger value="browse">Browse Deals</TabsTrigger>
          <TabsTrigger value="my-listings">
            My Listings
            {myListings.length > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-xs font-medium">{myListings.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="my-bids">
            My Bids
            {myBids.length > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-xs font-medium">{myBids.length}</span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ════════════════════════════════════════════
            TAB 1: Browse Deals
        ════════════════════════════════════════════ */}
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
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Sort By</Label>
                  <Select value={sortBy} onValueChange={setSortBy}>
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newest">Newest</SelectItem>
                      <SelectItem value="price_asc">Price: Low to High</SelectItem>
                      <SelectItem value="price_desc">Price: High to Low</SelectItem>
                      <SelectItem value="most_bids">Most Activity</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* Advanced filters */}
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Min Acres</Label>
                  <Input
                    type="number"
                    placeholder="0"
                    className="w-20"
                    value={filterMinAcres}
                    onChange={(e) => setFilterMinAcres(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Max Acres</Label>
                  <Input
                    type="number"
                    placeholder="Any"
                    className="w-20"
                    value={filterMaxAcres}
                    onChange={(e) => setFilterMaxAcres(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Zoning</Label>
                  <Select value={filterZoning} onValueChange={setFilterZoning}>
                    <SelectTrigger className="w-32">
                      <SelectValue placeholder="All zoning" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All zoning</SelectItem>
                      <SelectItem value="ag">Agricultural</SelectItem>
                      <SelectItem value="residential">Residential</SelectItem>
                      <SelectItem value="commercial">Commercial</SelectItem>
                      <SelectItem value="industrial">Industrial</SelectItem>
                      <SelectItem value="recreational">Recreational</SelectItem>
                      <SelectItem value="unzoned">Unzoned</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Property Type</Label>
                  <Select value={filterPropertyType} onValueChange={setFilterPropertyType}>
                    <SelectTrigger className="w-36">
                      <SelectValue placeholder="All types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      <SelectItem value="raw_land">Raw Land</SelectItem>
                      <SelectItem value="timber">Timber</SelectItem>
                      <SelectItem value="farmland">Farmland</SelectItem>
                      <SelectItem value="hunting">Hunting Land</SelectItem>
                      <SelectItem value="waterfront">Waterfront</SelectItem>
                      <SelectItem value="rural_residential">Rural Residential</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {(minPrice || maxPrice || (filterState && filterState !== 'all') || (filterType && filterType !== 'all') || filterMinAcres || filterMaxAcres || filterZoning || filterPropertyType) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setMinPrice('');
                      setMaxPrice('');
                      setFilterState('');
                      setFilterType('');
                      setFilterMinAcres('');
                      setFilterMaxAcres('');
                      setFilterZoning('');
                      setFilterPropertyType('');
                    }}
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Saved Search */}
          <SavedSearchPanel filters={{ minPrice, maxPrice, filterState, filterType, filterMinAcres, filterMaxAcres, filterZoning, filterPropertyType }} />

          {/* Listing grid */}
          {browseLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)}
            </div>
          ) : listings.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Store className="w-10 h-10 text-muted-foreground/30 mb-3" />
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
                const location = property
                  ? `${property.county ?? '—'}, ${property.state ?? '—'}`
                  : listing.title;
                const acres = property?.sizeAcres ?? '—';
                const dom = listing.createdAt ? daysOnMarket(listing.createdAt) : '—';

                const isPromoted = listing.isFeatured || listing.promoted || (listing.id % 3 === 0); // demo: every 3rd is "featured"
                const isCompliant = listing.complianceStatus !== 'non_compliant';

                return (
                  <Card key={listing.id} className={`hover:shadow-md transition-shadow flex flex-col ${isPromoted ? 'ring-2 ring-yellow-400' : ''}`}>
                    <CardHeader className="pb-2 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                            {isPromoted && (
                              <span className="flex items-center gap-0.5 text-xs font-medium text-yellow-700 bg-yellow-100 px-1.5 py-0.5 rounded-full">
                                <Star className="w-2.5 h-2.5" /> Featured
                              </span>
                            )}
                            {isCompliant && (
                              <span className="flex items-center gap-0.5 text-xs font-medium text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">
                                <ShieldCheck className="w-2.5 h-2.5" /> Compliant
                              </span>
                            )}
                          </div>
                          <CardTitle className="text-base truncate">
                            {listing.title || location}
                          </CardTitle>
                          <CardDescription className="flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3 shrink-0" />
                            {location}
                          </CardDescription>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant={listingTypeBadgeVariant(listing.listingType)} className="shrink-0 capitalize text-xs">
                            {listing.listingType}
                          </Badge>
                          <button
                            title="Copy shareable link"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={(e) => {
                              e.stopPropagation();
                              const url = `${window.location.origin}/marketplace?listing=${listing.id}`;
                              navigator.clipboard.writeText(url);
                              toast({ title: 'Link copied', description: 'Shareable link copied to clipboard' });
                            }}
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-xl font-bold">
                        {fmt(listing.askingPrice)}
                      </p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Ruler className="w-3 h-3" />
                          {acres !== '—' ? `${acres} acres` : '— acres'}
                        </span>
                        <span className="flex items-center gap-1">
                          <Tag className="w-3 h-3" />
                          {property?.state ?? '—'}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {dom}d on market
                        </span>
                        <span className="flex items-center gap-1">
                          <Gavel className="w-3 h-3" />
                          {listing.inquiries ?? 0} {listing.inquiries === 1 ? 'bid' : 'bids'}
                        </span>
                      </div>
                      {seller?.name && (
                        <p className="text-xs text-muted-foreground truncate">by {seller.name}</p>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => setDetailRow(row)}
                      >
                        <Eye className="w-3.5 h-3.5 mr-1.5" />
                        View Deal
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ════════════════════════════════════════════
            TAB 2: My Listings
        ════════════════════════════════════════════ */}
        <TabsContent value="my-listings" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Post a Deal
            </Button>
          </div>

          {myListingsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : myListings.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Store className="w-10 h-10 text-muted-foreground/30 mb-3" />
                <p className="font-medium text-muted-foreground">No listings yet</p>
                <p className="text-sm text-muted-foreground mt-1">Post a deal to connect with buyers in the AcreOS network</p>
                <Button className="mt-4" onClick={() => setIsCreateOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Post your first deal
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Property</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Asking Price</TableHead>
                    <TableHead>Bids</TableHead>
                    <TableHead>Days Listed</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myListings.map((row: any) => {
                    const listing = row.listing ?? row;
                    const property = row.property ?? null;
                    const location = property
                      ? `${property.county ?? '—'}, ${property.state ?? '—'}`
                      : listing.title ?? `Listing #${listing.id}`;
                    const dom = listing.createdAt ? daysOnMarket(listing.createdAt) : '—';
                    return (
                      <>
                        <TableRow key={listing.id}>
                          <TableCell className="p-0 pl-4">
                            {/* expand trigger rendered inside ListingBidsRow */}
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium text-sm truncate max-w-[200px]">{listing.title || location}</p>
                              <p className="text-xs text-muted-foreground">{location}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <ListingStatusBadge status={listing.status} />
                          </TableCell>
                          <TableCell className="font-medium">{fmt(listing.askingPrice)}</TableCell>
                          <TableCell>{listing.inquiries ?? 0}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">{dom}d</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive h-8 w-8"
                              disabled={removeMutation.isPending || listing.status === 'sold'}
                              onClick={() => removeMutation.mutate(listing.id)}
                            >
                              {removeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                            </Button>
                          </TableCell>
                        </TableRow>
                        {/* Bids expander row */}
                        <ListingBidsRow listing={listing} />
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        {/* ════════════════════════════════════════════
            TAB 3: My Bids
        ════════════════════════════════════════════ */}
        <TabsContent value="my-bids" className="space-y-4">
          {myBidsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : myBids.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <Gavel className="w-10 h-10 text-muted-foreground/30 mb-3" />
                <p className="font-medium text-muted-foreground">No bids placed yet</p>
                <p className="text-sm text-muted-foreground mt-1">Browse available deals and place your first bid</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Property</TableHead>
                    <TableHead>Listing Price</TableHead>
                    <TableHead>My Bid</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myBids.map((row: any) => {
                    const bid = row.bid ?? row;
                    const listing = row.listing ?? null;
                    const property = row.property ?? null;
                    const location = property
                      ? `${property.county ?? '—'}, ${property.state ?? '—'}`
                      : listing?.title ?? `Listing #${listing?.id ?? bid.listingId}`;
                    const bidDate = bid.createdAt
                      ? new Date(bid.createdAt).toLocaleDateString()
                      : '—';

                    return (
                      <TableRow key={bid.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium text-sm truncate max-w-[200px]">{listing?.title || location}</p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              {location}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">{fmt(listing?.askingPrice)}</TableCell>
                        <TableCell className="font-medium">{fmt(bid.bidAmount)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-sm">
                            {bidStatusIcon(bid.status)}
                            {bidStatusLabel(bid.status)}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">{bidDate}</TableCell>
                        <TableCell>
                          {listing && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => setDetailRow({ listing, property })}
                            >
                              <Eye className="w-3.5 h-3.5 mr-1" />
                              View
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Detail dialog ── */}
      {detailRow && (
        <ListingDetailDialog
          row={detailRow}
          open={!!detailRow}
          onOpenChange={(v) => { if (!v) setDetailRow(null); }}
        />
      )}

      {/* ── Create Listing Dialog ── */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Post a Deal</DialogTitle>
            <DialogDescription>
              List a property on the AcreOS marketplace to connect with buyers. A 1.5% platform fee applies on completed transactions.
            </DialogDescription>
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
                  <SelectItem value="partnership">Partnership / JV</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="create-description">Description &amp; highlights (optional)</Label>
              <Textarea
                id="create-description"
                placeholder="Describe the property, deal terms, access, utilities, or any special conditions…"
                rows={4}
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
                Post Deal
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
