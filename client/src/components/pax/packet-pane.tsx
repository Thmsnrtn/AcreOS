/**
 * PaxPacketPane — the artifact pane, foundation (E2 slice 1 §4).
 *
 * Renders one prepared packet beside the surface that summoned it: a right
 * pane on desktop, full screen on mobile. It opens from the URL — `?packet=ID`
 * on the current page — so a work-queue row and a brief line are plain links,
 * and the browser's Back closes the pane (mobile back navigation preserved).
 *
 * It renders sections with their provenance and carries approve / dismiss.
 * It does not edit, version, diff or regenerate (that is P3/P9).
 *
 * Approving executes nothing by itself: a memory proposal is saved to the
 * business memory — a write the user can already make in Settings → Pax —
 * and the copy says so before the tap.
 */
import { useEffect, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import type { PaxPacket, PaxPacketSection } from "@shared/schema";
import { PAX_MEMORY_CATEGORY_WORDS } from "@shared/pax-core";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/error-utils";
import { formatDateTime } from "@/lib/format";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";

/** Wire shape: dates arrive as ISO strings. */
type PacketWire = Omit<PaxPacket, "createdAt" | "decidedAt"> & { createdAt: string; decidedAt: string | null };

export const PACKETS_KEY = ["/api/pax/core/packets"] as const;

/** The packet id in `?packet=`, or null. */
function packetIdFrom(search: string): number | null {
  const raw = new URLSearchParams(search).get("packet");
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? n : null;
}

/** The URL that opens a packet over the current page. */
export function packetHref(path: string, id: number): string {
  return `${path}?packet=${id}`;
}

const APPROVE_WORDS: Record<PaxPacket["kind"], { button: string; effect: string }> = {
  memory_proposal: {
    button: "Save to memory",
    effect: "Approving saves this to your business memory, where you can edit or delete it. Nothing is sent.",
  },
};

function SectionView({ section }: { section: PaxPacketSection }) {
  return (
    <section className="space-y-1" data-testid="packet-section">
      <h3 className="acr-eyebrow">{section.heading}</h3>
      <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{section.body}</p>
      <p className="text-xs text-acr-ink-3" data-testid="packet-section-provenance">
        Source: {section.source} · as of {formatDateTime(section.asOf)}
      </p>
    </section>
  );
}

export function PaxPacketPane() {
  const search = useSearch();
  const [location, setLocation] = useLocation();
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const id = packetIdFrom(search);
  const openedHere = useRef(false);

  // A pane opened by navigating within the app closes with history.back(),
  // so the Back button and the close button agree. A deep link closes by
  // removing the parameter.
  useEffect(() => {
    if (id != null && window.history.length > 1) openedHere.current = true;
  }, [id]);

  const close = () => {
    if (openedHere.current) {
      openedHere.current = false;
      window.history.back();
    } else {
      setLocation(location, { replace: true });
    }
  };

  const packetQuery = useQuery<{ packet: PacketWire }>({
    queryKey: [`/api/pax/core/packets/${id}`],
    enabled: id != null,
  });

  const decide = useMutation({
    mutationFn: async (decision: "approve" | "dismiss") => {
      const res = await apiRequest("POST", `/api/pax/core/packets/${id}/${decision}`);
      return res.json() as Promise<{ packet: PacketWire }>;
    },
    onSuccess: (_data, decision) => {
      queryClient.invalidateQueries({ queryKey: PACKETS_KEY });
      queryClient.invalidateQueries({ queryKey: [`/api/pax/core/packets/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/pax/core/memory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pax/core/ledger"] });
      queryClient.invalidateQueries({ queryKey: ["/api/today"] });
      toast({ title: decision === "approve" ? "Approved" : "Dismissed" });
      close();
    },
    onError: (error) => {
      toast({ title: "Couldn't record that", description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const packet = packetQuery.data?.packet;
  const words = packet ? APPROVE_WORDS[packet.kind] : null;

  return (
    <Sheet open={id != null} onOpenChange={(open) => !open && close()}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={isMobile ? "h-[100dvh] max-h-[100dvh] overflow-y-auto" : "w-full sm:max-w-lg overflow-y-auto"}
        data-testid="pax-packet-pane"
      >
        {packetQuery.isLoading ? (
          <div className="space-y-3 pt-6">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : packetQuery.isError || !packet ? (
          <div className="pt-6">
            <SheetHeader>
              <SheetTitle>Prepared work</SheetTitle>
              <SheetDescription>This item could not be opened.</SheetDescription>
            </SheetHeader>
            <QueryErrorState
              error={(packetQuery.error as Error | null) ?? null}
              onRetry={() => packetQuery.refetch()}
              compact
              testId="packet-pane-error"
            />
          </div>
        ) : (
          <div className="space-y-5">
            <SheetHeader>
              <p className="acr-eyebrow">Pax prepared</p>
              <SheetTitle data-testid="packet-title">{packet.title}</SheetTitle>
              <SheetDescription>
                Prepared {formatDateTime(packet.createdAt)}
                {packet.status !== "prepared" && ` · ${packet.status}`}
              </SheetDescription>
            </SheetHeader>
            {packet.concerns.length > 0 && (
              <div className="flex flex-wrap gap-1.5" aria-label="What this concerns">
                {packet.concerns.map((c, i) => (
                  <Badge key={`${c.type}-${c.id ?? i}`} variant="secondary">
                    {PAX_MEMORY_CATEGORY_WORDS[c.label] ?? c.label}
                  </Badge>
                ))}
              </div>
            )}
            <div className="space-y-4">
              {packet.sections.map((s, i) => (
                <SectionView key={i} section={s} />
              ))}
            </div>
            {packet.status === "prepared" && words ? (
              <div className="space-y-3 border-t border-[color:var(--acr-line-soft)] pt-4">
                <p className="text-xs text-acr-ink-3">{words.effect}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => decide.mutate("approve")}
                    disabled={decide.isPending}
                    className="min-h-11"
                    data-testid="button-packet-approve"
                  >
                    <Check className="w-4 h-4 mr-1.5" aria-hidden="true" />
                    {words.button}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => decide.mutate("dismiss")}
                    disabled={decide.isPending}
                    className="min-h-11"
                    data-testid="button-packet-dismiss"
                  >
                    <X className="w-4 h-4 mr-1.5" aria-hidden="true" />
                    Dismiss
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-acr-ink-3" data-testid="packet-decided">
                You {packet.status} this{packet.decidedAt ? ` ${formatDateTime(packet.decidedAt)}` : ""}.
              </p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
