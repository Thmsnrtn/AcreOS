import { useState } from "react";
import { useLocation } from "wouter";
import { Users, Mail, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/animations";

interface Neighbor {
  apn: string;
  owner?: string;
  ownerAddress?: string;
  acres?: number;
  distance?: number;
}

interface NeighborOutreachProps {
  propertyId: number;
  isOwned: boolean;
}

export function NeighborOutreach({ propertyId, isOwned }: NeighborOutreachProps) {
  const { toast } = useToast();
  const [showList, setShowList] = useState(false);
  const [, setLocation] = useLocation();

  const { data, isLoading, error } = useQuery<{ neighbors: Neighbor[] }>({
    queryKey: [`/api/properties/${propertyId}/neighbors`],
    enabled: showList,
  });
  const queryClient = useQueryClient();

  const campaignMutation = useMutation({
    mutationFn: async (neighborApns: string[]) => {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Neighbor Outreach — Property ${propertyId}`,
          type: "direct_mail",
          targetApns: neighborApns,
          sourcePropertyId: propertyId,
        }),
      });
      if (!res.ok) throw new Error("Campaign creation failed");
      return res.json();
    },
    onSuccess: () => {
      // The new campaign must appear in the cached campaigns list.
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      toast({ title: "Campaign created", description: "Mailer campaign targeting neighbors is ready." });
    },
    onError: () => {
      toast({ title: "Couldn't create campaign", description: "No mailer was queued. Try again or check the system status.", variant: "destructive" });
    },
  });

  if (!isOwned) return null;

  const neighbors = data?.neighbors ?? [];
  const withOwner = neighbors.filter((n) => n.owner);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Users className="h-4 w-4" />
          Neighbor Outreach
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!showList ? (
          <Button variant="outline" size="sm" onClick={() => setShowList(true)}>
            <MapPin className="h-4 w-4 mr-1" />
            Contact Neighbors
          </Button>
        ) : isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-3/4" />
          </div>
        ) : error || neighbors.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            <p>Neighbor data requires parcel boundary information.</p>
            <Button
              variant="ghost"
              size="sm"
              className="px-0 mt-1 underline"
              onClick={() => setLocation(`/properties/${propertyId}?action=enrich`)}
            >
              Enrich this property
            </Button>
            <span className="text-xs"> to identify adjacent parcels.</span>
          </div>
        ) : (
          <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-2">
            {neighbors.slice(0, 10).map((n) => (
              <motion.div
                key={n.apn}
                variants={staggerItem}
                className="flex items-center justify-between text-sm py-1 border-b last:border-0"
              >
                <div className="truncate max-w-[60%]">
                  <span className="font-medium">{n.owner || "Unknown owner"}</span>
                  <span className="text-muted-foreground ml-2 text-xs">{n.apn}</span>
                </div>
                <div className="flex items-center gap-2">
                  {n.acres != null && (
                    <Badge variant="secondary" className="text-xs">
                      {n.acres.toFixed(1)} ac
                    </Badge>
                  )}
                </div>
              </motion.div>
            ))}

            {withOwner.length > 0 && (
              <Button
                size="sm"
                className="mt-2 w-full"
                onClick={() => campaignMutation.mutate(withOwner.map((n) => n.apn))}
                disabled={campaignMutation.isPending}
              >
                {campaignMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4 mr-1" />
                )}
                Send Mailer to {withOwner.length} Neighbor{withOwner.length !== 1 ? "s" : ""}
              </Button>
            )}
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}
