/**
 * ArtifactRenderer — discriminated-union switch on Artifact.type.
 *
 * Renderers for the CORE 9 (text, bucket_chart, mrr_sparkline,
 * cost_mix_pie, org_table, decision_card, trigger_card,
 * confirmation_request, brief_card) are lazy-loaded for code-split.
 *
 * Every other artifact type falls back to <UnknownArtifactType /> with
 * a payload preview. This is deliberate — Phase B's tools may emit any
 * of the ~24 declared artifact types, and Phase C ships only the 9
 * Tom needs first. The rest can land in later phases without breaking
 * the renderer contract.
 */
import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { UnknownArtifactType } from "@/components/founder-chat/artifacts/_unknown";
import type { Artifact } from "@shared/founder-chat/artifacts";

// ── Lazy renderers for the CORE 9 ──────────────────────────────────────
const TextArtifact = lazy(() => import("./artifacts/text"));
const BucketChartArtifact = lazy(() => import("./artifacts/bucket_chart"));
const MrrSparklineArtifact = lazy(() => import("./artifacts/mrr_sparkline"));
const CostMixPieArtifact = lazy(() => import("./artifacts/cost_mix_pie"));
const OrgTableArtifact = lazy(() => import("./artifacts/org_table"));
const DecisionCardArtifact = lazy(() => import("./artifacts/decision_card"));
const TriggerCardArtifact = lazy(() => import("./artifacts/trigger_card"));
const ConfirmationRequestArtifact = lazy(() => import("./artifacts/confirmation_request"));
const BriefCardArtifact = lazy(() => import("./artifacts/brief_card"));
const NavigationArtifact = lazy(() => import("./artifacts/navigation"));

interface ArtifactRendererProps {
  artifact: Artifact;
}

function Fallback() {
  return <Skeleton className="h-16 w-full rounded-md" />;
}

export function ArtifactRenderer({ artifact }: ArtifactRendererProps) {
  // Defensive: if `artifact` itself is malformed, render the unknown
  // card with the raw value so we don't crash the entire MessageList.
  if (!artifact || typeof artifact !== "object" || !("type" in artifact)) {
    return <UnknownArtifactType type="(malformed)" payload={artifact} />;
  }

  return (
    <Suspense fallback={<Fallback />}>
      {renderArtifact(artifact)}
    </Suspense>
  );
}

function renderArtifact(artifact: Artifact): React.ReactNode {
  switch (artifact.type) {
    case "text":
      return <TextArtifact markdown={artifact.markdown} />;
    case "bucket_chart":
      return <BucketChartArtifact data={artifact.data} />;
    case "mrr_sparkline":
      return <MrrSparklineArtifact series={artifact.series} label={artifact.label} />;
    case "cost_mix_pie":
      return (
        <CostMixPieArtifact data={artifact.data} windowDays={artifact.windowDays} />
      );
    case "org_table":
      return <OrgTableArtifact rows={artifact.rows} sortBy={artifact.sortBy} />;
    case "decision_card":
      return (
        <DecisionCardArtifact item={artifact.item} actions={artifact.actions} />
      );
    case "trigger_card":
      return (
        <TriggerCardArtifact trigger={artifact.trigger} actions={artifact.actions} />
      );
    case "confirmation_request":
      return (
        <ConfirmationRequestArtifact
          requestId={artifact.requestId}
          toolCall={artifact.toolCall}
          preview={artifact.preview}
          warning={artifact.warning}
        />
      );
    case "brief_card":
      return (
        <BriefCardArtifact title={artifact.title} sections={artifact.sections} />
      );
    case "navigation":
      return <NavigationArtifact target={artifact.target} label={artifact.label} />;

    // ── Stubs — render placeholder. Phase D/E/G/H/I replace these. ────
    case "dlq_card":
    case "cost_event_card":
    case "provider_card":
    case "agent_card":
    case "infra_status_card":
    case "dial_form":
    case "letter_card":
    case "audit_log_table":
    case "agent_quote":
    case "tool_call_progress":
    case "background_task_card":
    case "attachment_group":
    case "code_diff":
    case "file_view":
    case "pr_summary":
    case "ci_status_card":
    case "query_result_table":
    case "explain_plan":
    case "error_event_card":
    case "log_stream":
    case "secret_paste":
    case "fly_releases_card":
    case "stripe_customer_card":
    case "clerk_user_card":
      return <UnknownArtifactType type={artifact.type} payload={artifact} />;

    default: {
      // Exhaustiveness check — TypeScript will complain if we add a
      // new artifact type to the union and forget to handle it here.
      const _exhaustive: never = artifact;
      return <UnknownArtifactType type="(unhandled)" payload={_exhaustive} />;
    }
  }
}

export default ArtifactRenderer;
