/**
 * RequestSignaturesDialog — build a per-signer list, call the native
 * e-sign endpoint, and present the returned per-signer signing links
 * with copy buttons so the operator can paste them into their own
 * email / SMS / messenger.
 *
 *   <RequestSignaturesDialog
 *     open={open}
 *     onOpenChange={setOpen}
 *     documentId={doc.id}
 *     documentName={doc.name}
 *     defaultSigners={[...]}
 *   />
 *
 * Intentionally does NOT auto-email. Leaving dispatch with the
 * operator (a) avoids the "dropped into spam" problem generic
 * mailers have with external sellers, and (b) lets them personalize
 * the cover message in whatever tool they already use for the
 * relationship.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Send, Loader2, CheckCircle2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CopyButton } from "@/components/ui/copy-button";

interface SignerInput {
  name: string;
  email: string;
  role: string;
}

interface SigningLink {
  signerId: string;
  name: string;
  email: string;
  role: string;
  url: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: number;
  documentName: string;
  defaultSigners?: SignerInput[];
  onSuccess?: () => void;
}

export function RequestSignaturesDialog({
  open,
  onOpenChange,
  documentId,
  documentName,
  defaultSigners,
  onSuccess,
}: Props) {
  const { toast } = useToast();
  const [signers, setSigners] = useState<SignerInput[]>(
    defaultSigners && defaultSigners.length > 0
      ? defaultSigners
      : [{ name: "", email: "", role: "signer" }],
  );
  const [links, setLinks] = useState<SigningLink[] | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const clean = signers
        .map((s) => ({ name: s.name.trim(), email: s.email.trim(), role: s.role }))
        .filter((s) => s.name && s.email);
      if (clean.length === 0) throw new Error("At least one signer with name and email required.");
      const res = await apiRequest(
        "POST",
        `/api/generated-documents/${documentId}/request-signature`,
        { signers: clean },
      );
      return res.json();
    },
    onSuccess: (body: any) => {
      setLinks((body.signingLinks ?? []) as SigningLink[]);
      onSuccess?.();
    },
    onError: (err: Error) => {
      toast({ title: "Could not request signatures", description: err.message, variant: "destructive" });
    },
  });

  function updateSigner(idx: number, patch: Partial<SignerInput>) {
    setSigners((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }
  function addSigner() {
    setSigners((prev) => [...prev, { name: "", email: "", role: "signer" }]);
  }
  function removeSigner(idx: number) {
    setSigners((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  }

  function handleClose(next: boolean) {
    if (!next && links) {
      // Reset when closing after success so re-opening is clean.
      setLinks(null);
      setSigners(
        defaultSigners && defaultSigners.length > 0
          ? defaultSigners
          : [{ name: "", email: "", role: "signer" }],
      );
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Request signatures</DialogTitle>
          <DialogDescription>
            Add each person who needs to sign <strong>{documentName}</strong>. We'll generate a
            unique, unforgeable signing link for each one — paste those into your own email or SMS.
          </DialogDescription>
        </DialogHeader>

        {links ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md bg-emerald-500/5 border border-emerald-500/20 p-3 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-foreground">Signing links ready</p>
                <p className="text-xs text-muted-foreground">
                  Each recipient has a unique link below. They don't need an AcreOS account —
                  they land on a public signing page, draw or type their signature, and submit.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              {links.map((link) => (
                <div key={link.signerId} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <p className="font-medium text-sm">
                        {link.name}{" "}
                        <span className="text-xs text-muted-foreground">({link.role})</span>
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{link.email}</p>
                    </div>
                    <CopyButton
                      value={link.url}
                      successMessage={`Link for ${link.name} copied`}
                      label="Copy link"
                      className="h-8"
                    />
                  </div>
                  <pre className="text-[10px] bg-muted/40 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap break-all">
                    {link.url}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <form
            id="request-signatures-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!mutation.isPending) mutation.mutate();
            }}
          >
            {signers.map((s, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-4">
                  <Label className="text-xs">Name</Label>
                  <Input
                    value={s.name}
                    onChange={(e) => updateSigner(i, { name: e.target.value })}
                    placeholder="Jane Seller"
                    autoComplete="name"
                    autoCapitalize="words"
                    required
                  />
                </div>
                <div className="col-span-4">
                  <Label className="text-xs">Email</Label>
                  <Input
                    type="email"
                    inputMode="email"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    autoComplete="email"
                    value={s.email}
                    onChange={(e) => updateSigner(i, { email: e.target.value })}
                    placeholder="jane@example.com"
                  />
                </div>
                <div className="col-span-3">
                  <Label className="text-xs">Role</Label>
                  <Select value={s.role} onValueChange={(v) => updateSigner(i, { role: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="seller">Seller</SelectItem>
                      <SelectItem value="buyer">Buyer</SelectItem>
                      <SelectItem value="witness">Witness</SelectItem>
                      <SelectItem value="notary">Notary</SelectItem>
                      <SelectItem value="signer">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeSigner(i)}
                    disabled={signers.length <= 1}
                    aria-label={`Remove signer ${i + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addSigner}>
              <Plus className="h-3 w-3 mr-1" /> Add another signer
            </Button>
          </form>
        )}

        <DialogFooter>
          {links ? (
            <Button onClick={() => handleClose(false)}>Done</Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => handleClose(false)} disabled={mutation.isPending}>
                Cancel
              </Button>
              <Button type="submit" form="request-signatures-form" disabled={mutation.isPending}>
                {mutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-1" />
                )}
                Generate signing links
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
