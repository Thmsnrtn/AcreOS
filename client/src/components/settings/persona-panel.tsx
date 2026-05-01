import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient as appQueryClient } from "@/lib/queryClient";
import { Compass } from "lucide-react";
import type { Persona } from "@shared/models/auth";
import { PERSONAS, getTerm } from "@/lib/personaVocabulary";

/**
 * Investor archetype switcher — product-call #9 + JC#7 surface.
 *
 * Land Investor stays the default for existing users; switching tells the
 * platform to swap vocabulary (Lead → Note seller, etc) and route the
 * user toward persona-relevant surfaces. Vertical expansion ramps up by
 * surface; today this controls vocabulary + onboarding path.
 *
 * The persona is stored at users.persona — see migrations/0031. /api/me/
 * persona reads/writes it; useAuth() picks it up via the shared User type.
 */

const PERSONA_DESCRIPTIONS: Record<Persona, string> = {
  land_investor: "Buy raw land, sell with seller financing, manage the note. The default AcreOS path.",
  note_investor: "Buy/sell/manage promissory notes, often secured by real estate. Reuses 70% of land-investor infrastructure.",
  tax_delinquent: "Buy properties from owners behind on taxes (pre-foreclosure or at tax sale). Specialized auction calendar + state-rules.",
  wholesaler: "Get under contract at low price, assign the contract to an end buyer for an assignment fee. Don't actually own the property.",
  subdivider: "Buy large parcels, subdivide, sell smaller lots. Adds permit-tracking + per-lot pipelines.",
  fix_flipper: "Buy distressed property, rehab, resell. Adds rehab budget + contractor management.",
  landlord: "Long-term rentals. Tenant CRM, lease management, rent rolls — operations-driven workflow.",
};

export function PersonaPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ persona: Persona }>({
    queryKey: ["/api/me/persona"],
    staleTime: 60_000,
  });

  const [selected, setSelected] = useState<Persona>("land_investor");
  useEffect(() => {
    if (data?.persona) setSelected(data.persona);
  }, [data?.persona]);

  const mutation = useMutation({
    mutationFn: async (persona: Persona) => {
      const res = await apiRequest("PUT", "/api/me/persona", { persona });
      if (!res.ok) throw new Error("Couldn't save");
      return res.json();
    },
    onSuccess: (response) => {
      queryClient.setQueryData(["/api/me/persona"], response);
      // The signed-in user object also carries persona; refresh it so
      // useTerm() picks up the new vocabulary platform-wide.
      appQueryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: "Workspace updated",
        description: `Surfaces and vocabulary now match ${getTerm("persona.name", response.persona)}.`,
      });
    },
    onError: () => {
      toast({
        title: "Couldn't update workspace",
        description: "Your earlier setting is unchanged. Try again.",
        variant: "destructive",
      });
      if (data?.persona) setSelected(data.persona);
    },
  });

  const onSelect = (next: Persona) => {
    setSelected(next);
    mutation.mutate(next);
  };

  return (
    <Card data-testid="persona-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Compass className="w-5 h-5" aria-hidden="true" />
          Workspace shape
        </CardTitle>
        <CardDescription>
          AcreOS adapts vocabulary, onboarding, and default surfaces to your
          investing path. Switch any time — your data stays put; only how
          it's labeled changes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <RadioGroup
            value={selected}
            onValueChange={(v) => onSelect(v as Persona)}
            className="space-y-2"
            disabled={mutation.isPending}
          >
            {PERSONAS.map((p) => {
              const id = `persona-${p}`;
              const isCurrent = selected === p;
              return (
                <Label
                  key={p}
                  htmlFor={id}
                  className={`flex items-start gap-3 rounded-card border p-3 cursor-pointer transition-colors ${
                    isCurrent ? "border-acr-brand bg-acr-brand-soft" : "hover:bg-muted/40"
                  }`}
                  data-testid={`persona-option-${p}`}
                >
                  <RadioGroupItem value={p} id={id} className="mt-1" />
                  <div className="space-y-0.5 flex-1">
                    <p className="text-sm font-medium">{getTerm("persona.name", p)}</p>
                    <p className="text-xs text-muted-foreground">
                      {PERSONA_DESCRIPTIONS[p]}
                    </p>
                  </div>
                </Label>
              );
            })}
          </RadioGroup>
        )}
      </CardContent>
    </Card>
  );
}
