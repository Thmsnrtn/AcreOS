import { useQuery } from "@tanstack/react-query"
import { generationProgressLabels, type projectGenerationJob } from "@shared/cmo/generationProgress"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { QueryErrorState } from "@/components/query-error-state"
import { Skeleton } from "@/components/ui/skeleton"
import { PrefetchLink as Link } from "@/components/prefetch-link"
import { apiRequest } from "@/lib/queryClient"
import { formatDateTime, usd } from "@/lib/format"

type Job = ReturnType<typeof projectGenerationJob>
const blockedReasons: Record<string, string> = {
  auto_generation_disabled: "Automatic generation is disabled.",
  daily_budget_exceeded: "The daily generation budget blocked this attempt.",
  operating_budget_unavailable: "The operating budget was unavailable.",
}

/** A worker receipt is evidence of that attempt, not publication or a complete billing ledger. */
export function GrowthGenerationReceipt({ jobId }: { jobId: string }) {
  const valid = /^[1-9]\d*$/.test(jobId) && Number.isSafeInteger(Number(jobId)) && Number(jobId) <= 2147483647
  const query = useQuery<Job>({
    queryKey: ["/api/founder/cmo/generation-jobs", jobId],
    enabled: valid,
    retry: false,
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/founder/cmo/generation-jobs/${jobId}`)
      const { job } = await response.json() as { job?: Job }
      if (!job || job.id !== Number(jobId)) throw new Error("Generation record identity could not be verified")
      return job
    },
  })
  const job = query.isSuccess ? query.data : undefined
  return (
    <Card aria-label="Generation request record">
      <CardHeader><CardTitle>Generation request #{jobId}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {!valid ? <p>Invalid generation request identity.</p> : query.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : query.isError ? (
          <QueryErrorState error={query.error} title="Generation record unavailable" onRetry={() => void query.refetch()} isRetrying={query.isFetching} />
        ) : job ? (
          <>
            <p className="break-words font-medium">{job.intent}</p>
            <p className="text-sm text-muted-foreground">Requested: {formatDateTime(job.createdAt)}</p>
            <p>{generationProgressLabels[job.state] ?? generationProgressLabels.unknown}</p>
            <p>Render jobs processed: {job.renderJobs.processed}/{job.renderJobs.expected ?? "unknown"}. Failed render jobs: {job.renderJobs.failed}.</p>
            <p>Last completed generation/scoring attempt cost: {typeof job.receipt?.totalCostCents === "number" ? usd(job.receipt.totalCostCents / 100) : "Unavailable"}. Rendering costs are separate.</p>
            {typeof job.receipt?.blockedBy === "string" && <p>{blockedReasons[job.receipt.blockedBy]}</p>}
            {(job.state === "failed" || job.state === "partially_completed") && <p>The worker did not record a failure explanation in this receipt. Check the operational logs before retrying.</p>}
            <p className="text-sm text-muted-foreground">This record does not verify delivery or total charges across attempts. Missing cost information does not mean zero cost.</p>
            {job.reviewIds.length > 0 && <Link href="/founder/cmo" className="underline underline-offset-4">Review videos</Link>}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
