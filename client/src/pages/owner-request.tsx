/**
 * Public: "Stop contacting me / delete my information" (W5a).
 *
 * For property owners — not AcreOS customers. No sign-in. Asks only for what
 * we match on (email, phone, mailing address) and a way to confirm it is
 * them: an emailed link, or a code mailed to the address. Never a government
 * identifier. Also the landing page for the emailed confirmation link
 * (?ref=…&token=…) and the place to type a mailed code.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, CheckCircle2, CircleAlert } from "lucide-react";
import { usePageMeta } from "@/hooks/use-document-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Verbs } from "@/lib/labels";

type Phase =
  | { kind: "form" }
  | { kind: "submitted"; ref: string; dueAt: string; verification: "email" | "mail_code"; emailed: boolean }
  | { kind: "confirmed" };

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
}

function errorText(r: { status: number; body: any }): string {
  if (r.status === 429) return "Too many requests from this connection. Please try again later.";
  return typeof r.body?.message === "string" ? r.body.message : "Something went wrong. Please try again.";
}

export default function OwnerRequestPage() {
  usePageMeta(
    "Stop contact and delete my information",
    "Ask AcreOS to stop all contact from any AcreOS customer and to delete your information. No account needed.",
  );
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ email: "", phone: "", addressLine1: "", city: "", state: "", zip: "", residenceState: "", wantsDeletion: true, verification: "email" as "email" | "mail_code" });
  const [code, setCode] = useState({ ref: "", secret: "" });

  // The emailed link lands here with ?ref=&token= and confirms in one step.
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const ref = qs.get("ref");
    const token = qs.get("token");
    if (ref && token) {
      setBusy(true);
      void postJson("/api/public/owner-optout/verify", { ref, secret: token }).then((r) => {
        setBusy(false);
        if (r.ok) setPhase({ kind: "confirmed" });
        else setError(errorText(r));
      });
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await postJson("/api/public/owner-optout", {
      ...f,
      email: f.email || undefined,
      phone: f.phone || undefined,
      addressLine1: f.addressLine1 || undefined,
      city: f.city || undefined,
      state: f.state || undefined,
      zip: f.zip || undefined,
      residenceState: f.residenceState || undefined,
    });
    setBusy(false);
    if (r.ok) setPhase({ kind: "submitted", ...r.body });
    else setError(errorText(r));
  }

  async function confirmCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await postJson("/api/public/owner-optout/verify", { ref: code.ref.trim(), secret: code.secret.trim() });
    setBusy(false);
    if (r.ok) setPhase({ kind: "confirmed" });
    else setError(errorText(r));
  }

  const field = (id: keyof typeof f, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`or-${id}`}>{label}</Label>
      <Input id={`or-${id}`} value={String(f[id])} onChange={(e) => setF({ ...f, [id]: e.target.value })} {...props} />
    </div>
  );

  return (
    <main className="mx-auto max-w-2xl space-y-8 px-4 py-10 text-foreground">
      <Link href="/privacy" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Privacy policy
      </Link>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Stop contact and delete my information</h1>
        <p className="text-muted-foreground">
          AcreOS is software that land investors use to find and contact property owners. If you own property and want no
          more letters, emails, texts or calls sent through AcreOS — from any of its customers — tell us here. You do not
          need an account.
        </p>
      </header>

      {error ? (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" /> {error}
        </p>
      ) : null}

      {phase.kind === "confirmed" ? (
        <section className="space-y-2 rounded-md border border-border p-4" aria-live="polite">
          <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-5 w-5 text-primary" aria-hidden="true" /> Confirmed.</p>
          <p className="text-sm text-muted-foreground">
            From now on AcreOS will not send mail, email, texts or calls to the details you gave, for any of its customers.
            If you asked us to delete your information, each customer's copy is reviewed and erased within the legal deadline.
          </p>
        </section>
      ) : phase.kind === "submitted" ? (
        <section className="space-y-2 rounded-md border border-border p-4" aria-live="polite">
          <p className="font-medium">Request received. Your reference: <span className="font-mono">{phase.ref}</span></p>
          <p className="text-sm text-muted-foreground">
            {phase.verification === "email"
              ? phase.emailed
                ? "We sent a link to your email. Open it to confirm — nothing changes until you do."
                : "We could not send the confirmation email just now. Please submit again in a little while."
              : "We will mail a code to the address you gave. When it arrives, enter it below with your reference."}{" "}
            We will finish by {phase.dueAt.slice(0, 10)}.
          </p>
        </section>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <fieldset className="space-y-3">
            <legend className="font-medium">What should we stop contacting?</legend>
            <p className="text-sm text-muted-foreground">Give any of these. We keep only a scrambled fingerprint of each, used to match.</p>
            {field("email", "Email address", { type: "email", autoComplete: "email", maxLength: 254 })}
            {field("phone", "Phone number", { type: "tel", autoComplete: "tel", maxLength: 32 })}
            {field("addressLine1", "Mailing address (street)", { autoComplete: "address-line1", maxLength: 200 })}
            <div className="grid grid-cols-3 gap-3">
              {field("city", "City", { autoComplete: "address-level2", maxLength: 100 })}
              {field("state", "State", { autoComplete: "address-level1", maxLength: 2 })}
              {field("zip", "ZIP code", { autoComplete: "postal-code", maxLength: 10 })}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="font-medium">How should we confirm it's you?</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="verification" className="focus-visible:ring-2 focus-visible:ring-ring" checked={f.verification === "email"} onChange={() => setF({ ...f, verification: "email" })} />
              Email me a confirmation link
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="verification" className="focus-visible:ring-2 focus-visible:ring-ring" checked={f.verification === "mail_code"} onChange={() => setF({ ...f, verification: "mail_code" })} />
              Mail a code to my address
            </label>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="focus-visible:ring-2 focus-visible:ring-ring" checked={f.wantsDeletion} onChange={(e) => setF({ ...f, wantsDeletion: e.target.checked })} />
            Also delete my information held in AcreOS customers' accounts
          </label>
          {field("residenceState", "State you live in (sets the legal deadline; optional)", { maxLength: 2 })}
          <p className="text-xs text-muted-foreground">We never ask for a Social Security number or any other government ID.</p>
          <Button type="submit" disabled={busy}>Send request</Button>
        </form>
      )}

      {phase.kind !== "confirmed" ? (
        <form onSubmit={confirmCode} className="space-y-3 border-t border-border pt-6">
          <h2 className="font-medium">Got a code in the mail?</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="or-ref">Reference</Label>
              <Input id="or-ref" value={code.ref} onChange={(e) => setCode({ ...code, ref: e.target.value })} maxLength={64} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="or-code">Code</Label>
              <Input id="or-code" inputMode="numeric" value={code.secret} onChange={(e) => setCode({ ...code, secret: e.target.value })} maxLength={12} />
            </div>
          </div>
          <Button type="submit" variant="outline" disabled={busy}>{Verbs.CONFIRM}</Button>
        </form>
      ) : null}
    </main>
  );
}
