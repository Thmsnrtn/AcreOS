/**
 * /outreach/mail · In-Flight tab.
 *
 * Lists currently-active campaigns grouped by shipment. Each shipment has:
 *  - header (label / piece count / cost / sent date)
 *  - progress timeline (printed → in_transit → expected → delivered → response)
 *  - expandable per-piece table with USPS scan timestamps + QR + inbound calls
 *
 * Wow moments (UI-only — wire to real data when Pax + USPS feeds land):
 *  - mailbox icon "opens" briefly when a piece's status flips to delivered
 *  - QR-scan highlight placeholder
 */

import { useState } from "react";
import { motion } from "framer-motion";
import {
  ChevronDown,
  ChevronUp,
  Inbox,
  Mailbox,
  PackageCheck,
  PackageOpen,
  Printer,
  QrCode,
  Truck,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { staggerContainer, staggerItem } from "@/lib/animations";
import {
  type ShipmentSummary,
  useInFlightShipments,
  useShipmentPieces,
} from "@/hooks/use-outreach-mail";
import { formatDate, formatDateTime } from "@/lib/format";

const STAGES: { key: string; label: string; icon: typeof Printer }[] = [
  { key: "printed", label: "Printed", icon: Printer },
  { key: "in_transit", label: "In transit", icon: Truck },
  { key: "expected", label: "Expected", icon: PackageOpen },
  { key: "delivered", label: "Delivered", icon: PackageCheck },
  { key: "response", label: "Response window", icon: Inbox },
];

export default function InFlightTab() {
  const shipments = useInFlightShipments();

  if (shipments.isLoading) {
    return (
      <div className="space-y-4" data-testid="in-flight-loading">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (shipments.error) {
    return (
      <QueryErrorState
        error={shipments.error as Error}
        onRetry={() => shipments.refetch()}
      />
    );
  }

  if (!shipments.data || shipments.data.shipments.length === 0) {
    return (
      <EmptyState
        icon={Mailbox}
        headline="No campaigns in flight"
        subtitle="Queued sends show up here with per-piece USPS scans, QR scans, and inbound calls. Start a send under Compose."
        // TODO(cta): the compose action is the right CTA but lives in the Compose tab — add tab navigation link here
        cta={{ label: "", _noOp: true }}
        testId="in-flight-empty"
      />
    );
  }

  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="space-y-4"
      data-testid="in-flight-list"
    >
      {shipments.data.shipments.map((s) => (
        <motion.div key={s.id} variants={staggerItem}>
          <ShipmentCard shipment={s} />
        </motion.div>
      ))}
    </motion.div>
  );
}

function ShipmentCard({ shipment }: { shipment: ShipmentSummary }) {
  const [expanded, setExpanded] = useState(false);
  const pieces = useShipmentPieces(expanded ? shipment.id : null);

  const sentLabel = shipment.sentAt
    ? formatDate(shipment.sentAt)
    : formatDate(shipment.queuedAt);
  const idLabel = `R${String(shipment.id).padStart(3, "0")}`;
  const label = shipment.label ?? "Untitled campaign";

  return (
    <Card data-testid={`shipment-card-${shipment.id}`}>
      <CardHeader>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base md:text-lg" data-testid={`shipment-title-${shipment.id}`}>
              Campaign {idLabel} — {label}
            </CardTitle>
            <CardDescription>
              {shipment.pieceCount.toLocaleString()} pieces · {formatUsd(shipment.totalCents)} · sent{" "}
              {sentLabel}
              {shipment.provider ? ` via ${shipment.provider}` : ""}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={shipment.status} />
            {shipment.savedVsLobCents > 0 && (
              <Badge variant="secondary" className="text-acr-pos">
                Saved {formatUsd(shipment.savedVsLobCents)}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ProgressTimeline shipment={shipment} />

        <Button
          variant="outline"
          size="sm"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={`pieces-${shipment.id}`}
          data-testid={`button-expand-${shipment.id}`}
        >
          {expanded ? (
            <>
              <ChevronUp className="w-4 h-4 mr-2" aria-hidden="true" />
              Hide per-piece detail
            </>
          ) : (
            <>
              <ChevronDown className="w-4 h-4 mr-2" aria-hidden="true" />
              Show per-piece detail
            </>
          )}
        </Button>

        {expanded && (
          <div id={`pieces-${shipment.id}`}>
            {pieces.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : pieces.error ? (
              <QueryErrorState
                error={pieces.error as Error}
                onRetry={() => pieces.refetch()}
                compact
              />
            ) : pieces.data ? (
              <PiecesTable rows={pieces.data.pieces} />
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProgressTimeline({ shipment }: { shipment: ShipmentSummary }) {
  const total = shipment.pieceCount;
  // Roll up arbitrary piece statuses into our 5 visible stages.
  const stageCount = (key: string) => shipment.stageCounts[key] ?? 0;
  const stageRollups: Record<string, number> = {
    printed: stageCount("printed") + stageCount("in_transit") + stageCount("delivered"),
    in_transit: stageCount("in_transit") + stageCount("delivered"),
    expected: stageCount("delivered") + stageCount("in_transit"),
    delivered: stageCount("delivered"),
    response: 0, // Response data lands when QR/inbound wiring ships.
  };

  return (
    <ol
      className="grid grid-cols-2 sm:grid-cols-5 gap-2"
      aria-label="Shipment progress"
      data-testid={`timeline-${shipment.id}`}
    >
      {STAGES.map((stage) => {
        const Icon = stage.icon;
        const count = stageRollups[stage.key] ?? 0;
        const isDelivered = stage.key === "delivered";
        const active = count > 0;
        return (
          <li
            key={stage.key}
            className={`rounded-md border p-2 flex items-center gap-2 ${
              active ? "border-primary/40 bg-primary/5" : "border-border bg-muted/20"
            }`}
            aria-current={active ? "step" : undefined}
          >
            <motion.div
              animate={isDelivered && active ? { rotate: [0, -8, 8, 0] } : { rotate: 0 }}
              transition={{ duration: 0.6, ease: "easeInOut" }}
              className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
                active ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
              }`}
              aria-hidden="true"
            >
              <Icon className="w-4 h-4" />
            </motion.div>
            <div className="min-w-0">
              <p className="text-xs font-medium leading-tight">{stage.label}</p>
              <p className="text-xs text-muted-foreground font-mono">
                {count.toLocaleString()}/{total.toLocaleString()}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function PiecesTable({
  rows,
}: {
  rows: ReturnType<typeof useShipmentPieces> extends { data: { pieces: infer T } | undefined }
    ? T
    : never;
}) {
  if (!rows || rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground p-3" data-testid="pieces-empty">
        No per-piece records yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Recipient</TableHead>
            <TableHead>Address</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Printed</TableHead>
            <TableHead>Delivered</TableHead>
            <TableHead className="text-right">QR</TableHead>
            <TableHead className="text-right">Calls</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => (
            <TableRow key={p.id} data-testid={`piece-row-${p.id}`}>
              <TableCell className="whitespace-nowrap">{p.recipientName}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {p.addressLine1}, {p.city} {p.state} {p.zip}
              </TableCell>
              <TableCell>
                <StatusBadge status={p.status} />
              </TableCell>
              <TableCell className="text-xs">{formatDateTime(p.printedAt)}</TableCell>
              <TableCell className="text-xs">{formatDateTime(p.deliveredAt)}</TableCell>
              <TableCell className="text-right">
                <span className="inline-flex items-center gap-1 text-xs">
                  <QrCode className="w-3 h-3" aria-hidden="true" />
                  {p.qrScanCount}
                </span>
              </TableCell>
              <TableCell className="text-right text-xs">{p.inboundCallCount}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  // Color via design tokens — never hardcoded Tailwind colors.
  if (status === "delivered" || status === "sent") {
    return (
      <Badge variant="secondary" className="text-acr-pos">
        {status}
      </Badge>
    );
  }
  if (status === "cancelled" || status === "failed" || status === "returned") {
    return (
      <Badge variant="secondary" className="text-acr-neg">
        {status}
      </Badge>
    );
  }
  if (status === "queued" || status === "pending") {
    return <Badge variant="outline">{status}</Badge>;
  }
  return <Badge variant="secondary">{status}</Badge>;
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
