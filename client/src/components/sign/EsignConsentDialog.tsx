/**
 * EsignConsentDialog — federal E-SIGN Act §101(c)(1)(B) consumer-consent
 * pre-signing flow.
 *
 * Before any electronic signature is used on a consumer transaction, the
 * E-SIGN Act requires the signer to (a) receive five specific disclosures
 * and (b) affirmatively consent. Until consent is captured, the original
 * AcreOS signing page showed only a one-line "legally binding" notice —
 * which means every e-signed promissory note was arguably unenforceable
 * in the originating state.
 *
 * This dialog renders ONCE per user (or once per external-signer email +
 * disclosure-version pair) before they reach the signature capture surface.
 * Each disclosure is a labeled block so a regulator can verify each one was
 * rendered, not just that a single "I agree" was clicked. The five
 * disclosures, in order:
 *
 *   (i)   Hardware/software requirements for receiving the record
 *   (ii)  Right to receive paper copies and any fee
 *   (iii) Right to withdraw consent and consequences of withdrawal
 *   (iv)  Procedures for updating contact information
 *   (v)   Scope statement (which records are covered)
 *
 * The component is presentational and accessibility-focused: focus is
 * trapped inside the dialog (radix Dialog default), every block is labeled,
 * every interactive control has an aria-label, the "Continue" button is
 * disabled until all five disclosures have been acknowledged.
 *
 * The actual consent capture (POST to /api/sign/consent) happens in the
 * parent. This component is layout + accessibility + the structured five
 * disclosure blocks.
 */

import { useId, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShieldCheck, FileText } from "lucide-react";

/** Current disclosure-text version. Bump when copy materially changes. */
export const ESIGN_DISCLOSURE_VERSION = "2026-05-29";

export interface EsignConsentValue {
  consentedHardwareRequirements: boolean;
  consentedPaperCopyRight: boolean;
  consentedWithdrawalRight: boolean;
  consentedContactUpdate: boolean;
  consentedScope: boolean;
  disclosureVersion: string;
}

export interface EsignConsentDialogProps {
  open: boolean;
  /** Org name shown in scope + paper-copy blocks. Defaults to "AcreOS". */
  organizationName?: string;
  /** Fee (in dollars) we charge for a mailed paper copy. 0 = free. */
  paperCopyFeeUsd?: number;
  /** Per-user contact address shown in (iv). */
  contactSupportEmail?: string;
  busy?: boolean;
  onAccept: (value: EsignConsentValue) => void;
  onDecline: () => void;
}

