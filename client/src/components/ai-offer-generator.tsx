import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { 
  Loader2, 
  Sparkles, 
  DollarSign, 
  FileText, 
  Target, 
  TrendingUp, 
  TrendingDown,
  AlertCircle,
  CheckCircle,
  Copy,
  RefreshCw,
  ArrowRight,
  BarChart3,
  Brain,
  Lightbulb
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Property } from "@shared/schema";

interface OfferSuggestion {
  strategyName: string;
  offerAmount: number;
  confidence: number;
  reasoning: string;
  marketValuePercent: number;
}

interface GenerateOfferResponse {
  success: boolean;
  estimatedMarketValue: number;
  suggestions: OfferSuggestion[];
  marketAnalysis: {
    averagePricePerAcre: number;
    medianPricePerAcre: number;
    comparablesCount: number;
    marketTrend: string;
  };
  propertyScore: {
    totalScore: number;
    grade: string;
    factors: Array<{ name: string; score: number; maxScore: number; description: string }>;
  };
  aiReasoning: string;
  error?: string;
}

interface OfferLetterResponse {
  success: boolean;
  letter: string;
  subject: string;
  error?: string;
}

interface AcceptanceFactor {
  name: string;
  impact: "positive" | "negative" | "neutral";
  weight: number;
  description: string;
}

interface AcceptancePredictionResponse {
  success: boolean;
  probability: number;
  confidenceLevel: "low" | "medium" | "high";
  factors: AcceptanceFactor[];
  recommendation: string;
  error?: string;
}

interface AIOfferGeneratorProps {
  property: Property;
}

