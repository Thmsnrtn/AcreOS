/**
 * Placeholder renderer for artifact types not yet implemented in Phase C.
 *
 * Phase D/E/G/H/I will replace specific stubs with real renderers; for
 * now we render a small warning card so the chat doesn't crash when a
 * backend tool emits an unknown shape.
 */
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HelpCircle } from "lucide-react";

interface UnknownArtifactTypeProps {
  type: string;
  payload?: unknown;
}

export function UnknownArtifactType({ type, payload }: UnknownArtifactTypeProps) {
  return (
    <Card
      className="border-dashed border-acr-warn/40 bg-acr-warn-soft/10"
      data-testid={`artifact-unknown-${type}`}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <HelpCircle className="w-3.5 h-3.5 text-acr-warn" aria-hidden="true" />
          <span className="font-medium">Unknown artifact type</span>
          <Badge variant="secondary" className="font-mono text-[10px]">
            {type}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          This artifact will render properly in a future phase.
        </p>
        {payload !== undefined && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Show payload
            </summary>
            <pre className="mt-1 p-2 rounded bg-muted overflow-x-auto text-[10px] font-mono leading-snug max-h-48">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

export default UnknownArtifactType;
