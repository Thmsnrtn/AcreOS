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

  const durationStr = formatDuration(call.durationSeconds);
  const durationAria = call.durationSeconds && call.durationSeconds > 0
    ? `${Math.floor(call.durationSeconds / 60)} minutes ${call.durationSeconds % 60} seconds`
    : "no duration recorded";

  const detailId = `call-detail-${call.id}`;
  const rowAriaLabel = [
    `${call.direction} call`,
    dateLabel,
    `duration ${durationAria}`,
    call.sentimentScore !== undefined && call.sentimentScore !== null ? `sentiment ${sentimentLabel.toLowerCase()}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <li className="border rounded-lg overflow-hidden list-none">
      {/* Row header — click to expand */}
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-3 bg-background hover:bg-muted/50 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={detailId}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${rowAriaLabel}`}
      >
        {/* Direction icon */}
        <span aria-hidden="true" className="text-muted-foreground shrink-0">
          {isInbound ? (
            <PhoneIncoming className="w-4 h-4 text-blue-500" aria-hidden="true" />
          ) : (
            <PhoneOutgoing className="w-4 h-4 text-indigo-500" aria-hidden="true" />
          )}
        </span>

        {/* Date */}
        {call.createdAt ? (
          <time dateTime={call.createdAt} className="flex-1 text-sm font-medium tabular-nums">{dateLabel}</time>
        ) : (
          <span className="flex-1 text-sm font-medium">{dateLabel}</span>
        )}

        {/* Duration */}
        <span className="text-sm text-muted-foreground shrink-0 tabular-nums" aria-hidden="true">
          {durationStr}
        </span>

        {/* Direction badge */}
        <Badge variant="outline" className="capitalize shrink-0 text-xs" aria-hidden="true">
          {call.direction}
        </Badge>

        {/* Sentiment badge */}
        {call.sentimentScore !== undefined && call.sentimentScore !== null && (
          <span
            aria-hidden="true"
            className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${sentimentClass}`}
          >
            {sentimentLabel}
          </span>
        )}

        {/* Expand toggle */}
        <span aria-hidden="true" className="shrink-0 text-muted-foreground">
          {expanded ? (
            <ChevronUp className="w-4 h-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="w-4 h-4" aria-hidden="true" />
          )}
        </span>
      </button>

      {/* Expanded detail section */}
      {expanded && (
        <div id={detailId} role="region" aria-label={`Call details: ${dateLabel}`} className="px-4 py-3 border-t bg-muted/20 space-y-3">
          {detailLoading ? (
            <div role="status" aria-busy="true" aria-label="Loading transcript" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              Loading transcript…
            </div>
          ) : (
            <>
              {summary && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    AI summary
                  </p>
                  <p className="text-sm m-0">{summary}</p>
                </div>
              )}

              {transcript && (
                <div>
                  <p id={`${detailId}-transcript-label`} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    Transcript
                  </p>
                  <pre aria-labelledby={`${detailId}-transcript-label`} className="text-xs whitespace-pre-wrap bg-background border rounded p-2 max-h-48 overflow-y-auto font-sans leading-relaxed m-0">
                    {transcript}
                  </pre>
                </div>
              )}

              {!summary && !transcript && (
                <p className="text-sm text-muted-foreground italic m-0">
                  No transcript or summary available yet.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </li>
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
          <Phone className="w-4 h-4" aria-hidden="true" />
          Call log
        </CardTitle>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div role="status" aria-busy="true" aria-label="Loading calls" className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Loading…</span>
          </div>
        ) : isError ? (
          <p role="alert" className="text-sm text-destructive text-center py-4 m-0">
            Failed to load calls.
          </p>
        ) : calls.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6 m-0">
            No calls recorded yet.
          </p>
        ) : (
          <ul aria-label="Call history" className="space-y-2 list-none p-0 m-0">
            {calls.map((call) => (
              <CallRow key={call.id} call={call} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default CallLog;
