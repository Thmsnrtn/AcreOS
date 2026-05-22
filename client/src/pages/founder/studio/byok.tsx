/**
 * /founder/studio → BYOK tab.
 *
 * Per-channel minimum-tier gating. Each row writes a `byok.minTier.{channel}`
 * setting that the BYOK middleware reads to decide whether a Starter org can
 * supply its own Twilio key, whether SES is gated behind Pro, etc.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ExternalLink } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type Tier = "free" | "starter" | "pro" | "scale" | "founder";
const TIERS: Tier[] = ["free", "starter", "pro", "scale", "founder"];

interface ByokRow {
  channel: string;
  minTier: Tier;
  adoption: number;
}

interface ByokResponse {
  channels: ByokRow[];
}

export default function FounderStudioByok() {
  const { data, isLoading } = useQuery<ByokResponse>({
    queryKey: ["/api/founder/studio/byok"],
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">BYOK channel defaults</CardTitle>
          <p className="text-xs text-muted-foreground">
            The lowest tier on which a customer can supply their own credentials for the channel.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead>Minimum tier</TableHead>
                  <TableHead className="text-right">Adoption</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.channels.map((row) => (
                  <ByokRowEditor key={row.channel} row={row} />
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ByokRowEditor({ row }: { row: ByokRow }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [minTier, setMinTier] = useState<Tier>(row.minTier);

  const save = useMutation({
    mutationFn: async (next: Tier) =>
      apiRequest("POST", "/api/founder/studio/byok", {
        channel: row.channel,
        minTier: next,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/studio/byok"] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/studio/dials"] });
      toast({ title: `Updated ${row.channel}` });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
      setMinTier(row.minTier);
    },
  });

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{row.channel}</TableCell>
      <TableCell>
        <Select
          value={minTier}
          onValueChange={(v) => {
            setMinTier(v as Tier);
            save.mutate(v as Tier);
          }}
        >
          <SelectTrigger className="h-8 w-32" aria-label={`${row.channel} minimum tier`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIERS.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="text-right">
        <Badge variant={row.adoption > 0 ? "default" : "secondary"} className="font-mono">
          {row.adoption}
        </Badge>
      </TableCell>
      <TableCell>
        {save.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
        {!save.isPending && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            asChild
            aria-label={`Inspect ${row.channel} adoption`}
          >
            <a href="/founder/inspector/audit?area=byok">
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}
