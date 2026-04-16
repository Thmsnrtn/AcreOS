import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

interface ChangelogEntry {
  version: string;
  date: string;
  sections: { title: string; items: string[] }[];
}

const SECTION_COLORS: Record<string, string> = {
  Added: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  Changed: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  Fixed: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  Removed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  Security: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

export default function ChangelogPage() {
  const { data, isLoading } = useQuery<{ entries: ChangelogEntry[] }>({
    queryKey: ["/api/changelog"],
    staleTime: 1000 * 60 * 60,
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-6 py-16">
        <div className="mb-8">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to AcreOS
            </Link>
          </Button>
        </div>

        <div className="mb-12">
          <h1 className="text-3xl font-bold mb-2">What's New</h1>
          <p className="text-muted-foreground">Latest updates and improvements to AcreOS.</p>
        </div>

        {isLoading ? (
          <div className="text-center text-muted-foreground py-12">Loading changelog...</div>
        ) : (
          <div className="space-y-8">
            {data?.entries.map((entry) => (
              <Card key={entry.version}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3 mb-4">
                    <Badge variant="outline" className="text-sm font-mono">v{entry.version}</Badge>
                    {entry.date && <span className="text-sm text-muted-foreground">{entry.date}</span>}
                  </div>
                  {entry.sections.map((section) => (
                    <div key={section.title} className="mb-4 last:mb-0">
                      <Badge className={`mb-2 ${SECTION_COLORS[section.title] || "bg-gray-100 text-gray-800"}`}>
                        {section.title}
                      </Badge>
                      <ul className="space-y-1.5 ml-1">
                        {section.items.map((item, i) => (
                          <li key={i} className="text-sm text-muted-foreground flex gap-2">
                            <span className="text-muted-foreground/50 shrink-0">-</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
            {(!data?.entries || data.entries.length === 0) && (
              <div className="text-center text-muted-foreground py-12">No changelog entries found.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
