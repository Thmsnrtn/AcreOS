/**
 * /sign/:docId — public signing page for external signers.
 *
 * Flow:
 *  1. Seller receives an email with a link like
 *     https://acreos.io/sign/123?s=signer-xyz&t=HMAC
 *  2. They land here, we call GET /api/public/sign/:docId?s&t which
 *     verifies the HMAC and returns document + signer metadata.
 *  3. They see the document content, sign it on canvas (or type their
 *     name), agree to the e-sign consent, and hit Sign.
 *  4. POST /api/public/sign/:docId records the signature, writes an
 *     audit row with their IP + user agent, updates the document
 *     status. We show a confirmation.
 *
 * No login required — the HMAC in the URL is the credential.
 */

import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, FileText, ShieldCheck, RefreshCw } from "lucide-react";
import { SignatureCapture } from "@/components/signature-capture";
import { AcreosLogo } from "@/components/acreos-logo";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { SkipToContent } from "@/components/skip-to-content";
import { shortDateTime } from "@/lib/format";

type Signer = {
  id: string;
  name: string;
  email: string;
  role: string;
  signedAt: string | null;
  order: number;
};

type PublicDoc = {
  document: {
    id: number;
    name: string;
    type: string;
    content: string | null;
    status: string;
    expiresAt: string | null;
  };
  organization: { name: string };
  signer: Signer;
  signersTotal: number;
  signersCompleted: number;
};

export default function SignDocumentPage() {
  const params = useParams<{ docId: string }>();
  const docId = parseInt(params.docId ?? "", 10);

  const sp = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const signerId = sp.get("s") || "";
  const token = sp.get("t") || "";

  useDocumentTitle("Sign document");

  const [data, setData] = useState<PublicDoc | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [signed, setSigned] = useState(false);
  const [allSigned, setAllSigned] = useState(false);
  const confirmationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!Number.isFinite(docId) || !signerId || !token) {
      setLoadError("This signing link is missing required information. Please re-open the link from your email exactly as received.");
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/public/sign/${docId}?s=${encodeURIComponent(signerId)}&t=${encodeURIComponent(token)}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "This signing link is invalid or has expired.");
        }
        const json = (await res.json()) as PublicDoc;
        if (cancelled) return;
        setData(json);
        if (json.signer.signedAt) setSigned(true);
      } catch (err: any) {
        if (cancelled || err?.name === "AbortError") return;
        setLoadError(err.message || "Could not load the document.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [docId, signerId, token]);

  useEffect(() => {
    if (signed && confirmationRef.current) {
      confirmationRef.current.focus();
    }
  }, [signed]);

  async function handleSubmit(capture: { data: string; type: "drawn" | "typed"; signerName: string }) {
    if (!data) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/public/sign/${docId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          s: signerId,
          t: token,
          signatureData: capture.data,
          signatureType: capture.type,
          consentGiven: true,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not submit your signature. Please try again.");
      }
      const body = await res.json();
      setSigned(true);
      setAllSigned(!!body.allSigned);
    } catch (err: any) {
      setSubmitError(err.message || "We couldn't submit your signature. Your signing link is still valid — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <SkipToContent />
      <nav className="border-b bg-background/95 backdrop-blur" aria-label="Signing header">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between gap-3">
          <AcreosLogo size={30} />
          <Badge variant="outline" className="text-xs">
            <ShieldCheck className="h-3 w-3 mr-1" aria-hidden="true" />
            Secure signing
          </Badge>
        </div>
      </nav>

      <main id="main-content" className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6">
        {loading ? (
          <Card>
            <CardContent className="p-8 space-y-4">
              <Skeleton className="h-6 w-2/3" aria-hidden="true" />
              <Skeleton className="h-40 w-full" aria-hidden="true" />
              <Skeleton className="h-40 w-full" aria-hidden="true" />
              <span className="sr-only">Loading document…</span>
            </CardContent>
          </Card>
        ) : loadError ? (
          <Card role="alert">
            <CardContent className="p-8 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <h2 className="font-semibold text-foreground">Can't load this document</h2>
                <p className="text-sm text-muted-foreground mt-1">{loadError}</p>
                <p className="text-xs text-muted-foreground mt-3">
                  If you believe this is a mistake, reply to the email that sent you this link — the sender can reissue it.
                </p>
                <div className="mt-4">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.location.reload()}
                    data-testid="button-reload-sign"
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                    Try again
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : data ? (
          <>
            <div>
              <p className="text-sm text-muted-foreground">
                Sent by <strong>{data.organization.name}</strong>
              </p>
              <h1 className="text-2xl font-semibold text-foreground mt-1 flex items-center gap-2">
                <FileText className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden="true" />
                <span className="min-w-0 break-words">{data.document.name}</span>
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Signing as <strong>{data.signer.name}</strong>
                {data.signer.role ? ` (${data.signer.role})` : ""}.
                {data.signersTotal > 1 && (
                  <>
                    {" "}
                    <span className="tabular-nums">{data.signersCompleted}</span> of{" "}
                    <span className="tabular-nums">{data.signersTotal}</span> signers complete.
                  </>
                )}
                {data.document.expiresAt && !signed && (
                  <> This link expires on <span className="tabular-nums">{shortDateTime(data.document.expiresAt)}</span>.</>
                )}
              </p>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Document to sign</CardTitle>
              </CardHeader>
              <CardContent>
                {data.document.content ? (
                  <div
                    className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap rounded-md border bg-muted/30 p-4 max-h-[480px] overflow-auto"
                    tabIndex={0}
                    role="region"
                    aria-label="Document contents"
                  >
                    {data.document.content}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    This document is available as a PDF. Your signature will be applied to the copy on file.
                  </p>
                )}
              </CardContent>
            </Card>

            {signed ? (
              <Card>
                <CardContent
                  ref={confirmationRef}
                  tabIndex={-1}
                  role="status"
                  aria-live="polite"
                  className="p-8 text-center space-y-3 outline-none"
                >
                  <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" aria-hidden="true" />
                  <h2 className="text-lg font-semibold text-foreground">
                    Signed — thank you, {data.signer.name}
                  </h2>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    {allSigned
                      ? `All ${data.signersTotal} signatures are in. ${data.organization.name} will receive a final copy shortly.`
                      : `Your signature is recorded. We'll notify ${data.organization.name} once every signer has completed their turn.`}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                {submitError && (
                  <div
                    role="alert"
                    className="rounded-md border border-destructive/50 bg-destructive/5 p-4 flex items-start gap-3"
                    data-testid="alert-submit-error"
                  >
                    <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">Couldn't submit your signature</p>
                      <p className="text-sm text-muted-foreground mt-1">{submitError}</p>
                    </div>
                  </div>
                )}
                <SignatureCapture
                  signerName={data.signer.name}
                  onSignatureCapture={(capture) => {
                    if (submitting) return;
                    void handleSubmit(capture);
                  }}
                  disabled={submitting}
                />
              </>
            )}

            <p className="text-xs text-muted-foreground text-center max-w-md mx-auto leading-relaxed">
              By signing, you agree this electronic signature is legally binding and has the same effect as a handwritten one. We log your IP address and browser as part of the signing audit trail.
            </p>
          </>
        ) : null}
      </main>
    </div>
  );
}
