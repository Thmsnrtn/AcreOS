/**
 * brief_card artifact — multi-section morning brief.
 *
 * Each section has a title + an array of embedded artifacts; we
 * delegate rendering of each inner artifact back to ArtifactRenderer so
 * the brief composes the existing renderers (it's "just" a layout
 * wrapper). The /founder shell renders the brief as the first
 * assistant message of the day starting in Phase E.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sun } from "lucide-react";
import { ArtifactRenderer } from "@/components/founder-chat/ArtifactRenderer";
import type { BriefSection } from "@shared/founder-chat/artifacts";

interface BriefCardProps {
  title?: string;
  sections: BriefSection[];
}

export function BriefCardArtifact({ title, sections }: BriefCardProps) {
  return (
    <Card
      className="border-acr-brand/30 bg-gradient-to-br from-acr-brand-soft/30 to-transparent"
      data-testid="artifact-brief-card"
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Sun className="w-4 h-4 text-acr-warn" aria-hidden="true" />
          {title ?? "Morning brief"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {(sections ?? []).map((section, idx) => (
          <section key={idx} aria-label={section.title} className="space-y-2">
            <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {section.title}
            </h5>
            <div className="space-y-2">
              {(section.artifacts ?? []).map((art, j) => (
                <ArtifactRenderer key={j} artifact={art} />
              ))}
            </div>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

export default BriefCardArtifact;
