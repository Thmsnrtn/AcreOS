import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Share2, Copy, Check, Download, Sparkles, Globe, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

// ─── Share This Property ────────────────────────────────────────────
interface PropertyShareData {
  address?: string;
  county?: string;
  state?: string;
  sizeAcres?: number;
  price?: number;
  description?: string;
  photos?: string[];
  zoning?: string;
  roadAccess?: string;
}

interface SharePropertyProps {
  property: PropertyShareData;
}

function generateFacebookListing(p: PropertyShareData): string {
  const price = p.price ? `$${p.price.toLocaleString()}` : "Contact for price";
  const size = p.sizeAcres ? `${p.sizeAcres} acres` : "";
  const location = [p.county, p.state].filter(Boolean).join(", ");
  return `${size} ${p.zoning || "Land"} for Sale — ${location}\n${price}\n\n${p.description || `Beautiful ${size} parcel in ${location}. ${p.roadAccess ? `Road access: ${p.roadAccess}.` : ""}`}\n\nDM for details.`;
}

function generateCraigslistListing(p: PropertyShareData): string {
  const price = p.price ? `$${p.price.toLocaleString()}` : "Contact for price";
  const size = p.sizeAcres ? `${p.sizeAcres} acres` : "";
  const location = [p.county, p.state].filter(Boolean).join(", ");
  return `${size} ${p.zoning || "Land"} for Sale in ${location} — ${price}\n\n${p.description || ""}${p.description ? "\n\n" : ""}Property Details:\n- Size: ${size || "N/A"}\n- Location: ${location || "N/A"}\n- Zoning: ${p.zoning || "N/A"}\n- Road Access: ${p.roadAccess || "N/A"}\n- Price: ${price}\n\n${p.address ? `Address: ${p.address}\n\n` : ""}Contact me for more information or to schedule a visit. Serious inquiries only.`;
}

function generateSocialPost(p: PropertyShareData): string {
  const size = p.sizeAcres ? `${p.sizeAcres} acres` : "Land";
  const location = [p.county, p.state].filter(Boolean).join(", ");
  const price = p.price ? ` for $${p.price.toLocaleString()}` : "";
  return `${size} available in ${location}${price}. ${p.roadAccess ? `Has ${p.roadAccess} road access.` : ""} DM me for details.\n\n#LandForSale #RealEstate #${p.state || "Land"}Land #Investment`;
}

