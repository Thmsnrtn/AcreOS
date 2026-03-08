import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Construction } from "lucide-react";

export default function BetaDashboardPage() {
  return (
    <PageShell>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Construction className="w-5 h-5" /> Beta Dashboard</CardTitle></CardHeader>
        <CardContent><p className="text-muted-foreground">Beta dashboard — coming soon.</p></CardContent>
      </Card>
    </PageShell>
  );
}
