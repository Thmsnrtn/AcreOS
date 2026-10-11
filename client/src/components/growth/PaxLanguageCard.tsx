/**
 * The language Pax answers in (W5b) — the user's own setting. "Match how I
 * write" (the default) answers in the language of each message; Spanish or
 * English pins it. Pax stays in its existing surface; this only sets context.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const OPTIONS = [
  { id: "auto", label: "Match how I write" },
  { id: "es", label: "Español" },
  { id: "en", label: "English" },
] as const;
type PaxLanguage = (typeof OPTIONS)[number]["id"];

export function PaxLanguageCard() {
  const { toast } = useToast();
  const q = useQuery<{ language: PaxLanguage }>({ queryKey: ["/api/pax/language"] });
  const save = useMutation({
    mutationFn: async (language: PaxLanguage) => (await apiRequest("PATCH", "/api/pax/language", { language })).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/pax/language"] }),
    onError: (err: Error) => toast({ variant: "destructive", title: "Couldn't save Pax's language", description: err.message }),
  });
  return (
    <Card className="rounded-card mt-4" data-testid="pax-language-card">
      <CardHeader>
        <CardTitle className="text-section-h2">Language Pax answers in</CardTitle>
        <CardDescription>
          Pax answers you in Spanish when you write in Spanish, or always, if you choose it here. Legal documents stay in
          English; a Spanish summary of one says the English version controls.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <Skeleton className="h-11 w-72" />
        ) : (
          <ToggleGroup
            type="single"
            value={q.data?.language ?? "auto"}
            onValueChange={(v) => v && save.mutate(v as PaxLanguage)}
            aria-label="Language Pax answers in"
            className="justify-start flex-wrap"
          >
            {OPTIONS.map((o) => (
              <ToggleGroupItem key={o.id} value={o.id} className="min-h-11" data-testid={`pax-language-${o.id}`}>
                {o.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </CardContent>
    </Card>
  );
}
