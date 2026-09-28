/**
 * The wire-fraud step's evidence (DEFECT-0176).
 *
 * "Verify wire instructions — two-channel out-of-band" is the checklist's
 * one hard interlock: it cannot be ticked on a click. The person who made
 * the call records the number they dialled, where they found it
 * independently (not the email that carried the instructions), and who
 * confirmed routing + account. The server stores who recorded it and when.
 */
import { useId, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Verbs } from "@/lib/labels";

export interface WireVerification {
  phoneNumber: string;
  numberSource: string;
  spokeWith: string;
}

export function WireVerificationDialog({
  open,
  onOpenChange,
  onConfirm,
  isSubmitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (v: WireVerification) => void;
  isSubmitting?: boolean;
}) {
  const ids = { phone: useId(), source: useId(), who: useId() };
  const [phoneNumber, setPhoneNumber] = useState("");
  const [numberSource, setNumberSource] = useState("");
  const [spokeWith, setSpokeWith] = useState("");
  const complete =
    phoneNumber.replace(/\D/g, "").length >= 7 && numberSource.trim().length >= 3 && spokeWith.trim().length >= 2;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-acr-warn" aria-hidden="true" />
            Record the wire verification
          </DialogTitle>
          <DialogDescription>
            Only tick this after calling the title company on a number you looked up yourself — not one from the email
            that sent the instructions — and confirming routing and account by voice.
          </DialogDescription>
        </DialogHeader>
        <form
          id="wire-verification-form"
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (complete) onConfirm({ phoneNumber, numberSource, spokeWith });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor={ids.phone}>Number you called</Label>
            <Input id={ids.phone} inputMode="tel" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={ids.source}>Where you found that number</Label>
            <Input
              id={ids.source}
              placeholder="e.g. the title company's website"
              value={numberSource}
              onChange={(e) => setNumberSource(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={ids.who}>Who confirmed the instructions</Label>
            <Input id={ids.who} value={spokeWith} onChange={(e) => setSpokeWith(e.target.value)} />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {Verbs.CANCEL}
          </Button>
          <Button type="submit" form="wire-verification-form" disabled={!complete || isSubmitting}>
            Record verification
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