export function AIOfferGenerator({ property }: AIOfferGeneratorProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("suggestions");
  const [selectedOffer, setSelectedOffer] = useState<OfferSuggestion | null>(null);
  const [offerData, setOfferData] = useState<GenerateOfferResponse | null>(null);
  
  const [letterTone, setLetterTone] = useState<"professional" | "friendly" | "urgent">("professional");
  const [buyerName, setBuyerName] = useState("");
  const [buyerCompany, setBuyerCompany] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [earnestMoney, setEarnestMoney] = useState("");
  const [closingDays, setClosingDays] = useState("30");
  const [letterContent, setLetterContent] = useState("");
  const [letterSubject, setLetterSubject] = useState("");
  
  const [customOfferAmount, setCustomOfferAmount] = useState("");
  const [sellerMotivation, setSellerMotivation] = useState<"unknown" | "low" | "medium" | "high">("unknown");
  const [competingOffers, setCompetingOffers] = useState<"unknown" | "yes" | "no">("unknown");
  const [acceptanceData, setAcceptanceData] = useState<AcceptancePredictionResponse | null>(null);

  const hasCoordinates = property.parcelCentroid || (property.latitude && property.longitude);

  const propertyData = {
    id: property.id,
    apn: property.apn,
    address: property.address || undefined,
    county: property.county,
    state: property.state,
    sizeAcres: Number(property.sizeAcres),
    latitude: property.parcelCentroid?.lat || (property.latitude ? Number(property.latitude) : undefined),
    longitude: property.parcelCentroid?.lng || (property.longitude ? Number(property.longitude) : undefined),
    zoning: property.zoning || undefined,
    terrain: property.terrain || undefined,
    roadAccess: property.roadAccess || undefined,
    utilities: property.utilities || undefined,
    assessedValue: property.assessedValue ? Number(property.assessedValue) : undefined,
    marketValue: property.marketValue ? Number(property.marketValue) : undefined,
  };

  const generateOfferMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/generate-offer", propertyData);
      return res.json() as Promise<GenerateOfferResponse>;
    },
    onSuccess: (data) => {
      setOfferData(data);
      if (data.suggestions.length > 0) {
        setSelectedOffer(data.suggestions[0]);
        setCustomOfferAmount(String(data.suggestions[0].offerAmount));
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to generate offer suggestions",
        variant: "destructive",
      });
    },
  });

  const generateLetterMutation = useMutation({
    mutationFn: async () => {
      const offerAmount = selectedOffer?.offerAmount || Number(customOfferAmount);
      const res = await apiRequest("POST", "/api/ai/generate-letter", {
        property: propertyData,
        offerAmount,
        buyerName,
        buyerCompany: buyerCompany || undefined,
        buyerPhone: buyerPhone || undefined,
        buyerEmail: buyerEmail || undefined,
        tone: letterTone,
        terms: {
          earnestMoney: earnestMoney ? Number(earnestMoney) : undefined,
          closingDays: closingDays ? Number(closingDays) : 30,
        },
        sellerName: sellerName || undefined,
      });
      return res.json() as Promise<OfferLetterResponse>;
    },
    onSuccess: (data) => {
      setLetterContent(data.letter);
      setLetterSubject(data.subject);
      toast({
        title: "Letter Generated",
        description: "Your offer letter has been generated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to generate offer letter",
        variant: "destructive",
      });
    },
  });

  const predictAcceptanceMutation = useMutation({
    mutationFn: async () => {
      const offerAmount = Number(customOfferAmount) || selectedOffer?.offerAmount || 0;
      const estimatedMarketValue = offerData?.estimatedMarketValue || Number(property.marketValue) || Number(property.assessedValue) || 0;
      
      const res = await apiRequest("POST", "/api/ai/predict-acceptance", {
        property: propertyData,
        offerAmount,
        estimatedMarketValue,
        sellerMotivation,
        competingOffers: competingOffers === "yes" ? true : competingOffers === "no" ? false : undefined,
      });
      return res.json() as Promise<AcceptancePredictionResponse>;
    },
    onSuccess: (data) => {
      setAcceptanceData(data);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to predict acceptance probability",
        variant: "destructive",
      });
    },
  });

  const formatCurrency = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "N/A";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: "Letter copied to clipboard",
    });
  };

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 75) return <Badge variant="default" className="bg-green-600">High Confidence</Badge>;
    if (confidence >= 50) return <Badge variant="secondary">Medium Confidence</Badge>;
    return <Badge variant="outline">Lower Confidence</Badge>;
  };

  const getImpactIcon = (impact: "positive" | "negative" | "neutral") => {
    if (impact === "positive") return <TrendingUp className="w-4 h-4 text-green-500" />;
    if (impact === "negative") return <TrendingDown className="w-4 h-4 text-red-500" />;
    return <ArrowRight className="w-4 h-4 text-muted-foreground" />;
  };

  const getProbabilityColor = (probability: number) => {
    if (probability >= 70) return "text-green-600";
    if (probability >= 40) return "text-yellow-600";
    return "text-red-600";
  };

  if (!hasCoordinates) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center">
            <AlertCircle className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-medium mb-2">Location Data Required</h3>
            <p className="text-sm text-muted-foreground">
              Please fetch parcel data first to enable AI offer analysis.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="ai-offer-generator">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <CardTitle data-testid="text-ai-offer-title">AI Offer Generator</CardTitle>
        </div>
        <CardDescription>
          Get AI-powered offer suggestions, generate personalized letters, and predict acceptance probability.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3" data-testid="tabs-ai-offer">
            <TabsTrigger value="suggestions" data-testid="tab-suggestions">
              <DollarSign className="w-4 h-4 mr-2" />
              Suggestions
            </TabsTrigger>
            <TabsTrigger value="letter" data-testid="tab-letter">
              <FileText className="w-4 h-4 mr-2" />
              Letter
            </TabsTrigger>
            <TabsTrigger value="prediction" data-testid="tab-prediction">
              <Target className="w-4 h-4 mr-2" />
              Prediction
            </TabsTrigger>
          </TabsList>

          <TabsContent value="suggestions" className="space-y-4 mt-4">
            {!offerData ? (
              <div className="text-center py-8">
                <Brain className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-medium mb-2">Generate AI Offer Suggestions</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Analyze comparable sales and property characteristics to get strategic offer recommendations.
                </p>
                <Button 
                  onClick={() => generateOfferMutation.mutate()} 
                  disabled={generateOfferMutation.isPending}
                  data-testid="button-generate-offers"
                >
                  {generateOfferMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4 mr-2" />
                  )}
                  Analyze Property
                </Button>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-muted/50 p-4 rounded-md">
                    <div className="text-sm text-muted-foreground">Est. Market Value</div>
                    <div className="text-2xl font-bold" data-testid="text-estimated-value">
                      {formatCurrency(offerData.estimatedMarketValue)}
                    </div>
                  </div>
                  <div className="bg-muted/50 p-4 rounded-md">
                    <div className="text-sm text-muted-foreground">Avg Price/Acre</div>
                    <div className="text-2xl font-bold">
                      {formatCurrency(offerData.marketAnalysis.averagePricePerAcre)}
                    </div>
                  </div>
                  <div className="bg-muted/50 p-4 rounded-md">
                    <div className="text-sm text-muted-foreground">Comparables Found</div>
                    <div className="text-2xl font-bold" data-testid="text-comps-count">
                      {offerData.marketAnalysis.comparablesCount}
                    </div>
                  </div>
                </div>

                <Separator />

                <div>
                  <h4 className="font-medium mb-3 flex items-center gap-2">
                    <Lightbulb className="w-4 h-4" />
                    AI Offer Strategies
                  </h4>
                  <div className="grid grid-cols-1 gap-3">
                    {offerData.suggestions.map((suggestion, index) => (
                      <div
                        key={index}
                        className={`p-4 rounded-md border cursor-pointer transition-colors ${
                          selectedOffer?.strategyName === suggestion.strategyName
                            ? "border-primary bg-primary/5"
                            : "hover:bg-muted/50"
                        }`}
                        onClick={() => {
                          setSelectedOffer(suggestion);
                          setCustomOfferAmount(String(suggestion.offerAmount));
                        }}
                        data-testid={`card-offer-suggestion-${index}`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium">{suggestion.strategyName}</span>
                              {getConfidenceBadge(suggestion.confidence)}
                            </div>
                            <div className="text-2xl font-bold text-primary" data-testid={`text-offer-amount-${index}`}>
                              {formatCurrency(suggestion.offerAmount)}
                            </div>
                            <div className="text-sm text-muted-foreground mt-1">
                              {suggestion.marketValuePercent}% of market value
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm text-muted-foreground">Confidence</div>
                            <div className="text-lg font-semibold" data-testid={`text-confidence-${index}`}>
                              {suggestion.confidence}%
                            </div>
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground mt-2">{suggestion.reasoning}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-muted/30 p-4 rounded-md">
                  <h4 className="font-medium mb-2 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" />
                    AI Analysis
                  </h4>
                  <p className="text-sm text-muted-foreground" data-testid="text-ai-reasoning">
                    {offerData.aiReasoning}
                  </p>
                </div>

                {offerData.propertyScore.factors.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-3">Property Score: {offerData.propertyScore.grade}</h4>
                    <div className="space-y-2">
                      {offerData.propertyScore.factors.map((factor, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <span className="text-sm flex-1">{factor.name}</span>
                          <Progress 
                            value={(factor.score / factor.maxScore) * 100} 
                            className="w-24 h-2" 
                          />
                          <span className="text-sm text-muted-foreground w-12 text-right">
                            {factor.score}/{factor.maxScore}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <Button 
                  variant="outline" 
                  onClick={() => generateOfferMutation.mutate()} 
                  disabled={generateOfferMutation.isPending}
                  data-testid="button-refresh-offers"
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${generateOfferMutation.isPending ? "animate-spin" : ""}`} />
                  Refresh Analysis
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="letter" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-4">
                <h4 className="font-medium">Buyer Information</h4>
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="buyerName">Your Name *</Label>
                    <Input
                      id="buyerName"
                      value={buyerName}
                      onChange={(e) => setBuyerName(e.target.value)}
                      placeholder="John Smith"
                      data-testid="input-buyer-name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="buyerCompany">Company (Optional)</Label>
                    <Input
                      id="buyerCompany"
                      value={buyerCompany}
                      onChange={(e) => setBuyerCompany(e.target.value)}
                      placeholder="ABC Land Investments"
                      data-testid="input-buyer-company"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor="buyerPhone">Phone</Label>
                      <Input
                        id="buyerPhone"
                        value={buyerPhone}
                        onChange={(e) => setBuyerPhone(e.target.value)}
                        placeholder="(555) 123-4567"
                        data-testid="input-buyer-phone"
                      />
                    </div>
                    <div>
                      <Label htmlFor="buyerEmail">Email</Label>
                      <Input
                        id="buyerEmail"
                        value={buyerEmail}
                        onChange={(e) => setBuyerEmail(e.target.value)}
                        placeholder="john@example.com"
                        data-testid="input-buyer-email"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="font-medium">Offer Details</h4>
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="offerAmount">Offer Amount *</Label>
                    <Input
                      id="offerAmount"
                      type="number"
                      value={customOfferAmount}
                      onChange={(e) => setCustomOfferAmount(e.target.value)}
                      placeholder="Enter amount"
                      data-testid="input-offer-amount"
                    />
                  </div>
                  <div>
                    <Label htmlFor="sellerName">Seller Name (Optional)</Label>
                    <Input
                      id="sellerName"
                      value={sellerName}
                      onChange={(e) => setSellerName(e.target.value)}
                      placeholder="Property Owner"
                      data-testid="input-seller-name"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor="earnestMoney">Earnest Money</Label>
                      <Input
                        id="earnestMoney"
                        type="number"
                        value={earnestMoney}
                        onChange={(e) => setEarnestMoney(e.target.value)}
                        placeholder="500"
                        data-testid="input-earnest-money"
                      />
                    </div>
                    <div>
                      <Label htmlFor="closingDays">Closing Days</Label>
                      <Input
                        id="closingDays"
                        type="number"
                        value={closingDays}
                        onChange={(e) => setClosingDays(e.target.value)}
                        placeholder="30"
                        data-testid="input-closing-days"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <Label htmlFor="letterTone">Letter Tone</Label>
              <Select value={letterTone} onValueChange={(v: any) => setLetterTone(v)}>
                <SelectTrigger data-testid="select-letter-tone">
                  <SelectValue placeholder="Select tone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="professional">Professional - Formal and business-like</SelectItem>
                  <SelectItem value="friendly">Friendly - Warm and personable</SelectItem>
                  <SelectItem value="urgent">Urgent - Quick close, motivated buyer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={() => generateLetterMutation.mutate()}
              disabled={generateLetterMutation.isPending || !buyerName || !customOfferAmount}
              className="w-full"
              data-testid="button-generate-letter"
            >
              {generateLetterMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <FileText className="w-4 h-4 mr-2" />
              )}
              Generate Offer Letter
            </Button>

            {letterContent && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">Generated Letter</h4>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => copyToClipboard(letterContent)}
                    data-testid="button-copy-letter"
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    Copy
                  </Button>
                </div>
                {letterSubject && (
                  <div className="bg-muted/50 p-2 rounded-md">
                    <span className="text-sm text-muted-foreground">Subject: </span>
                    <span className="text-sm font-medium" data-testid="text-letter-subject">{letterSubject}</span>
                  </div>
                )}
                <Textarea
                  value={letterContent}
                  onChange={(e) => setLetterContent(e.target.value)}
                  className="min-h-[300px] font-mono text-sm"
                  data-testid="textarea-letter-content"
                />
              </div>
            )}
          </TabsContent>

          <TabsContent value="prediction" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="predictionOfferAmount">Offer Amount *</Label>
                <Input
                  id="predictionOfferAmount"
                  type="number"
                  value={customOfferAmount}
                  onChange={(e) => setCustomOfferAmount(e.target.value)}
                  placeholder="Enter offer amount"
                  data-testid="input-prediction-offer-amount"
                />
              </div>
              <div>
                <Label htmlFor="sellerMotivation">Seller Motivation</Label>
                <Select value={sellerMotivation} onValueChange={(v: any) => setSellerMotivation(v)}>
                  <SelectTrigger data-testid="select-seller-motivation">
                    <SelectValue placeholder="Select motivation level" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unknown">Unknown</SelectItem>
                    <SelectItem value="low">Low - Not actively selling</SelectItem>
                    <SelectItem value="medium">Medium - Open to offers</SelectItem>
                    <SelectItem value="high">High - Motivated seller</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="competingOffers">Competing Offers</Label>
              <Select value={competingOffers} onValueChange={(v: any) => setCompetingOffers(v)}>
                <SelectTrigger data-testid="select-competing-offers">
                  <SelectValue placeholder="Are there competing offers?" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unknown">Unknown</SelectItem>
                  <SelectItem value="no">No - No known competition</SelectItem>
                  <SelectItem value="yes">Yes - Other buyers interested</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={() => predictAcceptanceMutation.mutate()}
              disabled={predictAcceptanceMutation.isPending || !customOfferAmount}
              className="w-full"
              data-testid="button-predict-acceptance"
            >
              {predictAcceptanceMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Target className="w-4 h-4 mr-2" />
              )}
              Predict Acceptance Probability
            </Button>

            {acceptanceData && (
              <div className="space-y-4">
                <div className="text-center py-6 bg-muted/50 rounded-md">
                  <div className="text-sm text-muted-foreground mb-2">Acceptance Probability</div>
                  <div className={`text-5xl font-bold ${getProbabilityColor(acceptanceData.probability)}`} data-testid="text-acceptance-probability">
                    {acceptanceData.probability}%
                  </div>
                  <Badge 
                    variant={acceptanceData.confidenceLevel === "high" ? "default" : "secondary"}
                    className="mt-2"
                    data-testid="badge-confidence-level"
                  >
                    {acceptanceData.confidenceLevel.charAt(0).toUpperCase() + acceptanceData.confidenceLevel.slice(1)} Confidence
                  </Badge>
                </div>

                <div className="bg-muted/30 p-4 rounded-md">
                  <h4 className="font-medium mb-2 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    Recommendation
                  </h4>
                  <p className="text-sm" data-testid="text-recommendation">{acceptanceData.recommendation}</p>
                </div>

                <div>
                  <h4 className="font-medium mb-3">Contributing Factors</h4>
                  <div className="space-y-2">
                    {acceptanceData.factors.map((factor, index) => (
                      <div 
                        key={index} 
                        className="flex items-start gap-3 p-3 bg-muted/30 rounded-md"
                        data-testid={`factor-${index}`}
                      >
                        {getImpactIcon(factor.impact)}
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm">{factor.name}</span>
                            <Badge 
                              variant={factor.impact === "positive" ? "default" : factor.impact === "negative" ? "destructive" : "secondary"}
                              className="text-xs"
                            >
                              {factor.weight > 0 ? "+" : ""}{factor.weight}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">{factor.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <Button 
                  variant="outline" 
                  onClick={() => predictAcceptanceMutation.mutate()} 
                  disabled={predictAcceptanceMutation.isPending}
                  data-testid="button-refresh-prediction"
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${predictAcceptanceMutation.isPending ? "animate-spin" : ""}`} />
                  Recalculate
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
