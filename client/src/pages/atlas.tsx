import { PageShell } from "@/components/page-shell";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function AtlasPage() {
  useDocumentTitle("Atlas");
  return (
    <PageShell label="Atlas" maxWidth="7xl">
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        Atlas is coming soon.
      </div>
    </PageShell>
  );
}
