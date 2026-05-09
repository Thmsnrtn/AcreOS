/**
 * /deal-rooms/share/:slug — public unauthenticated deal-room view.
 *
 * Panel-300 #128 (closes the FW-MIREILLE-1 loop): the share-link generator
 * + view counter were shipped earlier. This is the customer-facing landing
 * surface that converts views to signups. No auth required.
 *
 * Three-section layout:
 *   1. The deal: sanitized projection (status, doc count, participant
 *      count, view count) — NOT price, NOT participants by name.
 *   2. The aha: "Want this for your own deals?" with persona-keyed
 *      copy (deal-rooms work for land flippers, note investors, BH
 *      operators alike).
 *   3. Signup CTA → /auth?utm_source=deal-room-share&utm_campaign=loop
 */

import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, Users, FileText, Eye, Calendar, ShieldCheck } from "lucide-react";
import { usePageMeta } from "@/hooks/use-document-title";

interface PublicDealRoom {
  slug: string;
  dealType: string | null;
  status: string;
  sharedDocumentsCount: number;
  participantCount: number;
  closedAt: string | null;
  createdAt: string | null;
  viewCount: number;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

export default function DealRoomSharePage() {
  const [, params] = useRoute<{ slug: string }>("/deal-rooms/share/:slug");
  const slug = params?.slug ?? "";
  const [room, setRoom] = useState<PublicDealRoom | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  usePageMeta(
    "A deal in motion on AcreOS",
    "Real-estate operators close deals on AcreOS — multi-party document rooms, audit-logged signatures, ESIGN-integrity-grade trust. Want this for your own deals?",
  );

  useEffect(() => {
    if (!slug) return;
    let active = true;
    fetch(`/api/public/deal-rooms/${slug}`)
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(r.status === 404 ? "This deal-room link is no longer active." : `Error ${r.status}`);
        }
        return r.json();
      })
      .then((data: PublicDealRoom) => {
        if (active) setRoom(data);
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [slug]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="max-w-3xl mx-auto p-4 md:p-8 pb-24">
        <header className="mb-8 flex items-center justify-between">
          <Link href="/" className="font-semibold text-lg tracking-tight">AcreOS</Link>
          <Button asChild size="sm" variant="outline">
            <a href="/auth?utm_source=deal-room-share&utm_campaign=loop&utm_content=header_cta">
              Sign up free
            </a>
          </Button>
        </header>

        {loading ? (
          <div className="text-center py-20 text-muted-foreground">Loading deal-room…</div>
        ) : error ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">{error}</p>
              <Button asChild className="mt-4" variant="outline">
                <Link href="/">Back to AcreOS</Link>
              </Button>
            </CardContent>
          </Card>
        ) : room ? (
          <>
            {/* The deal */}
            <Card className="mb-6">
              <CardContent className="py-8 md:py-10">
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                  Shared deal-room
                </div>
                <h1 className="text-3xl font-semibold mb-2">
                  {room.dealType
                    ? `A ${room.dealType.replace(/_/g, " ")} deal in motion`
                    : "A deal in motion"}
                </h1>
                <div className="text-sm text-muted-foreground mb-6">
                  Status: <span className="font-medium text-foreground">{room.status}</span>
                  {room.closedAt && <> · Closed {fmtDate(room.closedAt)}</>}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div className="flex flex-col items-start gap-1 p-3 rounded-md bg-muted/40">
                    <Users className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                    <div className="text-xs text-muted-foreground">Participants</div>
                    <div className="font-semibold">{room.participantCount}</div>
                  </div>
                  <div className="flex flex-col items-start gap-1 p-3 rounded-md bg-muted/40">
                    <FileText className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                    <div className="text-xs text-muted-foreground">Shared docs</div>
                    <div className="font-semibold">{room.sharedDocumentsCount}</div>
                  </div>
                  <div className="flex flex-col items-start gap-1 p-3 rounded-md bg-muted/40">
                    <Eye className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                    <div className="text-xs text-muted-foreground">Views</div>
                    <div className="font-semibold">{room.viewCount}</div>
                  </div>
                  <div className="flex flex-col items-start gap-1 p-3 rounded-md bg-muted/40">
                    <Calendar className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                    <div className="text-xs text-muted-foreground">Started</div>
                    <div className="font-semibold">{fmtDate(room.createdAt)}</div>
                  </div>
                </div>
                <p className="mt-6 text-sm text-muted-foreground">
                  This is a sanitized public view. Personally identifiable details, prices,
                  and document contents are private to the operator and counter-parties.
                </p>
              </CardContent>
            </Card>

            {/* The aha */}
            <Card className="mb-6 border-primary/30 bg-primary/5">
              <CardContent className="py-8 md:py-10">
                <h2 className="text-2xl font-semibold mb-3">
                  Want this for your own deals?
                </h2>
                <p className="text-muted-foreground mb-4">
                  AcreOS gives land investors, note investors, and property operators
                  the same deal-room infrastructure that closes 6-figure transactions
                  here. Multi-party documents, audit-logged signatures, ESIGN-integrity
                  guards — the full back-office of a serious operation, without the
                  enterprise price tag.
                </p>
                <ul className="text-sm text-muted-foreground space-y-2 mb-6">
                  <li className="flex items-start gap-2">
                    <ShieldCheck className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" aria-hidden="true" />
                    Tamper-evident document hashes (every signature carries a SHA-256
                    fingerprint of what was signed).
                  </li>
                  <li className="flex items-start gap-2">
                    <ShieldCheck className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" aria-hidden="true" />
                    Audit-log immutable: even AcreOS staff can't edit the trail.
                  </li>
                  <li className="flex items-start gap-2">
                    <ShieldCheck className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" aria-hidden="true" />
                    Deal-room sharing (this page) is opt-in per deal; default is private.
                  </li>
                </ul>
                <div className="flex flex-wrap gap-3">
                  <Button asChild size="lg">
                    <a href={`/auth?utm_source=deal-room-share&utm_campaign=loop&utm_content=primary_cta&utm_term=${slug}`}>
                      Start free <ArrowRight className="w-4 h-4 ml-1.5" aria-hidden="true" />
                    </a>
                  </Button>
                  <Button asChild size="lg" variant="outline">
                    <Link href="/why">Why AcreOS?</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Footer */}
            <p className="text-xs text-muted-foreground text-center">
              Sharing was enabled by the operator. To request removal of this shared
              view, the operator can revoke the share link from their AcreOS account.
              <br />
              <Link href="/legal/privacy" className="underline-offset-2 hover:underline">Privacy policy</Link>
              {" · "}
              <Link href="/legal/sub-processors" className="underline-offset-2 hover:underline">Sub-processors</Link>
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
