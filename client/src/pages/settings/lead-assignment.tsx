/**
 * Settings → Lead Assignment Rules — Phase 5 §5 Part B (team readiness).
 *
 * Admins configure how new /api/leads land on team members. Rules apply
 * in priority order (lowest = first); each rule can be:
 *   • round_robin — distributes leads across weighted assignees.
 *   • territory   — matches lead.state / lead.county before assigning.
 *   • random      — weighted-random pick.
 *
 * The "Test with sample lead" panel calls /api/team-readiness/lead-
 * assignment-rules/test so admins can confirm the rule fires before a
 * real lead arrives.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Trash2, Plus, FlaskConical, ArrowUp, ArrowDown } from "lucide-react";

interface WeightedAssignee {
  teamMemberId: number;
  weight: number;
}

interface Rule {
  id: number;
  organizationId: number;
  name: string;
  ruleType: "round_robin" | "territory" | "random";
  priority: number;
  territoryFilter?: { states?: string[]; counties?: string[] } | null;
  weightedAssignees?: WeightedAssignee[] | null;
  isDefault: boolean;
  isActive: boolean;
}

interface TeamMember {
  id: number;
  displayName?: string;
  email?: string;
  role: string;
  isActive: boolean;
}

const blankRule = (): Omit<Rule, "id" | "organizationId"> => ({
  name: "New rule",
  ruleType: "round_robin",
  priority: 100,
  territoryFilter: null,
  weightedAssignees: [],
  isDefault: false,
  isActive: true,
});

export default function LeadAssignmentSettingsPage() {
  useDocumentTitle("Lead assignment rules");
  const { toast } = useToast();
  const [draft, setDraft] = useState<Partial<Rule> | null>(null);
  const [testState, setTestState] = useState("");
  const [testCounty, setTestCounty] = useState("");
  const [testResult, setTestResult] = useState<number | null | undefined>(undefined);

  const { data: rules = [], isLoading: rulesLoading } = useQuery<Rule[]>({
    queryKey: ["/api/team-readiness/lead-assignment-rules"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/team-readiness/lead-assignment-rules");
      const json = await res.json();
      return json.rules;
    },
  });

  const { data: members = [] } = useQuery<TeamMember[]>({
    queryKey: ["/api/organization/members"],
  });

  const saveMutation = useMutation({
    mutationFn: async (rule: Partial<Rule>) => {
      const res = await apiRequest("POST", "/api/team-readiness/lead-assignment-rules", rule);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team-readiness/lead-assignment-rules"] });
      setDraft(null);
      toast({ title: "Rule saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/team-readiness/lead-assignment-rules/${id}`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team-readiness/lead-assignment-rules"] });
      toast({ title: "Rule deleted" });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async ({ id, priority }: { id: number; priority: number }) => {
      const rule = rules.find((r) => r.id === id);
      if (!rule) return null;
      const res = await apiRequest("POST", "/api/team-readiness/lead-assignment-rules", {
        ...rule,
        priority,
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team-readiness/lead-assignment-rules"] });
    },
  });

  const handleTest = async () => {
    const res = await apiRequest("POST", "/api/team-readiness/lead-assignment-rules/test", {
      state: testState || undefined,
      county: testCounty || undefined,
    });
    const json = await res.json();
    setTestResult(json.teamMemberId);
  };

  const memberLabel = (id: number) => {
    const m = members.find((mm) => mm.id === id);
    return m?.displayName || m?.email || `#${id}`;
  };

  return (
    <PageShell isLoading={rulesLoading} label="Loading lead-assignment rules">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Lead assignment rules</h1>
          <p className="text-sm text-muted-foreground">
            Auto-assign new leads to team members. Rules apply top-down — first match wins.
          </p>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Rules</CardTitle>
            <Button onClick={() => setDraft(blankRule())} size="sm">
              <Plus className="h-4 w-4 mr-1" /> New rule
            </Button>
          </CardHeader>
          <CardContent>
            {rules.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No rules yet. New leads will be left unassigned until you add one.
              </p>
            ) : (
              <ul className="divide-y">
                {rules.map((rule, idx) => (
                  <li key={rule.id} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline">#{rule.priority}</Badge>
                      <div>
                        <div className="font-medium">{rule.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {rule.ruleType} · {(rule.weightedAssignees ?? []).length} assignee(s)
                          {!rule.isActive && " · disabled"}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Move rule up"
                        disabled={idx === 0}
                        onClick={() =>
                          reorderMutation.mutate({ id: rule.id, priority: Math.max(0, rule.priority - 10) })
                        }
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Move rule down"
                        disabled={idx === rules.length - 1}
                        onClick={() =>
                          reorderMutation.mutate({ id: rule.id, priority: rule.priority + 10 })
                        }
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setDraft(rule)}>
                        Edit
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete rule ${rule.name}`}
                        onClick={() => deleteMutation.mutate(rule.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {draft && (
          <Card>
            <CardHeader>
              <CardTitle>{draft.id ? "Edit rule" : "New rule"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="rule-name">Name</Label>
                  <Input
                    id="rule-name"
                    value={draft.name ?? ""}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="rule-type">Type</Label>
                  <Select
                    value={draft.ruleType}
                    onValueChange={(v) => setDraft({ ...draft, ruleType: v as any })}
                  >
                    <SelectTrigger id="rule-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="round_robin">Round-robin</SelectItem>
                      <SelectItem value="territory">Territory</SelectItem>
                      <SelectItem value="random">Random (weighted)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {draft.ruleType === "territory" && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="rule-states">States (comma-separated)</Label>
                    <Input
                      id="rule-states"
                      placeholder="TX, FL"
                      value={(draft.territoryFilter?.states ?? []).join(", ")}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          territoryFilter: {
                            ...(draft.territoryFilter ?? {}),
                            states: e.target.value
                              .split(",")
                              .map((s) => s.trim().toUpperCase())
                              .filter(Boolean),
                          },
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="rule-counties">Counties</Label>
                    <Input
                      id="rule-counties"
                      placeholder="Harris, Travis"
                      value={(draft.territoryFilter?.counties ?? []).join(", ")}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          territoryFilter: {
                            ...(draft.territoryFilter ?? {}),
                            counties: e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          },
                        })
                      }
                    />
                  </div>
                </div>
              )}

              <div>
                <Label>Assignees (weight 1 = one lead per round)</Label>
                <div className="space-y-2 mt-2">
                  {members
                    .filter((m) => m.isActive)
                    .map((m) => {
                      const existing = (draft.weightedAssignees ?? []).find((a) => a.teamMemberId === m.id);
                      return (
                        <div key={m.id} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id={`asg-${m.id}`}
                            checked={!!existing}
                            onChange={(e) => {
                              const list = draft.weightedAssignees ?? [];
                              setDraft({
                                ...draft,
                                weightedAssignees: e.target.checked
                                  ? [...list, { teamMemberId: m.id, weight: 1 }]
                                  : list.filter((a) => a.teamMemberId !== m.id),
                              });
                            }}
                          />
                          <Label htmlFor={`asg-${m.id}`} className="flex-1">
                            {m.displayName || m.email} <span className="text-xs text-muted-foreground">({m.role})</span>
                          </Label>
                          {existing && (
                            <Input
                              type="number"
                              min={1}
                              max={100}
                              value={existing.weight}
                              className="w-20"
                              aria-label={`Weight for ${m.displayName || m.email}`}
                              onChange={(e) => {
                                const w = Math.max(1, parseInt(e.target.value, 10) || 1);
                                setDraft({
                                  ...draft,
                                  weightedAssignees: (draft.weightedAssignees ?? []).map((a) =>
                                    a.teamMemberId === m.id ? { ...a, weight: w } : a,
                                  ),
                                });
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => saveMutation.mutate(draft)}
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? "Saving…" : "Save rule"}
                </Button>
                <Button variant="outline" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4" /> Test with a sample lead
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="test-state">State</Label>
                <Input id="test-state" value={testState} onChange={(e) => setTestState(e.target.value)} placeholder="TX" />
              </div>
              <div>
                <Label htmlFor="test-county">County</Label>
                <Input id="test-county" value={testCounty} onChange={(e) => setTestCounty(e.target.value)} placeholder="Harris" />
              </div>
            </div>
            <Button onClick={handleTest} variant="outline">
              Run test
            </Button>
            {testResult !== undefined && (
              <div className="text-sm">
                {testResult === null ? (
                  <span className="text-muted-foreground">No rule matched. Lead would be left unassigned.</span>
                ) : (
                  <span>
                    Would assign to: <strong>{memberLabel(testResult)}</strong>
                  </span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
