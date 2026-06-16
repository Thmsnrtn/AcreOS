/**
 * /founder/autopilot/voice — "Your Voice."
 *
 * Where the founder shapes the company by speaking to it. Two durable kinds:
 *   • Intent         — a north-star goal that steers ("reach $1k MRR sustainably")
 *   • Standing order — a hard rule the system never violates ("never email twice a week")
 *
 * Active orders are composed into every outward autopilot action (server-side),
 * so what you set here is genuinely load-bearing. Calm, editorial — the same
 * Bedrock identity as the daily letter.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Target, Scale, Plus, X, Loader2, MessageSquareQuote, Send } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { staggerContainer, staggerItem } from "@/lib/animations";

type OrderKind = "intent" | "standing_order";

interface StandingOrder {
  id: number;
  kind: OrderKind;
  body: string;
  active: boolean;
  createdAt: string;
}

const MAX_LEN = 600;

export default function FounderVoicePage() {
  useDocumentTitle("Your Voice · Founder");
  const { toast } = useToast();
  const qc = useQueryClient();

  const [kind, setKind] = useState<OrderKind>("intent");
  const [body, setBody] = useState("");

  const { data, isLoading } = useQuery<{ orders: StandingOrder[] }>({
    queryKey: ["/api/founder/autopilot/standing-orders", "active"],
    queryFn: async () => {
      const res = await fetch("/api/founder/autopilot/standing-orders?activeOnly=true", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const orders = data?.orders ?? [];
  const intents = orders.filter((o) => o.kind === "intent");
  const rules = orders.filter((o) => o.kind === "standing_order");

  const STANDING_ORDERS_KEY = ["/api/founder/autopilot/standing-orders", "active"];

  const create = useMutation({
    mutationFn: async (vars: { kind: OrderKind; body: string }) => {
      const res = await fetch("/api/founder/autopilot/standing-orders", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      });
      if (!res.ok) throw new Error(`Couldn't save (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      setBody("");
      void qc.invalidateQueries({ queryKey: STANDING_ORDERS_KEY });
      toast({ title: kind === "intent" ? "Intent set" : "Standing order set", description: "The system will honor it from now on." });
    },
    onError: (err) =>
      toast({ title: "Couldn't save", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/founder/autopilot/standing-orders/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Couldn't remove (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: STANDING_ORDERS_KEY });
      toast({ title: "Removed", description: "It no longer binds the system." });
    },
    onError: (err) =>
      toast({ title: "Couldn't remove", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  // Conversational steering — talk to the company in plain language.
  const [steerText, setSteerText] = useState("");
  const [steerReply, setSteerReply] = useState<string | null>(null);
  const steer = useMutation({
    mutationFn: async (text: string) => {
      const res = await fetch("/api/founder/autopilot/steer", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`Couldn't reach the company (${res.status})`);
      return res.json() as Promise<{ reply: string }>;
    },
    onSuccess: (data) => {
      setSteerReply(data.reply);
      setSteerText("");
      void qc.invalidateQueries({ queryKey: STANDING_ORDERS_KEY });
    },
    onError: (err) => setSteerReply(err instanceof Error ? err.message : String(err)),
  });

  const trimmed = body.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= MAX_LEN && !create.isPending;

  return (
    <PageShell maxWidth="4xl" label="Your Voice">
      <motion.div className="space-y-8" variants={staggerContainer} initial="hidden" animate="show">
        <motion.header variants={staggerItem} className="space-y-2">
          <div className="flex items-center gap-2">
            <MessageSquareQuote className="h-5 w-5 text-primary" aria-hidden="true" />
            <h1 className="font-serif text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
              Your Voice
            </h1>
          </div>
          <p className="text-base text-muted-foreground max-w-2xl">
            Shape the company by speaking to it. <span className="text-foreground">Intents</span> steer toward a goal;{" "}
            <span className="text-foreground">standing orders</span> are hard rules it never breaks. Both bind every
            action the system takes on your behalf.
          </p>
        </motion.header>

        {/* Conversational steering — talk to the company in plain language */}
        <motion.section variants={staggerItem}>
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-5 md:p-6 space-y-3">
              <p className="text-sm font-medium text-foreground">Talk to your company</p>
              <p className="text-xs text-muted-foreground">
                Ask it anything or tell it what to do — e.g. "pause growth", "focus on Texas", "never email twice a
                week", or "why did you do that?"
              </p>
              <div className="flex items-end gap-2">
                <Textarea
                  value={steerText}
                  onChange={(e) => setSteerText(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && steerText.trim()) {
                      e.preventDefault();
                      steer.mutate(steerText.trim());
                    }
                  }}
                  rows={2}
                  placeholder="Message your company… (Cmd+Enter to send)"
                  aria-label="Talk to your company"
                  className="flex-1 min-h-[44px] resize-none text-sm"
                  data-testid="steer-input"
                />
                <Button
                  type="button"
                  size="icon"
                  className="min-h-[44px] min-w-[44px] shrink-0"
                  disabled={steer.isPending || steerText.trim().length === 0}
                  onClick={() => steer.mutate(steerText.trim())}
                  aria-label="Send to your company"
                  data-testid="steer-send"
                >
                  {steer.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
              </div>
              {steerReply && (
                <div className="rounded-md border border-border/60 bg-background/60 p-3 text-sm text-foreground" aria-live="polite" data-testid="steer-reply">
                  {steerReply}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.section>

        {/* Composer */}
        <motion.section variants={staggerItem}>
          <Card>
            <CardContent className="p-5 md:p-6 space-y-4">
              <div className="inline-flex rounded-card border border-border p-1" role="tablist" aria-label="Order kind">
                {(["intent", "standing_order"] as OrderKind[]).map((k) => (
                  <button
                    key={k}
                    role="tab"
                    aria-selected={kind === k}
                    onClick={() => setKind(k)}
                    className={`min-h-[40px] rounded-md px-4 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                    data-testid={`kind-${k}`}
                  >
                    {k === "intent" ? "Intent" : "Standing order"}
                  </button>
                ))}
              </div>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                maxLength={MAX_LEN}
                placeholder={
                  kind === "intent"
                    ? "e.g. Reach $1k MRR sustainably without paid ads"
                    : "e.g. Never contact the same person twice in one week"
                }
                aria-label={kind === "intent" ? "New intent" : "New standing order"}
                className="resize-none text-sm"
                data-testid="voice-input"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {trimmed.length}/{MAX_LEN}
                </span>
                <Button
                  onClick={() => create.mutate({ kind, body: trimmed })}
                  disabled={!canSubmit}
                  className="min-h-[44px]"
                  data-testid="voice-add"
                >
                  {create.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                  )}
                  {kind === "intent" ? "Set intent" : "Set standing order"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.section>

        {/* Active orders */}
        {isLoading ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-16 w-full rounded-card" />
            <Skeleton className="h-16 w-full rounded-card" />
          </div>
        ) : orders.length === 0 ? (
          <motion.p variants={staggerItem} className="text-sm text-muted-foreground" data-testid="voice-empty">
            No intents or standing orders yet. Set one above — the system will carry it forever, until you remove it.
          </motion.p>
        ) : (
          <motion.div variants={staggerItem} className="space-y-6">
            <OrderList
              title="Intents"
              hint="The why — the system steers toward these."
              icon={Target}
              orders={intents}
              onRemove={(id) => remove.mutate(id)}
              removingId={remove.isPending ? remove.variables ?? null : null}
            />
            <OrderList
              title="Standing orders"
              hint="Hard rules — never broken."
              icon={Scale}
              orders={rules}
              onRemove={(id) => remove.mutate(id)}
              removingId={remove.isPending ? remove.variables ?? null : null}
            />
          </motion.div>
        )}
      </motion.div>
    </PageShell>
  );
}

function OrderList({
  title,
  hint,
  icon: Icon,
  orders,
  onRemove,
  removingId,
}: {
  title: string;
  hint: string;
  icon: typeof Target;
  orders: StandingOrder[];
  onRemove: (id: number) => void;
  removingId: number | null;
}) {
  if (orders.length === 0) return null;
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span className="text-xs text-muted-foreground">— {hint}</span>
      </div>
      <Card>
        <CardContent className="p-2 sm:p-3">
          <ul className="divide-y divide-border/60">
            {orders.map((o) => (
              <li key={o.id} className="flex items-start gap-3 px-2 py-3">
                <p className="min-w-0 flex-1 text-sm text-foreground">{o.body}</p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 min-h-[44px] min-w-[44px] text-muted-foreground hover:text-destructive"
                  onClick={() => onRemove(o.id)}
                  disabled={removingId === o.id}
                  aria-label={`Remove: ${o.body}`}
                  data-testid={`remove-order-${o.id}`}
                >
                  {removingId === o.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <X className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
