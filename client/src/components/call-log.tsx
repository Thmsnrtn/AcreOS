import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  PhoneIncoming,
  PhoneOutgoing,
  ChevronDown,
  ChevronUp,
  Phone,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------
// Types
// ---------------------------------------------------------------

interface VoiceCall {
  id: number;
  callSid?: string;
  direction: "inbound" | "outbound";
  fromNumber?: string;
  toNumber?: string;
  durationSeconds?: number;
  callStatus?: string;
  sentimentScore?: string | number;
  motivationScore?: string | number;
  recordingUrl?: string;
  createdAt?: string;
  summary?: string;
}

interface CallWithTranscript extends VoiceCall {
  transcript?: {
    id: number;
    fullTranscript?: string;
    summary?: string;
  } | null;
}

interface CallLogResponse {
  calls: VoiceCall[];
  success: boolean;
}

interface TranscriptResponse {
  call: VoiceCall;
  transcript?: {
    id: number;
    fullTranscript?: string;
    summary?: string;
  } | null;
  success: boolean;
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getSentimentFromScore(
  score?: string | number
): "positive" | "neutral" | "negative" {
  const val = typeof score === "string" ? parseFloat(score) : (score ?? 0);
  if (val > 0.2) return "positive";
  if (val < -0.2) return "negative";
  return "neutral";
}

const sentimentConfig: Record<
  "positive" | "neutral" | "negative",
  { label: string; className: string }
> = {
  positive: {
    label: "Positive",
    className:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  },
  neutral: {
    label: "Neutral",
    className:
      "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  },
  negative: {
    label: "Negative",
    className:
      "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  },
};

// ---------------------------------------------------------------
// Expandable call row
// ---------------------------------------------------------------

function CallRow({ call }: { call: VoiceCall }) {
  const [expanded, setExpanded] = useState(false);

  const { data: detail, isLoading: detailLoading } =
    useQuery<TranscriptResponse>({
      queryKey: [`/api/voice/calls/${call.id}/transcript`],
      enabled: expanded,
    });

  const sentiment = getSentimentFromScore(call.sentimentScore);
  const { label: sentimentLabel, className: sentimentClass } =
    sentimentConfig[sentiment];

  const isInbound = call.direction === "inbound";
  const dateLabel = call.createdAt
    ? format(new Date(call.createdAt), "MMM d, yyyy h:mm a")
    : "Unknown date";

  const summary =
    detail?.transcript?.summary ||
    detail?.call?.summary ||
    call.summary ||
    null;
  const transcript = detail?.transcript?.fullTranscript || null;

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Row header — click to expand */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 bg-background hover:bg-muted/50 transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {/* Direction icon */}
        <span className="text-muted-foreground shrink-0">
          {isInbound ? (
            <PhoneIncoming className="w-4 h-4 text-blue-500" />
          ) : (
            <PhoneOutgoing className="w-4 h-4 text-indigo-500" />
          )}
        </span>

        {/* Date */}
        <span className="flex-1 text-sm font-medium">{dateLabel}</span>

        {/* Duration */}
        <span className="text-sm text-muted-foreground shrink-0">
          {formatDuration(call.durationSeconds)}
        </span>

        {/* Direction badge */}
        <Badge variant="outline" className="capitalize shrink-0 text-xs">
          {call.direction}
        </Badge>

        {/* Sentiment badge */}
        {call.sentimentScore !== undefined && call.sentimentScore !== null && (
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${sentimentClass}`}
          >
            {sentimentLabel}
          </span>
        )}

        {/* Expand toggle */}
        <span className="shrink-0 text-muted-foreground">
          {expanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </span>
      </button>

      {/* Expanded detail section */}
      {expanded && (
        <div className="px-4 py-3 border-t bg-muted/20 space-y-3">
          {detailLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading transcript…
            </div>
          ) : (
            <>
              {summary && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    AI Summary
                  </p>
                  <p className="text-sm">{summary}</p>
                </div>
              )}

              {transcript && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    Transcript
                  </p>
                  <pre className="text-xs whitespace-pre-wrap bg-background border rounded p-2 max-h-48 overflow-y-auto font-sans leading-relaxed">
                    {transcript}
                  </pre>
                </div>
              )}

              {!summary && !transcript && (
                <p className="text-sm text-muted-foreground italic">
                  No transcript or summary available yet.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Main CallLog component
// ---------------------------------------------------------------

interface CallLogProps {
  leadId: number;
}

export function CallLog({ leadId }: CallLogProps) {
  const { data, isLoading, isError } = useQuery<CallLogResponse>({
    queryKey: [`/api/voice/calls`, { leadId }],
    queryFn: async () => {
      const res = await fetch(`/api/voice/calls?leadId=${leadId}`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error("Failed to fetch voice calls");
      }
      return res.json();
    },
  });

  const calls = data?.calls ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Phone className="w-4 h-4" />
          Call Log
        </CardTitle>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive text-center py-4">
            Failed to load calls.
          </p>
        ) : calls.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No calls recorded yet.
          </p>
        ) : (
          <div className="space-y-2">
            {calls.map((call) => (
              <CallRow key={call.id} call={call} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default CallLog;
