import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, History } from "lucide-react";
import { Link } from "wouter";
import { usePageMeta } from "@/hooks/use-document-title";

/**
 * /terms/history — the version history ToS §16 promises ("AcreOS will
 * maintain a version history of these Terms accessible at
 * acreos.io/terms/history"). Before this page existed, that sentence
 * pointed at a 404 — a promise the product made and didn't keep. Append a
 * new entry (newest first) with every material Terms change.
 */
const VERSIONS: Array<{
  version: string;
  date: string;
  changes: string[];
}> = [
  {
    version: "1.1",
    date: "2026-07-25",
    changes: [
      "§19 (Entire agreement; assignment): added an assignment clause — AcreOS may assign the agreement to a successor entity formed to operate the Service (including the Massachusetts LLC being organized), which assumes all rights and obligations with subscriptions continuing uninterrupted; customers may not assign without written consent.",
      "§19: added severability and non-waiver language.",
    ],
  },
  {
    version: "1.0",
    date: "2026-06-01",
    changes: ["Initial Terms of Service."],
  },
];

export default function TermsHistory() {
  usePageMeta(
    "Terms of service — version history",
    "Every version of the AcreOS Terms of Service, with what changed and when."
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-4 md:p-8 pb-24">
        <div className="mb-6">
          <Button asChild variant="ghost" size="sm" data-testid="button-back-to-terms">
            <Link href="/terms">
              <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
              Back to Terms of service
            </Link>
          </Button>
        </div>

        <Card className="border-border/50" data-testid="card-terms-history">
          <CardContent className="p-6 md:p-8 space-y-8">
            <div className="flex items-center gap-3">
              <History className="w-8 h-8 text-primary" aria-hidden="true" />
              <h1 className="text-3xl font-bold" data-testid="text-history-title">
                Terms of service — version history
              </h1>
            </div>
            <p className="text-muted-foreground">
              Every material change to the AcreOS Terms of Service, newest first. The current
              version is always at{" "}
              <Link href="/terms" className="underline-offset-2 hover:underline text-primary">
                acreos.io/terms
              </Link>
              .
            </p>

            {VERSIONS.map((v) => (
              <section key={v.version} className="space-y-3" data-testid={`history-v${v.version}`}>
                <h2 className="text-xl font-semibold">
                  Version {v.version}{" "}
                  <span className="text-muted-foreground font-normal text-base tabular-nums">
                    · {v.date}
                  </span>
                </h2>
                <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                  {v.changes.map((c, i) => (
                    <li key={i} className="leading-relaxed">{c}</li>
                  ))}
                </ul>
              </section>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
