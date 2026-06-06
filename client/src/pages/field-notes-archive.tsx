/**
 * /field-notes — public field-notes archive.
 *
 * Customer-facing top-of-funnel surface. Anyone (no auth) can read past
 * field notes before signing up. Replaces the prior /letters surface;
 * the voice is now mechanics-first third-person per the marketing-OS
 * voice doctrine (`docs/internal/marketing-os/00-blueprint.md` §2).
 *
 * Old routes (/letters, /letters/:slug) issue a 301 redirect to the
 * corresponding /field-notes URL at the SPA-shell layer (see
 * `server/static.ts` LEGACY_LETTERS_301).
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, Mail } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageMeta } from "@/hooks/use-document-title";

interface FieldNoteRow {
  id: string;
  slug: string;
  subject: string;
  publishedAt: string | null;
}

export default function FieldNotesArchivePage() {
  usePageMeta(
    "AcreOS field notes",
    "AcreOS publishes weekly field notes — what the platform shipped, what the data showed, and what land investors are running into in the field.",
  );

  const notes = useQuery<{ letters: FieldNoteRow[] }>({
    queryKey: ["/api/field-notes"],
    queryFn: async () => {
      const r = await fetch("/api/field-notes");
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
            <a href="/auth?utm_source=field-notes&utm_campaign=archive">Sign up free</a>
          </Button>
        </header>

        <div className="mb-8 flex items-start gap-3">
          <Mail className="w-7 h-7 text-primary mt-1" aria-hidden="true" />
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Field notes</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              AcreOS publishes weekly field notes on what the platform shipped,
              what the data showed, and what land investors are running into in
              the field. Subscribe at the bottom — or just read what's here.
            </p>
          </div>
        </div>

        {notes.isLoading ? (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : notes.data?.letters.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No field notes published yet. Check back soon.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {notes.data?.letters.map((note) => (
              <Card key={note.id} className="hover-elevate">
                <Link href={`/field-notes/${note.slug}`}>
                  <CardContent className="py-5 flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-medium truncate">{note.subject}</div>
                      {note.publishedAt && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {new Date(note.publishedAt).toLocaleDateString("en-US", {
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
              Sign up free to get every field note delivered the day it
              publishes. Same content as the page, no marketing extras.
            </p>
            <Button asChild>
              <a href="/auth?utm_source=field-notes&utm_campaign=archive&utm_content=footer_cta">
                Sign up free
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
