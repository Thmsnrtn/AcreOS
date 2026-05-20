/**
 * /letters — public community-letter archive (FW-DIEGO-1).
 *
 * Customer-facing top-of-funnel acquisition surface. Anyone (no auth)
 * can read past founder letters before signing up. Diego's "founder-led
 * community as the SMB acquisition flywheel" plays out here.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, Mail } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageMeta } from "@/hooks/use-document-title";

interface LetterRow {
  id: string;
  slug: string;
  subject: string;
  publishedAt: string | null;
}

export default function LettersArchivePage() {
  usePageMeta(
    "Letters from the AcreOS founder",
    "Weekly founder letters — what we're building, what customers are telling us, lessons from property investors using AcreOS in the field.",
  );

  const letters = useQuery<{ letters: LetterRow[] }>({
    queryKey: ["/api/letters"],
    queryFn: async () => {
      const r = await fetch("/api/letters");
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      return r.json();
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto p-4 md:p-8 pb-24">
        <header className="mb-8 flex items-center justify-between">
          <Link href="/" className="font-semibold text-lg tracking-tight inline-flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> AcreOS
          </Link>
          <Button asChild size="sm" variant="outline">
            <a href="/auth?utm_source=letters&utm_campaign=archive">Sign up free</a>
          </Button>
        </header>

        <div className="mb-8 flex items-start gap-3">
          <Mail className="w-7 h-7 text-primary mt-1" aria-hidden="true" />
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Letters</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              Weekly notes from the AcreOS founder. What we're building, what
              customers are telling us, and what we're learning along the way.
              Subscribe at the bottom — or just read what's here.
            </p>
          </div>
        </div>

        {letters.isLoading ? (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : letters.data?.letters.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No letters published yet. Check back soon.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {letters.data?.letters.map((letter) => (
              <Card key={letter.id} className="hover-elevate">
                <Link href={`/letters/${letter.slug}`}>
                  <CardContent className="py-5 flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-medium truncate">{letter.subject}</div>
                      {letter.publishedAt && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {new Date(letter.publishedAt).toLocaleDateString("en-US", {
                            year: "numeric", month: "long", day: "numeric",
                          })}
                        </div>
                      )}
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                  </CardContent>
                </Link>
              </Card>
            ))}
          </div>
        )}

        <Card className="mt-12 border-primary/30 bg-primary/5">
          <CardContent className="py-8 text-center">
            <h2 className="text-xl font-semibold mb-2">Want this in your inbox?</h2>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              Sign up free to get every letter delivered. No marketing spam — the
              same letter you'd read on this page, sent the day it publishes.
            </p>
            <Button asChild>
              <a href="/auth?utm_source=letters&utm_campaign=archive&utm_content=footer_cta">
                Sign up free
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
