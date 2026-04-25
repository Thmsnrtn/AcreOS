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
  proposal: "Action Plan",
  action_taken: "Action Taken",
  data: "Data",
  question: "Question",
  ceo_directive: "CEO Directive",
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
    <div className={`rounded-lg border p-3 ${bgClass}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm">{avatar}</span>
        <span className="text-xs font-semibold">{name}</span>
        <Badge variant="outline" className="text-[10px] h-4 px-1.5">{typeLabel}</Badge>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {new Date(message.createdAt).toLocaleTimeString()}
        </span>
      </div>
      <div className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</div>
    </div>
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
    <div className="border rounded-xl overflow-hidden">
      {/* Header */}
      <div className={`px-4 py-3 border-b ${sevStyle}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertOctagon className="h-4 w-4" />
            <span className="text-sm font-semibold">{room.title}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">
              <Users2 className="h-2.5 w-2.5 mr-1" />
              {room.participants?.length || 0} agents
            </Badge>
            {room.status === "active" && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px]"
                onClick={() => resolveRoom.mutate("Resolved by CEO")}
              >
                <CheckCircle2 className="h-2.5 w-2.5 mr-1" /> Resolve
              </Button>
            )}
          </div>
        </div>
        <div className="text-xs mt-1 opacity-75">
          Lead: {AGENT_AVATARS[room.leadAgent]} {AGENT_ROLES[room.leadAgent] || room.leadAgent}
          {" "}&middot; {new Date(room.createdAt).toLocaleString()}
        </div>
      </div>

      {/* Messages */}
      <div className="p-3 space-y-2 max-h-80 overflow-y-auto">
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          msgList.map(msg => <MessageBubble key={msg.id} message={msg} />)
        )}
        {msgList.length === 0 && !isLoading && (
          <div className="text-center py-4 text-xs text-muted-foreground">
            Agents are analyzing the situation...
          </div>
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
              onKeyDown={(e) => {
                if (e.key === "Enter" && directive.trim()) {
                  sendDirective.mutate(directive.trim());
                }
              }}
            />
            <Button
              size="sm"
              className="h-8 px-3"
              onClick={() => directive.trim() && sendDirective.mutate(directive.trim())}
              disabled={!directive.trim() || sendDirective.isPending}
            >
              <Send className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Resolution */}
      {room.status === "resolved" && room.resolution && (
        <div className="px-4 py-2 bg-emerald-50 dark:bg-emerald-950/20 border-t text-xs text-emerald-700 dark:text-emerald-400">
          Resolved: {room.resolution}
        </div>
      )}
    </div>
  );
}

export function WarRoom() {
  const { data: rooms, isLoading } = useQuery({
    queryKey: ["/api/founder/v6/war-rooms"],
    queryFn: () => apiRequest("GET", "/api/founder/v6/war-rooms").then(r => r.json()),
    refetchInterval: 10000,
  });

  if (isLoading) return <Skeleton className="h-48 w-full rounded-xl" />;

  const roomList = (rooms || []) as WarRoomData[];
  const activeRooms = roomList.filter(r => r.status === "active");
  const resolvedRooms = roomList.filter(r => r.status === "resolved").slice(0, 3);

  if (roomList.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" /> War Rooms
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6 text-sm text-muted-foreground">
            All clear. War rooms auto-convene when critical events occur.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" /> War Rooms
          </CardTitle>
          {activeRooms.length > 0 && (
            <Badge variant="destructive" className="text-xs animate-pulse">
              {activeRooms.length} active
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {activeRooms.map(room => (
          <WarRoomThread key={room.id} room={room} />
        ))}
        {resolvedRooms.map(room => (
          <WarRoomThread key={room.id} room={room} />
        ))}
      </CardContent>
    </Card>
  );
}
