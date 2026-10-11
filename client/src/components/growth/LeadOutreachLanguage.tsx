/**
 * The outreach language for one owner (W5b) — set by the customer, or recorded
 * from what the owner said. There is no "detect" button and no suggestion:
 * a language guessed from a name or an address is a national-origin proxy
 * (shared/outreach/outreachLanguage.ts). Writes through the ONE writer,
 * PATCH /api/leads/:id/outreach-language.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  OUTREACH_LANGUAGES,
  OUTREACH_LANGUAGE_LABELS,
  OUTREACH_LANGUAGE_SOURCES,
  OUTREACH_LANGUAGE_SOURCE_LABELS,
  describeOutreachLanguageBasis,
  isOutreachLanguage,
  isOutreachLanguageSource,
  outreachLanguageForLead,
  type OutreachLanguageSource,
} from "@shared/outreach/outreachLanguage";

interface Props {
  lead: { id: number; outreachLanguage?: string | null; outreachLanguageSource?: string | null };
}

export function LeadOutreachLanguage({ lead }: Props) {
  const { toast } = useToast();
  const verdict = outreachLanguageForLead(lead);
  const [language, setLanguage] = useState<string>(verdict.basis === "default" ? "unset" : verdict.language);
  const [source, setSource] = useState<OutreachLanguageSource>(
    isOutreachLanguageSource(lead.outreachLanguageSource) ? lead.outreachLanguageSource : "customer_choice",
  );
  const save = useMutation({
    mutationFn: async () => {
      const body = language === "unset" ? { language: null } : { language, source };
      const res = await apiRequest("PATCH", `/api/leads/${lead.id}/outreach-language`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Outreach language saved" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Couldn't save the language", description: err.message }),
  });

  return (
    <div className="space-y-2" data-testid="lead-outreach-language">
      <p className="text-sm">
        <span className="text-muted-foreground">Writes to this owner in: </span>
        <span data-testid="lead-outreach-language-current">{describeOutreachLanguageBasis(verdict)}</span>
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor={`lead-lang-${lead.id}`}>Language</Label>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger id={`lead-lang-${lead.id}`} data-testid="select-lead-outreach-language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unset">Not chosen (English)</SelectItem>
              {OUTREACH_LANGUAGES.map((l) => (
                <SelectItem key={l} value={l}>{OUTREACH_LANGUAGE_LABELS[l]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isOutreachLanguage(language) && (
          <div className="space-y-1">
            <Label htmlFor={`lead-lang-src-${lead.id}`}>Who chose it</Label>
            <Select value={source} onValueChange={(v) => isOutreachLanguageSource(v) && setSource(v)}>
              <SelectTrigger id={`lead-lang-src-${lead.id}`} data-testid="select-lead-outreach-language-source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OUTREACH_LANGUAGE_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>{OUTREACH_LANGUAGE_SOURCE_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Only you or the owner decide this. AcreOS never picks a language from a name or an address.
      </p>
      <Button size="sm" variant="outline" className="min-h-11 pointer-fine:sm:min-h-9" onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-lead-outreach-language">
        Save language
      </Button>
    </div>
  );
}
