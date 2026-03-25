import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { fadeInUp } from "@/lib/animations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Check, ChevronRight, Send, Download, Mail, FileText, ArrowLeft } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface OfferTier {
  name: string;
  price: number;
  profit: number;
  strategy: string;
  description: string;
}

interface OfferWizardProps {
  dealId: number;
  trigger?: React.ReactNode;
}

type Step = "analysis" | "letter" | "confirm";

export function OfferWizard({ dealId, trigger }: OfferWizardProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("analysis");
  const [selectedTier, setSelectedTier] = useState<OfferTier | null>(null);
  const [letter, setLetter] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<string>("email");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: dealStats } = useQuery<{ offersSent: number }>({
    queryKey: ["/api/deals/stats"],
    staleTime: 5 * 60 * 1000,
  });
  const isAdvanced = (dealStats?.offersSent ?? 0) >= 3;

  const initiateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/negotiation/pipeline/initiate`, { dealId });
      return res.json();
    },
  });

  const letterMutation = useMutation({
    mutationFn: async (tier: string) => {
      const res = await apiRequest("POST", `/api/negotiation/pipeline/letter`, { dealId, tier });
      return res.json();
    },
    onSuccess: (data) => {
      setLetter(data.letter || "");
      setStep("letter");
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/negotiation/pipeline/send`, {
        dealId,
        letter,
        deliveryMethod,
        tier: selectedTier?.name,
        price: selectedTier?.price,
      });
    },
    onSuccess: () => {
      toast({
        title: "Offer sent to the property owner",
        description: "We'll analyze any response and suggest your next move.",
      });
      setOpen(false);
      setStep("analysis");
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
    },
  });

  const handleOpen = () => {
    setOpen(true);
    setStep("analysis");
    initiateMutation.mutate();
  };

  const handleSelectTier = (tier: OfferTier) => {
    setSelectedTier(tier);
    letterMutation.mutate(tier.name.toLowerCase());
  };

  const formatPrice = (n: number) =>
    n > 0 ? `$${n.toLocaleString()}` : "—";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild onClick={handleOpen}>
        {trigger || (
          <Button size="sm">
            <Send className="w-3 h-3 mr-1" /> Make Offer
          </Button>
        )}
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {step !== "analysis" && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setStep(step === "confirm" ? "letter" : "analysis")}
                aria-label="Go back"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
            )}
            {step === "analysis" && "Step 1: Analysis"}
            {step === "letter" && "Step 2: Letter Preview"}
            {step === "confirm" && "Step 3: Confirm & Send"}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <AnimatePresence mode="wait">
            {/* Step 1: Analysis — 3 tier cards */}
            {step === "analysis" && (
              <motion.div key="analysis" {...fadeInUp} className="space-y-4">
                {initiateMutation.isPending ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[1, 2, 3].map(i => (
                      <Card key={i} className="animate-pulse">
                        <CardContent className="p-4 h-32" />
                      </Card>
                    ))}
                  </div>
                ) : initiateMutation.data?.tiers ? (
                  <>
                    {!isAdvanced && (
                      <p className="text-sm font-medium">Here are 3 offer prices. Pick one.</p>
                    )}
                    {isAdvanced && initiateMutation.data.compSummary && (
                      <p className="text-xs text-muted-foreground">{initiateMutation.data.compSummary}</p>
                    )}
                    {isAdvanced && initiateMutation.data.strategyRecommendation && (
                      <p className="text-xs text-primary">{initiateMutation.data.strategyRecommendation}</p>
                    )}
                    {isAdvanced && initiateMutation.data.motivationAnalysis && (
                      <p className="text-xs text-muted-foreground">{initiateMutation.data.motivationAnalysis}</p>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {initiateMutation.data.tiers.map((tier: OfferTier) => (
                        <Card
                          key={tier.name}
                          className={`cursor-pointer transition-all hover-elevate ${selectedTier?.name === tier.name ? "ring-2 ring-primary" : ""}`}
                          onClick={() => handleSelectTier(tier)}
                        >
                          <CardContent className="p-4 space-y-2">
                            <div className="flex justify-between items-center">
                              <h3 className="font-semibold text-sm">{tier.name}</h3>
                              {selectedTier?.name === tier.name && (
                                <Check className="w-4 h-4 text-primary" />
                              )}
                            </div>
                            <p className="text-xl font-bold">{formatPrice(tier.price)}</p>
                            {isAdvanced && (
                              <>
                                <p className="text-xs text-muted-foreground">
                                  Projected profit: {formatPrice(tier.profit)}
                                </p>
                                <p className="text-xs">{tier.strategy}</p>
                              </>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Unable to generate offer analysis.</p>
                )}
              </motion.div>
            )}

            {/* Step 2: Letter Preview */}
            {step === "letter" && (
              <motion.div key="letter" {...fadeInUp} className="space-y-4">
                {!isAdvanced && (
                  <p className="text-sm font-medium">Here's the letter. Send it.</p>
                )}
                <Textarea
                  value={letter}
                  onChange={(e) => setLetter(e.target.value)}
                  rows={isAdvanced ? 12 : 8}
                  className="font-mono text-sm"
                  aria-label="Offer letter content"
                  readOnly={!isAdvanced}
                />
                {isAdvanced && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => letterMutation.mutate(selectedTier?.name.toLowerCase() || "market")}
                      disabled={letterMutation.isPending}
                    >
                      Regenerate
                    </Button>
                  </div>
                )}
                <div className="space-y-2">
                  <p className="text-xs font-medium">Delivery method:</p>
                  <div className="flex gap-2">
                    {[
                      { id: "email", icon: Mail, label: "Email" },
                      { id: "direct_mail", icon: FileText, label: "Direct Mail" },
                      { id: "download_pdf", icon: Download, label: "Download PDF" },
                    ].map(({ id, icon: Icon, label }) => (
                      <Button
                        key={id}
                        variant={deliveryMethod === id ? "default" : "outline"}
                        size="sm"
                        onClick={() => setDeliveryMethod(id)}
                      >
                        <Icon className="w-3 h-3 mr-1" /> {label}
                      </Button>
                    ))}
                  </div>
                </div>
                <Button onClick={() => setStep("confirm")} className="w-full">
                  {isAdvanced ? "Review & Send" : "Send It"} <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </motion.div>
            )}

            {/* Step 3: Confirm & Send */}
            {step === "confirm" && (
              <motion.div key="confirm" {...fadeInUp} className="space-y-4">
                <Card>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm font-medium">Offer Amount</span>
                      <span className="font-bold">{formatPrice(selectedTier?.price || 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm font-medium">Tier</span>
                      <Badge variant="outline">{selectedTier?.name}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm font-medium">Delivery</span>
                      <span className="text-sm capitalize">{deliveryMethod.replace("_", " ")}</span>
                    </div>
                  </CardContent>
                </Card>

                <Button
                  onClick={() => sendMutation.mutate()}
                  disabled={sendMutation.isPending}
                  className="w-full"
                >
                  <Send className="w-3 h-3 mr-1" />
                  {sendMutation.isPending ? "Sending..." : "Send Offer"}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </SheetContent>
    </Sheet>
  );
}
