import type { projectGenerationJob } from "@shared/cmo/generationProgress"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Megaphone } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState } from "@/components/empty-state"
import { QueryErrorState } from "@/components/query-error-state"
import { PrefetchLink as Link } from "@/components/prefetch-link"
import { apiRequest } from "@/lib/queryClient"
import { usd } from "@/lib/format"
import { useToast } from "@/hooks/use-toast"

interface BrandPlan {
  id: number
  oneLiner: string
  audiencePrimary: string
  updatedAt?: string
}
interface GrowthDashboard {
  brandProfile?: BrandPlan | null
  pending: Array<{
    inboxItem: {
      id: number
      recommendedActionLabel: string
      contextBundle?: { scriptHook?: string } | null
    }
  }>
  budget: { dailyCapCents: number; spendTodayCents: number } | null
}
interface GrowthWorkspaceProps {
  conversions?: { totalSignups: number; byPlay: Array<{ playId: string; signups: number }> } | null
  budget?: { effectiveCapUsd: number; baseCapUsd: number } | null
  publishEnabled: boolean
  isSettingPending: boolean
  onPublishChange: (enabled: boolean) => void
  onRefresh: () => void
  isRefreshing: boolean
}
const JOBS_KEY = ["/api/founder/cmo/generation-jobs"]
const DASHBOARD_KEY = ["/api/founder/cmo/dashboard"]

