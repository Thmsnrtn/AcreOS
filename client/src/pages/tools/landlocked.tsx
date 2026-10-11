/**
 * /tools/landlocked — the free "Is this parcel landlocked?" checker (W3).
 *
 * Public, no account. It asks the server, which answers ONLY from AcreOS's own
 * accuracy-gated road-access fact for a parcel it keeps — or refuses and says
 * why (county not loaded, parcel id not found, fact not verified). The page
 * renders the server's words; it never infers an answer itself.
 */
import { useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, CheckCircle2, CircleAlert, CircleHelp, Loader2 } from "lucide-react";
import { usePageMeta } from "@/hooks/use-document-title";
import { OpenGraph } from "@/components/seo/OpenGraph";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { emitMarketingTouch, getAnonymousId } from "@/lib/marketing-touch";
import type { PublicFactRow } from "@shared/landData/publicFactText";

// Mirrors server/services/landlockedCheck.ts LandlockedAnswer.
type Answer =
  | {
      status: "answered";
      verdict: "public_road" | "non_access_road_only" | "no_road";
      headline: string;
      explanation: string;
      parcel: { state: string; countyLabel: string; apn: string; reportPath: string };
      fact: PublicFactRow;
      caveats: string[];
    }
  | {
      status: "refused";
      reason: string;
      message: string;
      county: { label: string; coverageLabel: string | null; guidePath: string | null } | null;
    };

const SIGNUP =
  "/auth?mode=register&utm_source=landlocked-check&utm_medium=internal&utm_campaign=landlocked_checker";

export default function LandlockedCheckPage() {
  usePageMeta(
    "Is this parcel landlocked? Free road-access check",
    "Check whether a road touches a parcel's mapped boundary, from AcreOS's own verified road-access fact — with the source, the date and what a map cannot tell you.",
  );
  const sid = useRef(getAnonymousId());
  const [state, setState] = useState("TN");
  const [county, setCounty] = useState("");
  const [apn, setApn] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const qs = new URLSearchParams({ state: state.trim(), county: county.trim(), apn: apn.trim(), sid: sid.current });
      const res = await fetch(`/api/public/land/landlocked?${qs.toString()}`);
      const body = await res.json().catch(() => null);
      if (res.status === 429) {
        setError("Too many checks in a short time. Wait a minute and try again.");
      } else if (!res.ok) {
        setError(typeof body?.message === "string" ? body.message : "The check could not run. Try again.");
      } else {
        setAnswer(body as Answer);
        emitMarketingTouch({
          surface: "public:landlocked-check",
          eventType: "funnel_step",
          payload: { step: "checked", status: (body as Answer).status },
        });
      }
    } catch {
      setError("The check could not reach AcreOS. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-background pb-24 lg:pb-0">
      <OpenGraph
        url="https://acreos.io/tools/landlocked"
        title="Is this parcel landlocked? — AcreOS"
        description="A free road-access check from AcreOS's own verified data, with its source, date and limits."
      />
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            AcreOS
          </Link>
          <Link
            href={SIGNUP}
            className="rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Sign up
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-8 px-4 py-8 sm:px-6 sm:py-12">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Free tool</p>
          <h1 className="mt-1 text-2xl font-bold text-foreground sm:text-3xl">Is this parcel landlocked?</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter the county's parcel number. AcreOS answers from its own road-access fact — checked against
            hand-labelled parcels before it is shown — for parcels in counties it has loaded. Where it has no
            verified answer, it says so instead of guessing.
          </p>
        </div>

        <form onSubmit={submit} className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-[6rem_1fr_1fr_auto] sm:items-end" data-testid="landlocked-form">
          <div className="space-y-1.5">
            <Label htmlFor="ll-state">State</Label>
            <Input id="ll-state" value={state} maxLength={2} onChange={(e) => setState(e.target.value.toUpperCase())} required autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ll-county">County</Label>
            <Input id="ll-county" value={county} placeholder="DeKalb" onChange={(e) => setCounty(e.target.value)} required autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ll-apn">Parcel number</Label>
            <Input id="ll-apn" value={apn} placeholder="As on the tax record" onChange={(e) => setApn(e.target.value)} required autoComplete="off" />
          </div>
          <Button type="submit" disabled={busy} data-testid="landlocked-submit">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Check
          </Button>
        </form>

        {error && (
          <p role="alert" className="text-sm text-destructive" data-testid="landlocked-error">
            {error}
          </p>
        )}

        {answer?.status === "answered" && (
          <section className="space-y-4 rounded-lg border border-border bg-card p-5" aria-live="polite" data-testid="landlocked-answer">
            <h2 className="flex items-start gap-2 text-lg font-semibold text-foreground">
              {answer.verdict === "public_road" ? (
                <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              ) : (
                <CircleAlert className="mt-1 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
              )}
              {answer.headline}
            </h2>
            <p className="text-sm text-foreground">{answer.explanation}</p>
            <p className="text-xs text-muted-foreground">
              Parcel {answer.parcel.apn}, {answer.parcel.countyLabel} County, {answer.parcel.state}. Confidence:{" "}
              {answer.fact.confidence}. Source:{" "}
              {answer.fact.sources.map((s) => `${s.name} (retrieved ${s.retrievedOn})`).join("; ")}.
              {answer.fact.accuracy &&
                ` Accuracy check: ${answer.fact.accuracy.agreed} of ${answer.fact.accuracy.sampleSize} hand-checked parcels agreed.`}
            </p>
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {answer.caveats.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-3">
              <Link
                href={answer.parcel.reportPath}
                className="rounded text-sm font-medium text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                See the full land report
              </Link>
            </div>
          </section>
        )}

        {answer?.status === "refused" && (
          <section className="space-y-3 rounded-lg border border-dashed border-border p-5" aria-live="polite" data-testid="landlocked-refusal">
            <h2 className="flex items-start gap-2 text-lg font-semibold text-foreground">
              <CircleHelp className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              No verified answer for this parcel
            </h2>
            <p className="text-sm text-foreground">{answer.message}</p>
            {answer.county && (
              <p className="text-xs text-muted-foreground">
                {answer.county.label}: {answer.county.coverageLabel ?? "data coverage not yet assessed"}.
                {answer.county.guidePath && (
                  <>
                    {" "}
                    <Link href={answer.county.guidePath} className="underline">
                      County guide
                    </Link>
                  </>
                )}
              </p>
            )}
          </section>
        )}

        <section className="rounded-lg border border-border bg-muted/30 p-5" data-testid="landlocked-cta">
          <h2 className="text-base font-semibold text-foreground">Working land deals?</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Inside AcreOS every parcel in your list gets the same verified facts — access, frontage, buildable
            acres, public-land adjacency — and you can ask for a county AcreOS has not loaded yet.
          </p>
          <Button asChild className="mt-3">
            <Link href={SIGNUP}>Sign up for AcreOS</Link>
          </Button>
        </section>
      </div>
    </main>
  );
}
