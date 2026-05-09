/**
 * /letters/:slug — single community letter (public).
 */

import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { ArrowLeft, ArrowRight, Mail } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageMeta } from "@/hooks/use-document-title";

interface Letter {
  id: string;
  slug: string;
  subject: string;
  htmlBody: string;
  publishedAt: string | null;
  senderEmail: string | null;
}

export default function LetterDetailPage() {
  const [, params] = useRoute<{ slug: string }>("/letters/:slug");
  const slug = params?.slug ?? "";

  const letter = useQuery<Letter>({
    queryKey: ["/api/letters", slug],
    queryFn: async () => {
      const r = await fetch(`/api/letters/${slug}`);
      if (!r.ok) throw new Error(r.status === 404 ? "Letter not found" : `Failed (${r.status})`);
      return r.json();
    },
    enabled: !!slug,
  });

  usePageMeta(
    letter.data?.subject ?? "AcreOS letter",
    letter.data?.subject ?? "A founder letter from AcreOS.",
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto p-4 md:p-8 pb-24">
        <header className="mb-6">
          <Button asChild variant="ghost" size="sm">
            <Link href="/letters">
              <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" /> All letters
            </Link>
          </Button>
        </header>

        {letter.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : letter.error ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">{(letter.error as Error).message}</p>
              <Button asChild className="mt-4">
                <Link href="/letters">Back to letters</Link>
              </Button>
            </CardContent>
          </Card>
        ) : letter.data ? (
          <article>
            <h1 className="text-3xl font-semibold tracking-tight mb-2">{letter.data.subject}</h1>
            {letter.data.publishedAt && (
              <p className="text-sm text-muted-foreground mb-8">
                {new Date(letter.data.publishedAt).toLocaleDateString("en-US", {
                  year: "numeric", month: "long", day: "numeric",
                })}
              </p>
            )}
            <div
              className="prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: letter.data.htmlBody }}
            />

            <Card className="mt-12 border-primary/30 bg-primary/5">
              <CardContent className="py-8 text-center">
                <Mail className="w-6 h-6 text-primary mx-auto mb-3" aria-hidden="true" />
                <h2 className="text-xl font-semibold mb-2">Get the next one</h2>
                <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
                  Sign up free to receive every founder letter the day it publishes.
                </p>
                <Button asChild>
                  <a href={`/auth?utm_source=letters&utm_campaign=detail&utm_content=footer_cta&utm_term=${slug}`}>
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