/** A workspace inside Controls; existing queues remain the approval authority. */
export function GrowthWorkspace(props: GrowthWorkspaceProps) {
  const [tab, setTab] = useState("plan")
  const dashboard = useQuery<GrowthDashboard>({
    queryKey: DASHBOARD_KEY,
    queryFn: async () => (await apiRequest("GET", DASHBOARD_KEY[0])).json(),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
  const profile = dashboard.data?.brandProfile

  return (
    <Card id="growth" className="scroll-mt-6" data-testid="growth-workspace">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Growth workspace</CardTitle>
          <Badge variant="secondary">Native · first version</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Set the audience, request video drafts, review the work, and see what brings signups.
        </p>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4 grid w-full grid-cols-4" aria-label="Growth workflow">
            <TabsTrigger value="plan">Plan</TabsTrigger>
            <TabsTrigger value="review">Review</TabsTrigger>
            <TabsTrigger value="results">Results</TabsTrigger>
            <TabsTrigger value="steer">Steer</TabsTrigger>
          </TabsList>
          <TabsContent value="plan" className="space-y-6">
            {dashboard.isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : dashboard.isError ? (
              <QueryErrorState
                error={dashboard.error}
                title="Growth plan unavailable"
                onRetry={() => void dashboard.refetch()}
                isRetrying={dashboard.isFetching}
              />
            ) : (
              <>
                {profile ? (
                  <BrandPlanForm key={`${profile.id}:${profile.updatedAt}`} profile={profile} />
                ) : (
                  <EmptyState
                    icon={Megaphone}
                    headline="Start with your first draft"
                    subtitle="The generation worker will initialize the AcreOS brand profile. Once it is available, you can edit your audience and positioning here."
                    cta={{
                      label: "Write a brief",
                      onClick: () => document.getElementById("growth-intent")?.focus(),
                    }}
                  />
                )}
                <DraftRequestForm />
              </>
            )}
            <GenerationProgress />
          </TabsContent>
          <TabsContent value="review" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Review video bundles in the ad engine. Decisions remains the company-wide approval
              queue. Queuing a draft does not publish it.
            </p>
            {dashboard.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : dashboard.isError ? (
              <QueryErrorState
                error={dashboard.error}
                title="Review queue unavailable"
                description="We couldn't read the queue. This does not mean it is empty."
                onRetry={() => void dashboard.refetch()}
                isRetrying={dashboard.isFetching}
              />
            ) : dashboard.data?.pending.length ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {dashboard.data.pending.length} recent bundles awaiting review
                </p>
                <p className="text-xs text-muted-foreground">
                  Showing up to 20 recent bundles; this is not the full queue count.
                </p>
                <ul className="space-y-2">
                  {dashboard.data.pending.map(({ inboxItem }) => (
                    <li key={inboxItem.id}>
                      <Link
                        href="/founder/cmo"
                        className="block rounded-lg border p-3 text-sm underline-offset-4 hover:underline"
                      >
                        {inboxItem.contextBundle?.scriptHook ||
                          inboxItem.recommendedActionLabel ||
                          "Video bundle"}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <EmptyState
                icon={Megaphone}
                headline="No recent video bundles awaiting review"
                subtitle="Request a draft from Plan. It will appear after generation finishes; an accepted request is not a finished asset."
                cta={{ label: "Plan a draft", onClick: () => setTab("plan") }}
              />
            )}
            <div className="flex flex-wrap gap-4 text-sm">
              <Link href="/founder/cmo" className="underline underline-offset-4">
                Open video review
              </Link>
              <Link href="/founder/decisions" className="underline underline-offset-4">
                Open Decisions
              </Link>
            </div>
          </TabsContent>
          <TabsContent value="results" className="space-y-4">
            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium">
                Signups attributed to autopilot content · all time
              </p>
              <p className="my-2 text-3xl font-semibold tabular-nums">
                {props.conversions == null ? "Unavailable" : props.conversions.totalSignups}
              </p>
              <p className="text-sm text-muted-foreground">
                {props.conversions == null
                  ? "The attribution source could not be read. Retry Controls to reload it."
                  : "A lower bound from recorded content touches. This is not all acquisition, and does not establish paid-ad performance."}
              </p>
              {props.conversions == null && (
                <Button
                  variant="outline"
                  className="mt-3"
                  onClick={props.onRefresh}
                  disabled={props.isRefreshing}
                >
                  {props.isRefreshing ? "Reloading…" : "Reload Controls"}
                </Button>
              )}
            </div>
            {!!props.conversions?.byPlay.length && (
              <table className="w-full text-sm">
                <caption className="mb-2 text-left text-muted-foreground">
                  Attributed signups by play
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="py-2 text-left">
                      Play
                    </th>
                    <th scope="col" className="py-2 text-right">
                      Signups
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {props.conversions.byPlay.map((play) => (
                    <tr key={play.playId} className="border-t">
                      <td className="py-2 break-all">{play.playId}</td>
                      <td className="py-2 text-right tabular-nums">{play.signups}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-sm text-muted-foreground">
              Activation, paid conversion, retention, and confirmed social delivery are not
              connected to this workspace yet. No performance recommendation is inferred from
              missing data.
            </p>
            <Link href="/founder/autopilot/story" className="text-sm underline underline-offset-4">
              Inspect the action trail in Story
            </Link>
          </TabsContent>
          <TabsContent value="steer" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
              <div>
                <p className="text-sm font-medium">
                  Autopilot publishing: {props.publishEnabled ? "enabled" : "paused"}
                </p>
                <p className="text-sm text-muted-foreground">
                  Pausing blocks queued video uploads and new ad creation. It does not pause ads already created or scheduled externally. Video approvals remain required; draft generation can continue while publishing is paused.
                </p>
              </div>
              <Button
                variant="outline"
                disabled={props.isSettingPending}
                onClick={() => props.onPublishChange(!props.publishEnabled)}
              >
                {props.isSettingPending
                  ? "Saving…"
                  : props.publishEnabled
                    ? "Pause publishing"
                    : "Enable publishing"}
              </Button>
            </div>
            <div className="rounded-lg border p-4 text-sm space-y-2">
              <p>
                Autopilot monthly growth cap:{" "}
                {props.budget ? usd(props.budget.effectiveCapUsd) : "Unavailable"}
              </p>
              <p>
                Video engine daily cap:{" "}
                {dashboard.isError || !dashboard.data?.budget
                  ? "Unavailable"
                  : usd(dashboard.data.budget.dailyCapCents / 100)}
              </p>
              <p className="text-muted-foreground">
                These are separate budget envelopes. Requesting drafts can consume generation
                budget; approvals do not establish that an ad is delivering.
              </p>
            </div>
            <Link href="/founder/autopilot/voice" className="text-sm underline underline-offset-4">
              Set standing orders and objectives in Your voice
            </Link>
            <p className="text-sm text-muted-foreground">
              Trust levels, budget reset, and emergency stop remain in Controls below.
            </p>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

function BrandPlanForm({ profile }: { profile: BrandPlan }) {
  const [oneLiner, setOneLiner] = useState(profile.oneLiner)
  const [audience, setAudience] = useState(profile.audiencePrimary)
  const qc = useQueryClient()
  const { toast } = useToast()
  const save = useMutation({
    mutationFn: async () =>
      apiRequest("PATCH", "/api/founder/cmo/brand-profile", {
        id: profile.id,
        oneLiner: oneLiner.trim(),
        audiencePrimary: audience.trim(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: DASHBOARD_KEY })
      void qc.invalidateQueries({ queryKey: ["/api/founder/cmo/brand-profile"] })
      toast({
        title: "Growth plan saved",
        description: "The video engine will use this positioning and audience for future drafts.",
      })
    },
  })
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <h3 className="font-medium">Audience and positioning</h3>
      <p className="text-sm text-muted-foreground">
        Save changes before requesting drafts. Generation uses the saved brand profile.
      </p>
      <div className="space-y-2">
        <Label htmlFor="growth-positioning">AcreOS in one line</Label>
        <Input
          id="growth-positioning"
          value={oneLiner}
          onChange={(event) => setOneLiner(event.target.value)}
          required
          maxLength={1000}
          disabled={save.isPending}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="growth-audience">Primary audience</Label>
        <Textarea
          id="growth-audience"
          value={audience}
          onChange={(event) => setAudience(event.target.value)}
          required
          maxLength={4000}
          disabled={save.isPending}
        />
      </div>
      {save.isError && (
        <p role="alert" className="text-sm text-destructive">
          Save confirmation is unavailable. Check the persisted plan before requesting drafts. {save.error.message}
        </p>
      )}
      <Button
        type="submit"
        disabled={
          save.isPending ||
          !oneLiner.trim() ||
          !audience.trim() ||
          (oneLiner === profile.oneLiner && audience === profile.audiencePrimary)
        }
      >
        {save.isPending ? "Saving…" : "Save plan"}
      </Button>
    </form>
  )
}

function DraftRequestForm() {
  const qc = useQueryClient()
  const [intent, setIntent] = useState("")
  const [notes, setNotes] = useState("")
  const [count, setCount] = useState(1)
  const [stage, setStage] = useState("cold")
  const generate = useMutation<{ ok: boolean; outboxId: number }>({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/founder/cmo/generate", {
          intent: intent.trim(),
          count,
          funnelStage: stage,
          notes: notes.trim(),
        })
      ).json(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: DASHBOARD_KEY })
      void qc.invalidateQueries({ queryKey: JOBS_KEY })
    },
  })
  return (
    <form
      className="space-y-3 border-t pt-5"
      onSubmit={(event) => {
        event.preventDefault()
        generate.mutate()
      }}
    >
      <h3 className="font-medium">Request video drafts</h3>
      <p className="text-sm text-muted-foreground">
        Choose a specific angle or customer problem. Generation can incur provider costs within the
        engine's operating budget. A reached daily cap blocks new requests; concurrent work can
        still exceed it until spend reservations are implemented.
      </p>
      <div className="space-y-2">
        <Label htmlFor="growth-intent">Draft brief</Label>
        <Textarea
          id="growth-intent"
          placeholder="Show how a land investor can evaluate a parcel before making an offer."
          value={intent}
          onChange={(event) => setIntent(event.target.value)}
          required
          maxLength={2000}
          disabled={generate.isPending}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="growth-stage">Audience stage</Label>
          <select
            id="growth-stage"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={stage}
            onChange={(event) => setStage(event.target.value)}
            disabled={generate.isPending}
          >
            <option value="cold">New audience</option>
            <option value="warm">Already familiar</option>
            <option value="retargeting">Retargeting</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="growth-count">Number of drafts</Label>
          <select
            id="growth-count"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
            disabled={generate.isPending}
          >
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="growth-notes">Additional direction (optional)</Label>
        <Textarea
          id="growth-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={4000}
          disabled={generate.isPending}
        />
      </div>
      {generate.isError && (
        <p role="alert" className="text-sm text-destructive">
          Acceptance could not be confirmed. Check recent generation requests before submitting again. {generate.error.message}
        </p>
      )}
      {generate.isSuccess && (
        <p role="status" className="text-sm">
          Request {generate.data.outboxId} accepted. Generation is queued; completion and delivery
          are not yet confirmed. Check Review for finished bundles.
        </p>
      )}
      <Button type="submit" disabled={generate.isPending || !intent.trim()}>
        {generate.isPending ? "Queuing…" : "Queue video drafts"}
      </Button>
    </form>
  )
}

const progressLabels: Record<string, string> = {
  queued: "Queued",
  running: "Generating",
  rendering: "Rendering",
  render_queued: "Render queued",
  failed: "Failed — open Story before retrying",
  blocked: "Blocked by operating settings or daily budget",
  partially_completed: "Some render jobs finished; others failed",
  progress_unavailable: "Some job records are unavailable",
  no_render_qualified: "No script qualified for rendering",
  review_created: "Review item created — inspect the videos before choosing destinations",
  render_processed: "Render worker finished; review status unverified",
  legacy_unverified: "Older job — completion details unavailable",
  unknown: "Progress unavailable",
}
function GenerationProgress() {
  const jobs = useQuery<{ jobs: ReturnType<typeof projectGenerationJob>[] }>({
    queryKey: JOBS_KEY,
    queryFn: async () => (await apiRequest("GET", JOBS_KEY[0])).json(),
    refetchInterval: 15_000,
  })
  return (
    <section className="space-y-3 border-t pt-4" aria-label="Recent generation requests">
      <h3 className="font-medium">Recent generation requests</h3>
      <p className="text-xs text-muted-foreground">
        Up to 20 recent requests. Progress is retained by the worker across reloads; it does not
        confirm publication.
      </p>
      {jobs.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : jobs.isError ? (
        <QueryErrorState
          error={jobs.error}
          title="Generation progress unavailable"
          onRetry={() => void jobs.refetch()}
          isRetrying={jobs.isFetching}
        />
      ) : !jobs.data?.jobs?.length ? (
        <p className="text-sm text-muted-foreground">No recent generation requests recorded.</p>
      ) : (
        <ul className="space-y-2">
          {jobs.data.jobs.map((job) => (
            <li key={job.id} className="space-y-1 rounded-lg border p-3 text-sm">
              <p className="font-medium break-words">
                #{job.id} · {job.intent}
              </p>
              <p>{progressLabels[job.state] ?? progressLabels.unknown}</p>
              {job.receipt && (
                <p className="text-xs text-muted-foreground">
                  Scripts in last attempt: {job.receipt.scriptsGenerated ?? "unknown"} · Render jobs processed:{" "}
                  {job.renderJobs.processed}/{job.renderJobs.expected ?? "unknown"} ·
                  Last completed generation/scoring attempt cost:{" "}
                  {typeof job.receipt.totalCostCents === "number"
                    ? usd(job.receipt.totalCostCents / 100)
                    : "unavailable"}
                  . Rendering costs are separate.
                </p>
              )}
              <Link
                href={job.reviewIds.length ? "/founder/cmo" : "/founder/autopilot/story"}
                className="underline underline-offset-4"
              >
                {job.reviewIds.length ? "Review videos" : "Open Story"}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