export function SharePropertySheet({ property }: SharePropertyProps) {
  const [copiedTab, setCopiedTab] = useState<string | null>(null);
  const { toast } = useToast();

  const formats = {
    facebook: generateFacebookListing(property),
    craigslist: generateCraigslistListing(property),
    social: generateSocialPost(property),
  };

  const handleCopy = async (text: string, tab: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedTab(tab);
    toast({ title: "Copied to clipboard" });
    setTimeout(() => setCopiedTab(null), 2000);
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Share this property">
          <Share2 className="h-4 w-4 mr-1" />
          Share Property
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[70vh]">
        <SheetHeader>
          <SheetTitle>Share This Property</SheetTitle>
        </SheetHeader>
        <Tabs defaultValue="facebook" className="mt-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="facebook">
              <Share2 className="h-3 w-3 mr-1" />
              Facebook
            </TabsTrigger>
            <TabsTrigger value="craigslist">
              <Globe className="h-3 w-3 mr-1" />
              Craigslist
            </TabsTrigger>
            <TabsTrigger value="social">
              <MessageCircle className="h-3 w-3 mr-1" />
              Social
            </TabsTrigger>
          </TabsList>
          {Object.entries(formats).map(([key, text]) => (
            <TabsContent key={key} value={key} className="space-y-3">
              <Textarea value={text} readOnly rows={8} className="font-mono text-sm" />
              <div className="flex gap-2">
                <Button onClick={() => handleCopy(text, key)} aria-label={`Copy ${key} listing`}>
                  {copiedTab === key ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                  {copiedTab === key ? "Copied" : "Copy"}
                </Button>
              </div>
            </TabsContent>
          ))}
        </Tabs>
        {property.photos && property.photos.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-medium mb-2">Photos ({property.photos.length})</p>
            <div className="flex gap-2 overflow-x-auto">
              {property.photos.slice(0, 6).map((url, i) => (
                <img key={i} src={url} alt={`Property photo ${i + 1}`} className="h-20 w-20 object-cover rounded" />
              ))}
            </div>
            <Button variant="outline" size="sm" className="mt-2" aria-label="Download photos">
              <Download className="h-4 w-4 mr-1" />
              Download Photos
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Share This Deal ────────────────────────────────────────────────
interface DealShareData {
  county?: string;
  state?: string;
  sizeAcres?: number;
  purchasePrice?: number;
  salePrice?: number;
  closedDate?: string;
  daysToClose?: number;
}

interface ShareDealProps {
  deal: DealShareData;
}

export function ShareDealSheet({ deal }: ShareDealProps) {
  const [copiedTab, setCopiedTab] = useState<string | null>(null);
  const { toast } = useToast();

  const location = [deal.county, deal.state].filter(Boolean).join(", ");
  const size = deal.sizeAcres ? `${deal.sizeAcres} acres` : "a parcel";
  const roi = deal.purchasePrice && deal.salePrice
    ? Math.round(((deal.salePrice - deal.purchasePrice) / deal.purchasePrice) * 100)
    : null;
  const profit = deal.purchasePrice && deal.salePrice
    ? deal.salePrice - deal.purchasePrice
    : null;

  const socialPost = `Just closed on ${size} in ${location}${deal.daysToClose ? `, closed in ${deal.daysToClose} days` : ""}. ${roi ? `${roi}% ROI.` : ""} #LandInvesting\nFound via @AcreOS`;

  const caseStudy = `Acquired a ${size} parcel in ${location}${deal.purchasePrice ? ` for $${deal.purchasePrice.toLocaleString()}` : ""}. Used the AcreOS DD report to verify no environmental risks.${deal.salePrice ? ` Sold for $${deal.salePrice.toLocaleString()}` : ""}${deal.daysToClose ? ` in ${deal.daysToClose} days` : ""}${roi ? ` — ${roi}% ROI` : ""}${profit ? ` ($${profit.toLocaleString()} profit)` : ""}.`;

  const handleCopy = async (text: string, tab: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedTab(tab);
    toast({ title: "Copied to clipboard" });
    setTimeout(() => setCopiedTab(null), 2000);
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Share this deal">
          <Share2 className="h-4 w-4 mr-1" />
          Share Deal
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[60vh]">
        <SheetHeader>
          <SheetTitle>Share This Deal</SheetTitle>
        </SheetHeader>
        <Tabs defaultValue="social" className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="social">Social Post</TabsTrigger>
            <TabsTrigger value="casestudy">Case Study</TabsTrigger>
          </TabsList>
          <TabsContent value="social" className="space-y-3">
            <Textarea value={socialPost} readOnly rows={4} className="font-mono text-sm" />
            <Button onClick={() => handleCopy(socialPost, "social")} aria-label="Copy social post">
              {copiedTab === "social" ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
              {copiedTab === "social" ? "Copied" : "Copy"}
            </Button>
          </TabsContent>
          <TabsContent value="casestudy" className="space-y-3">
            <Textarea value={caseStudy} readOnly rows={6} className="font-mono text-sm" />
            <Button onClick={() => handleCopy(caseStudy, "casestudy")} aria-label="Copy case study">
              {copiedTab === "casestudy" ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
              {copiedTab === "casestudy" ? "Copied" : "Copy"}
            </Button>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

// ─── Generate Campaign Copy ─────────────────────────────────────────
interface GenerateCampaignCopyProps {
  onGenerated: (subject: string, body: string) => void;
  audienceDescription?: string;
}

export function GenerateCampaignCopy({ onGenerated, audienceDescription }: GenerateCampaignCopyProps) {
  const { toast } = useToast();

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ai/generate-campaign-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audienceDescription }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to generate copy");
      return res.json() as Promise<{ subject: string; body: string }>;
    },
    onSuccess: (data) => {
      onGenerated(data.subject, data.body);
      toast({ title: "Campaign copy generated", description: "Review and edit before sending." });
    },
    onError: () => {
      toast({ title: "Generation failed", description: "Could not generate copy. Try again.", variant: "destructive" });
    },
  });

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => generateMutation.mutate()}
      disabled={generateMutation.isPending}
      aria-label="Generate campaign copy with AI"
    >
      <Sparkles className="h-4 w-4 mr-1" />
      {generateMutation.isPending ? "Generating..." : "Generate Copy"}
    </Button>
  );
}