export function EsignConsentDialog({
  open,
  organizationName = "AcreOS",
  paperCopyFeeUsd = 0,
  contactSupportEmail = "support@acreos.io",
  busy = false,
  onAccept,
  onDecline,
}: EsignConsentDialogProps) {
  const titleId = useId();
  const [acks, setAcks] = useState({
    hardware: false,
    paper: false,
    withdrawal: false,
    contact: false,
    scope: false,
  });

  const allAcked =
    acks.hardware && acks.paper && acks.withdrawal && acks.contact && acks.scope;

  const handleAccept = () => {
    if (!allAcked) return;
    onAccept({
      consentedHardwareRequirements: acks.hardware,
      consentedPaperCopyRight: acks.paper,
      consentedWithdrawalRight: acks.withdrawal,
      consentedContactUpdate: acks.contact,
      consentedScope: acks.scope,
      disclosureVersion: ESIGN_DISCLOSURE_VERSION,
    });
  };

  const paperCopyFeeLabel =
    paperCopyFeeUsd > 0
      ? `for a fee of $${paperCopyFeeUsd.toFixed(2)} per copy`
      : "at no charge";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onDecline()}>
      <DialogContent
        className="max-w-2xl"
        aria-labelledby={titleId}
        data-testid="esign-consent-dialog"
      >
        <DialogHeader>
          <DialogTitle id={titleId} className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
            Electronic-signature consent
          </DialogTitle>
          <DialogDescription>
            Federal law (E-SIGN Act §101(c)) requires {organizationName} to give you
            the disclosures below and obtain your consent before you can sign
            electronically. Please read each section and acknowledge to continue.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-2">
          <div className="space-y-5">
            {/* (i) Hardware / software requirements ─────────────────────── */}
            <section
              aria-labelledby="esign-disclosure-i-label"
              data-testid="disclosure-hardware"
              className="rounded-md border bg-card p-4"
            >
              <h3
                id="esign-disclosure-i-label"
                className="text-sm font-semibold flex items-center gap-2"
              >
                <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                (i) Hardware and software requirements
              </h3>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                To receive and view records electronically you need: a current
                version of a major web browser (Chrome, Safari, Firefox, or
                Edge), an internet connection, a working email address you can
                access, sufficient electronic storage to save records you wish
                to keep, and software capable of viewing PDF files. If any of
                these change in a way that creates a material risk that you
                cannot access future records, {organizationName} will provide a
                revised statement and obtain your consent again.
              </p>
              <div className="flex items-start gap-2 mt-3">
                <Checkbox
                  id="ack-hardware"
                  checked={acks.hardware}
                  onCheckedChange={(v) =>
                    setAcks((s) => ({ ...s, hardware: !!v }))
                  }
                  aria-label="Acknowledge hardware and software requirements"
                  data-testid="ack-hardware"
                />
                <Label htmlFor="ack-hardware" className="text-sm font-normal leading-snug">
                  I acknowledge I have the hardware and software described above
                  and that I can access this record.
                </Label>
              </div>
            </section>

            {/* (ii) Right to paper copies ─────────────────────────────────── */}
            <section
              aria-labelledby="esign-disclosure-ii-label"
              data-testid="disclosure-paper-copy"
              className="rounded-md border bg-card p-4"
            >
              <h3
                id="esign-disclosure-ii-label"
                className="text-sm font-semibold flex items-center gap-2"
              >
                <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                (ii) Right to a paper copy
              </h3>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                You have the right to receive a paper copy of any record we
                provide electronically. You may request a paper copy at any
                time by emailing {contactSupportEmail} with the document name
                or reference number. Paper copies are provided{" "}
                {paperCopyFeeLabel}. Requesting a paper copy does not by itself
                withdraw your consent to electronic delivery (see (iii)).
              </p>
              <div className="flex items-start gap-2 mt-3">
                <Checkbox
                  id="ack-paper"
                  checked={acks.paper}
                  onCheckedChange={(v) =>
                    setAcks((s) => ({ ...s, paper: !!v }))
                  }
                  aria-label="Acknowledge right to paper copies"
                  data-testid="ack-paper"
                />
                <Label htmlFor="ack-paper" className="text-sm font-normal leading-snug">
                  I acknowledge I have been informed of my right to receive
                  paper copies and the fee, if any.
                </Label>
              </div>
            </section>

            {/* (iii) Right to withdraw consent ───────────────────────────── */}
            <section
              aria-labelledby="esign-disclosure-iii-label"
              data-testid="disclosure-withdrawal"
              className="rounded-md border bg-card p-4"
            >
              <h3
                id="esign-disclosure-iii-label"
                className="text-sm font-semibold flex items-center gap-2"
              >
                <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                (iii) Right to withdraw consent
              </h3>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                You have the right to withdraw your consent to receive records
                electronically at any time. To withdraw, email{" "}
                {contactSupportEmail} with the subject line "Withdraw E-SIGN
                consent." Withdrawal is effective only after we have a
                reasonable period to act on it. After withdrawal,{" "}
                {organizationName} may continue to make records available in
                electronic format for records you already received before
                withdrawal, and may decline to enter into new transactions with
                you electronically. Withdrawal does not affect the legal
                effectiveness or enforceability of records you previously
                signed.
              </p>
              <div className="flex items-start gap-2 mt-3">
                <Checkbox
                  id="ack-withdrawal"
                  checked={acks.withdrawal}
                  onCheckedChange={(v) =>
                    setAcks((s) => ({ ...s, withdrawal: !!v }))
                  }
                  aria-label="Acknowledge right to withdraw consent"
                  data-testid="ack-withdrawal"
                />
                <Label htmlFor="ack-withdrawal" className="text-sm font-normal leading-snug">
                  I acknowledge I have been informed of my right to withdraw
                  consent and the consequences of doing so.
                </Label>
              </div>
            </section>

            {/* (iv) Updating contact information ─────────────────────────── */}
            <section
              aria-labelledby="esign-disclosure-iv-label"
              data-testid="disclosure-contact-update"
              className="rounded-md border bg-card p-4"
            >
              <h3
                id="esign-disclosure-iv-label"
                className="text-sm font-semibold flex items-center gap-2"
              >
                <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                (iv) How to update your contact information
              </h3>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                To make sure you continue to receive electronic records, you
                must keep your contact information current with{" "}
                {organizationName}. If you have an AcreOS account, update your
                email address in Settings → Account. If you are signing without
                an account (an external signer), send your updated email to{" "}
                {contactSupportEmail} along with the document name. You agree
                to notify {organizationName} promptly of any change to your
                email address.
              </p>
              <div className="flex items-start gap-2 mt-3">
                <Checkbox
                  id="ack-contact"
                  checked={acks.contact}
                  onCheckedChange={(v) =>
                    setAcks((s) => ({ ...s, contact: !!v }))
                  }
                  aria-label="Acknowledge contact-update procedures"
                  data-testid="ack-contact"
                />
                <Label htmlFor="ack-contact" className="text-sm font-normal leading-snug">
                  I acknowledge the procedure for updating my contact
                  information.
                </Label>
              </div>
            </section>

            {/* (v) Scope statement ─────────────────────────────────────── */}
            <section
              aria-labelledby="esign-disclosure-v-label"
              data-testid="disclosure-scope"
              className="rounded-md border bg-card p-4"
            >
              <h3
                id="esign-disclosure-v-label"
                className="text-sm font-semibold flex items-center gap-2"
              >
                <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                (v) Scope of consent
              </h3>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                Your consent covers all records related to your transactions
                with {organizationName} that may be presented electronically,
                including but not limited to: promissory notes; deeds of trust;
                purchase agreements; disclosures required by federal or state
                consumer-protection law (TILA, RESPA, GLBA, state usury and
                seller-finance disclosures); payment receipts; payoff
                statements; and any amendments, notices, or correspondence
                related to those records. Your consent is given solely to
                {" "}{organizationName} and is not a consent to receive records
                from other parties.
              </p>
              <div className="flex items-start gap-2 mt-3">
                <Checkbox
                  id="ack-scope"
                  checked={acks.scope}
                  onCheckedChange={(v) =>
                    setAcks((s) => ({ ...s, scope: !!v }))
                  }
                  aria-label="Acknowledge scope of consent"
                  data-testid="ack-scope"
                />
                <Label htmlFor="ack-scope" className="text-sm font-normal leading-snug">
                  I acknowledge the scope of records this consent covers.
                </Label>
              </div>
            </section>

            <p className="text-xs text-muted-foreground leading-relaxed pt-2">
              Disclosure version <code>{ESIGN_DISCLOSURE_VERSION}</code>. By
              clicking "I consent and continue" you affirm you have read and
              understood the five disclosures above and consent to use
              electronic records and signatures for the transactions described
              in (v).
            </p>
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onDecline}
            disabled={busy}
            aria-label="Decline electronic-signature consent"
            data-testid="esign-decline"
          >
            Decline
          </Button>
          <Button
            type="button"
            onClick={handleAccept}
            disabled={!allAcked || busy}
            aria-label="Consent to electronic signing and continue"
            data-testid="esign-accept"
          >
            {busy ? "Saving…" : "I consent and continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
