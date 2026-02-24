import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQuery, useMutation } from '@tanstack/react-query';
import { MapPin, TrendingUp, Users, DollarSign, MessageSquare, FileText } from 'lucide-react';

export default function MarketplacePage() {
  const [selectedListing, setSelectedListing] = useState<any>(null);
  const [bidAmount, setBidAmount] = useState('');
  const [showBidDialog, setShowBidDialog] = useState(false);

  // Fetch listings
  const { data: listings = [] } = useQuery({
    queryKey: ['marketplace-listings'],
    queryFn: async () => {
      const res = await fetch('/api/marketplace/listings');
      if (!res.ok) throw new Error('Failed to fetch listings');
      return res.json();
    },
  });

  // Fetch matches
  const { data: matches = [] } = useQuery({
    queryKey: ['marketplace-matches'],
    queryFn: async () => {
      const res = await fetch('/api/marketplace/matches');
      if (!res.ok) throw new Error('Failed to fetch matches');
      return res.json();
    },
  });

  // Place bid mutation
  const placeBidMutation = useMutation({
    mutationFn: async ({ listingId, amount }: { listingId: number; amount: number }) => {
      const res = await fetch(`/api/marketplace/listings/${listingId}/bids`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });
      if (!res.ok) throw new Error('Failed to place bid');
      return res.json();
    },
  });

  const handlePlaceBid = () => {
    if (!selectedListing || !bidAmount) return;

    placeBidMutation.mutate(
      {
        listingId: selectedListing.id,
        amount: parseFloat(bidAmount),
      },
      {
        onSuccess: () => {
          setShowBidDialog(false);
          setBidAmount('');
          // Refresh listings
        },
      }
    );
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">AcreOS Marketplace</h1>
          <p className="text-muted-foreground">Discover properties from fellow investors</p>
        </div>
        <Button>
          <DollarSign className="w-4 h-4 mr-2" />
          List a Property
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Listings</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{listings?.listings?.length ?? listings?.length ?? 0}</div>
            <p className="text-xs text-muted-foreground">Available on marketplace</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Your Matches</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{matches?.length ?? 0}</div>
            <p className="text-xs text-muted-foreground">Personalized for you</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs defaultValue="browse" className="space-y-4">
        <TabsList>
          <TabsTrigger value="browse">Browse Listings</TabsTrigger>
          <TabsTrigger value="matches">Your Matches</TabsTrigger>
          <TabsTrigger value="bids">Your Bids</TabsTrigger>
          <TabsTrigger value="deals">Deal Rooms</TabsTrigger>
        </TabsList>

        <TabsContent value="browse" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {listings.map((listing: any) => (
              <Card key={listing.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{listing.title || 'Untitled Property'}</CardTitle>
                      <CardDescription className="flex items-center gap-1 mt-1">
                        <MapPin className="w-3 h-3" />
                        {listing.county}, {listing.state}
                      </CardDescription>
                    </div>
                    <Badge variant={listing.featured ? 'default' : 'secondary'}>
                      {listing.featured ? 'Featured' : 'Active'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Price</span>
                      <span className="font-bold">${listing.price?.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Acres</span>
                      <span>{listing.acres}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Price/Acre</span>
                      <span>${listing.pricePerAcre?.toLocaleString()}</span>
                    </div>
                    {listing.currentBid && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Current Bid</span>
                        <span className="text-green-600 font-semibold">
                          ${listing.currentBid.toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        setSelectedListing(listing);
                        setShowBidDialog(true);
                      }}
                    >
                      Place Bid
                    </Button>
                    <Button size="sm" variant="outline">
                      View Details
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {listings.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <p className="text-muted-foreground">No listings available</p>
                <Button className="mt-4">List Your First Property</Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="matches" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Personalized Matches</CardTitle>
              <CardDescription>
                Properties that match your investment criteria
              </CardDescription>
            </CardHeader>
            <CardContent>
              {matches.length > 0 ? (
                <div className="space-y-4">
                  {matches.map((match: any) => (
                    <div
                      key={match.listingId}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div>
                        <h4 className="font-semibold">{match.property?.title}</h4>
                        <p className="text-sm text-muted-foreground">
                          Match Score: {match.score}%
                        </p>
                      </div>
                      <Button size="sm">View Match</Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">
                  No matches yet. Complete your investor profile to get personalized recommendations.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bids" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Your Active Bids</CardTitle>
              <CardDescription>Track the status of your bids</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-center text-muted-foreground py-8">No active bids</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="deals" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Deal Rooms</CardTitle>
              <CardDescription>Collaborate on active transactions</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-center text-muted-foreground py-8">No active deal rooms</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Bid Dialog */}
      <Dialog open={showBidDialog} onOpenChange={setShowBidDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Place Bid</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Property</p>
              <p className="font-semibold">{selectedListing?.title}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Asking Price</p>
              <p className="font-semibold">${selectedListing?.price?.toLocaleString()}</p>
            </div>
            {selectedListing?.currentBid && (
              <div>
                <p className="text-sm text-muted-foreground">Current Bid</p>
                <p className="font-semibold text-green-600">
                  ${selectedListing.currentBid.toLocaleString()}
                </p>
              </div>
            )}
            <div>
              <label className="text-sm font-medium">Your Bid Amount</label>
              <Input
                type="number"
                placeholder="Enter amount"
                value={bidAmount}
                onChange={(e) => setBidAmount(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handlePlaceBid} className="flex-1">
                Submit Bid
              </Button>
              <Button variant="outline" onClick={() => setShowBidDialog(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
