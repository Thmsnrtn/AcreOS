/**
 * Inline TIN editor for the acquired-note detail page.
 *
 * Without a payer TIN + type, the 1099-INT batch generator will block on
 * that note (TaxIdentityError). Linnea's flow: the borrower W-9 lands in
 * her inbox, she pastes the SSN/EIN/ITIN here, and the next 1099 batch
 * picks up that note.
 *
 * PATCH /api/notes/:id supports payerTin + payerTinType. Server-side
 * encrypts via fieldEncryption.encrypt() before persisting.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Pencil, Save, X, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Verbs } from "@/lib/labels";

interface Props {
  noteId: string;
  currentTinType: "SSN" | "EIN" | "ITIN" | null;
}

export function NoteTinEditor({ noteId, currentTinType }: Props) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [tin, setTin] = useState("");
  const [tinType, setTinType] = useState<"SSN" | "EIN" | "ITIN">(currentTinType ?? "SSN");

  const saveMutation = useMutation({
    mutationFn: async () => {
      const csrfToken = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1] || "";
      const res = await fetch(`/api/notes/${noteId}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": decodeURIComponent(csrfToken),
        },
        body: JSON.stringify({ payerTin: tin, payerTinType: tinType }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Save failed" }));
        throw new Error(err.message || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "TIN saved", description: "Encrypted and stored. The next 1099-INT batch will include this note." });
      queryClient.invalidateQueries({ queryKey: ["/api/notes", noteId] });
      setEditing(false);
      setTin("");
    },
    onError: (err: any) => {
      toast({ title: "Couldn't save TIN", description: err.message, variant: "destructive" });
    },
  });

  if (!editing) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => setEditing(true)}
        data-testid="edit-tin-button"
      >
        <Pencil className="w-3 h-3 mr-1" aria-hidden="true" />
        {currentTinType ? "Edit TIN" : "Add TIN"}
      </Button>
    );
  }

  return (
    <div className="space-y-2 mt-2 p-3 rounded-md border border-primary/20 bg-primary/5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
        Encrypted at rest. Required for 1099-INT generation.
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-1">
          <Label htmlFor="tin-type" className="text-xs">Type</Label>
          <Select value={tinType} onValueChange={(v) => setTinType(v as "SSN" | "EIN" | "ITIN")}>
            <SelectTrigger id="tin-type" className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="SSN">SSN</SelectItem>
              <SelectItem value="EIN">EIN</SelectItem>
              <SelectItem value="ITIN">ITIN</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2">
          <Label htmlFor="tin-value" className="text-xs">TIN</Label>
          <Input
            id="tin-value"
            type="password"
            placeholder={tinType === "SSN" ? "###-##-####" : tinType === "EIN" ? "##-#######" : "9##-##-####"}
            className="h-8 text-xs font-mono"
            value={tin}
            onChange={(e) => setTin(e.target.value)}
            autoComplete="off"
          />
        </div>
      </div>
      <div className="flex items-center gap-2 justify-end pt-1">
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => { setEditing(false); setTin(""); }}>
          <X className="w-3 h-3 mr-1" aria-hidden="true" /> {Verbs.CANCEL}
        </Button>
        <Button
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => saveMutation.mutate()}
          disabled={!tin || saveMutation.isPending}
          data-testid="save-tin-button"
        >
          <Save className="w-3 h-3 mr-1" aria-hidden="true" />
          {saveMutation.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
