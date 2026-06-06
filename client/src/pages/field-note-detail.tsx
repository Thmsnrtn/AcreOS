/**
 * /field-notes/:slug — single field note (public).
 *
 * Successor to the prior /letters/:slug surface; voice is mechanics-first
 * third-person per the marketing-OS voice doctrine. Posts published
 * before the 2026-06-06 rebrand date render a grandfather banner so the
 * older first-person voice is contextualized for readers.
 */

import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { ArrowLeft, ArrowRight, Mail } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageMeta } from "@/hooks/use-document-title";
import DOMPurify from "isomorphic-dompurify";

interface FieldNote {
  id: string;
  slug: string;
  subject: string;
  htmlBody: string;
  publishedAt: string | null;
  senderEmail: string | null;
}

/**
 * Posts published before this date are flagged as grandfathered — they
 * were written under the prior /letters first-person founder voice and
 * surface a contextual banner so the older tone is not read as the
 * current AcreOS voice.
 */
const FIELD_NOTES_REBRAND_DATE = "2026-06-06";

function isGrandfathered(publishedAt: string | null): boolean {
  if (!publishedAt) return false;
  // Compare YYYY-MM-DD prefixes so we don't have to worry about TZ math.
  const publishedDay = new Date(publishedAt).toISOString().slice(0, 10);
  return publishedDay < FIELD_NOTES_REBRAND_DATE;
}

export default function FieldNoteDetailPage() {
  const [, params] = useRoute<{ slug: string }>("/field-notes/:slug");
  const slug = params?.slug ?? "";

  const note = useQuery<FieldNote>({
    queryKey: ["/api/field-notes", slug],
    queryFn: async () => {
      const r = await fetch(`/api/field-notes/${slug}`);
      if (!r.ok) throw new Error(r.status === 404 ? "Field note not found" : `Failed (${r.status})`);
      return r.json();
    },
    enabled: !!slug,
  });

  usePageMeta(
    note.data?.subject ?? "AcreOS field note",
    note.data?.subject ?? "A field note from AcreOS.",
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto p-4 md:p-8 pb-24">
        <header className="mb-6">
          <Button asChild variant="ghost" size="sm">
            <Link href="/field-notes">
              <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" /> All field notes
            </Link>
          </Button>
        </header>

        {note.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : note.error ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">{(note.error as Error).message}</p>
              <Button asChild className="mt-4">
                <Link href="/field-notes">Back to field notes</Link>
              </Button>
            </CardContent>
          </Card>
        ) : note.data ? (
          <article>
            <h1 className="text-3xl font-semibold tracking-tight mb-2">{note.data.subject}</h1>
            {note.data.publishedAt && (
              <p className="text-sm text-muted-foreground mb-8">
                {new Date(note.data.publishedAt).toLocaleDateString("en-US", {
                  year: "numeric", month: "long", day: "numeric",
                })}
              </p>
            )}
            {isGrandfathered(note.data.publishedAt) && (
              <div
                role="note"
                aria-label="Grandfathered post notice"
                className="mb-6 rounded-md border border-muted-foreground/20 bg-muted/40 px-4 py-3 text-xs text-muted-foreground"
              >
                From AcreOS's early days — written before the platform's voice
                settled into its current mechanics-first form.
              </div>
            )}
            <div
              className="prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(note.data.htmlBody) }}
            />

            <Card className="mt-12 border-primary/30 bg-primary/5">
              <CardContent className="py-8 text-center">
                <Mail className="w-6 h-6 text-primary mx-auto mb-3" aria-hidden="true" />
                <h2 className="text-xl font-semibold mb-2">Get the next one</h2>
                <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
                  Sign up free to receive every field note the day it publishes.
                </p>
                <Button asChild>
                  <a href={`/auth?utm_source=field-notes&utm_campaign=detail&utm_content=footer_cta&utm_term=${slug}`}>
                    Sign up free <ArrowRight className="w-4 h-4 ml-1.5" aria-hidden="true" />
                  </a>
                </Button>
              </CardContent>
            </Card>
          </article>
        ) : null}
      </div>
    </div>
  );
}
