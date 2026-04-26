/**
 * War Room — Sovereign Company Protocol v6
 *
 * Real-time collaborative thread for critical events.
 * Agents auto-convene, analyze, propose solutions.
 * CEO watches or jumps in with directives.
 *
 * UI: Slack-like thread with agent-colored messages.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AGENT_AVATARS,
  AGENT_ROLES,
  AGENT_COLORS,
} from "@/lib/trust-language";
import {
  AlertOctagon,
  Send,
  CheckCircle2,
  ShieldAlert,
  Users2,
  MessageSquare,
} from "lucide-react";

interface WarRoomData {
  id: number;
  title: string;
  severity: string;
  triggerEvent: string;
  participants: string[];
  leadAgent: string;
  status: string;
  ceoJoined: boolean;
  createdAt: string;
  resolution?: string;
}

interface WarRoomMessageData {
  id: number;
  warRoomId: number;
  fromAgent: string;
  messageType: string;
  content: string;
  createdAt: string;
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-200",
  high: "bg-amber-100 text-amber-800 border-amber-200",
  medium: "bg-blue-100 text-blue-800 border-blue-200",
};

const MESSAGE_TYPE_LABEL: Record<string, string> = {
  analysis: "Analysis",
  proposal: "Action plan",
  action_taken: "Action taken",
  data: "Data",
  question: "Question",
  ceo_directive: "CEO directive",
};

const AGENT_BUBBLE_BG: Record<string, string> = {
  blue: "bg-blue-50 dark:bg-blue-950/30 border-blue-100",
  emerald: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-100",
  amber: "bg-amber-50 dark:bg-amber-950/30 border-amber-100",
  purple: "bg-purple-50 dark:bg-purple-950/30 border-purple-100",
  red: "bg-red-50 dark:bg-red-950/30 border-red-100",
  slate: "bg-slate-50 dark:bg-slate-950/30 border-slate-100",
  indigo: "bg-indigo-50 dark:bg-indigo-950/30 border-indigo-100",
  cyan: "bg-cyan-50 dark:bg-cyan-950/30 border-cyan-100",
  orange: "bg-orange-50 dark:bg-orange-950/30 border-orange-100",
  pink: "bg-pink-50 dark:bg-pink-950/30 border-pink-100",
};

function MessageBubble({ message }: { message: WarRoomMessageData }) {
  const isCEO = message.fromAgent === "ceo";
  const avatar = isCEO ? "👑" : (AGENT_AVATARS[message.fromAgent] || "?");
  const name = isCEO ? "You (CEO)" : (AGENT_ROLES[message.fromAgent] || message.fromAgent);
  const color = isCEO ? "indigo" : (AGENT_COLORS[message.fromAgent] || "slate");
  const bgClass = isCEO ? "bg-indigo-50 dark:bg-indigo-950/30 border-indigo-100" : (AGENT_BUBBLE_BG[color] || "");
  const typeLabel = MESSAGE_TYPE_LABEL[message.messageType] || message.messageType;

  return (
    <li className={`rounded-lg border p-3 list-none ${bgClass}`}>
      <div className="flex items-center gap-2 mb-1">
        <span aria-hidden="true" className="text-sm">{avatar}</span>
        <span className="text-xs font-semibold">{name}</span>
        <Badge variant="outline" className="text-[10px] h-4 px-1.5">{typeLabel}</Badge>
        <time dateTime={message.createdAt} className="text-[10px] text-muted-foreground ml-auto tabular-nums">
          {new Date(message.createdAt).toLocaleTimeString()}
        </time>
      </div>
      <p className="text-sm whitespace-pre-wrap leading-relaxed m-0">{message.content}</p>
    </li>
  );
}

function WarRoomThread({ room }: { room: WarRoomData }) {
  const queryClient = useQueryClient();
  const [directive, setDirective] = useState("");

  const { data: messages, isLoading } = useQuery({
    queryKey: ["/api/founder/v6/war-rooms", room.id, "messages"],
    queryFn: () => apiRequest("GET", `/api/founder/v6/war-rooms/${room.id}/messages`).then(r => r.json()),
    refetchInterval: room.status === "active" ? 3000 : false,
  });

  const sendDirective = useMutation({
    mutationFn: (text: string) =>
      apiRequest("POST", `/api/founder/v6/war-rooms/${room.id}/directive`, { directive: text }),
    onSuccess: () => {
      setDirective("");
      queryClient.invalidateQueries({ queryKey: ["/api/founder/v6/war-rooms", room.id, "messages"] });
    },
  });

  const resolveRoom = useMutation({
    mutationFn: (resolution: string) =>
      apiRequest("POST", `/api/founder/v6/war-rooms/${room.id}/resolve`, { resolution }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v6/war-rooms"] }),
  });

  const msgList = (messages || []) as WarRoomMessageData[];
  const sevStyle = SEVERITY_STYLES[room.severity] || SEVERITY_STYLES.medium;

  return (
    <li className="border rounded-xl overflow-hidden list-none">
      {/* Header */}
      <div className={`px-4 py-3 border-b ${sevStyle}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertOctagon className="h-4 w-4" aria-hidden="true" />
            <span className="text-sm font-semibold">{room.title}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]" aria-label={`${room.participants?.length || 0} agents participating`}>
              <Users2 className="h-2.5 w-2.5 mr-1" aria-hidden="true" />
              <span className="tabular-nums">{room.participants?.length || 0}</span> agents
            </Badge>
            {room.status === "active" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 text-[10px]"
                onClick={() => resolveRoom.mutate("Resolved by CEO")}
                disabled={resolveRoom.isPending}
                aria-busy={resolveRoom.isPending}
                aria-label={`Resolve war room: ${room.title}`}
              >
                <CheckCircle2 className="h-2.5 w-2.5 mr-1" aria-hidden="true" /> {resolveRoom.isPending ? "Resolving…" : "Resolve"}
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs mt-1 opacity-75 m-0">
          Lead: <span aria-hidden="true">{AGENT_AVATARS[room.leadAgent]}</span> {AGENT_ROLES[room.leadAgent] || room.leadAgent}
          {" "}&middot; <time dateTime={room.createdAt} className="tabular-nums">{new Date(room.createdAt).toLocaleString()}</time>
        </p>
      </div>

      {/* Messages */}
      <div role="log" aria-live="polite" aria-label={`${room.title} discussion`} className="p-3 space-y-2 max-h-80 overflow-y-auto">
        {isLoading ? (
          <Skeleton role="status" aria-busy="true" aria-label="Loading messages" className="h-20 w-full" />
        ) : msgList.length > 0 ? (
          <ul aria-label="War room messages" className="space-y-2 list-none p-0 m-0">
            {msgList.map(msg => <MessageBubble key={msg.id} message={msg} />)}
          </ul>
        ) : (
          <p className="text-center py-4 text-xs text-muted-foreground">
            Agents are analyzing the situation…
          </p>
        )}
      </div>

      {/* CEO Input */}
      {room.status === "active" && (
        <div className="px-3 pb-3">
          <div className="flex gap-2">
            <Input
              value={directive}
              onChange={(e) => setDirective(e.target.value)}
              placeholder="Send a directive to the team…"
              className="text-sm h-8"
              aria-label="CEO directive"
              autoCapitalize="sentences"
              onKeyDown={(e) => {
                if (e.key === "Enter" && directive.trim()) {
                  sendDirective.mutate(directive.trim());
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              className="h-8 px-3"
              onClick={() => directive.trim() && sendDirective.mutate(directive.trim())}
              disabled={!directive.trim() || sendDirective.isPending}
              aria-busy={sendDirective.isPending}
              aria-label="Send directive"
            >
              <Send className="h-3 w-3" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}

      {/* Resolution */}
      {room.status === "resolved" && room.resolution && (
        <p role="status" className="px-4 py-2 bg-emerald-50 dark:bg-emerald-950/20 border-t text-xs text-emerald-700 dark:text-emerald-400 m-0">
          Resolved: {room.resolution}
        </p>
      )}
    </li>
  );
}

export function WarRoom() {
  const { data: rooms, isLoading } = useQuery({
    queryKey: ["/api/founder/v6/war-rooms"],
    queryFn: () => apiRequest("GET", "/api/founder/v6/war-rooms").then(r => r.json()),
    refetchInterval: 10000,
  });

  if (isLoading) return <Skeleton role="status" aria-busy="true" aria-label="Loading war rooms" className="h-48 w-full rounded-xl" />;

  const roomList = (rooms || []) as WarRoomData[];
  const activeRooms = roomList.filter(r => r.status === "active");
  const resolvedRooms = roomList.filter(r => r.status === "resolved").slice(0, 3);

  if (roomList.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" aria-hidden="true" /> War rooms
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-center py-6 text-sm text-muted-foreground">
            All clear. War rooms auto-convene when critical events occur.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" aria-hidden="true" /> War rooms
          </CardTitle>
          {activeRooms.length > 0 && (
            <Badge variant="destructive" className="text-xs animate-pulse tabular-nums" aria-label={`${activeRooms.length} active`}>
              {activeRooms.length} active
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul aria-label="War rooms" className="space-y-4 list-none p-0 m-0">
          {activeRooms.map(room => (
            <WarRoomThread key={room.id} room={room} />
          ))}
          {resolvedRooms.map(room => (
            <WarRoomThread key={room.id} room={room} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
