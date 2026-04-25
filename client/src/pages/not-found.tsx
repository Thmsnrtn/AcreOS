import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Compass, Home, LifeBuoy } from "lucide-react";
import { Link } from "wouter";
import { useDocumentTitle } from "@/hooks/use-document-title";

/**
 * 404. Not an error the user caused — a dead link.  Intentionally warm:
 * muted icon (not destructive red), a clear primary action back home,
 * and a quiet secondary link to help so the user isn't dead-ended.
 */
export default function NotFound() {
  useDocumentTitle("Page not found");
  return (
    <div
      className="min-h-screen w-full flex items-center justify-center bg-background px-4"
      data-testid="page-not-found"
    >
      <Card className="w-full max-w-md">
        <CardContent className="pt-8 pb-6 text-center space-y-5">
          <div className="mx-auto p-3 rounded-full bg-muted w-fit" aria-hidden="true">
            <Compass className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <h1
              className="text-2xl font-semibold text-foreground"
              data-testid="text-not-found-title"
            >
              This page wandered off
            </h1>
            <p className="text-sm text-muted-foreground">
              The page you're looking for doesn't exist, has moved, or the link is out of date.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
            <Button asChild data-testid="button-go-home">
              <Link href="/today">
                <Home className="w-4 h-4 mr-2" aria-hidden="true" />
                Back to AcreOS
              </Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/help">
                <LifeBuoy className="w-4 h-4 mr-2" aria-hidden="true" />
                Get help
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
