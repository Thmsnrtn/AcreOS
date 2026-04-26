/**
 * Shared chassis for Phase 8 coverage pages — 404, 500, forbidden,
 * maintenance, and any future error/empty meta-pages.
 *
 * Per HANDOFF §8 (state voice): "specific, attributes blame correctly,
 * doesn't say 'Something went wrong.'"
 *
 * Homestead palette via inline tokens so this works whether the route
 * is mounted inside the auth shell (sidebar bg) or unauth (cream bg).
 *
 * Voice notes per page below.
 */
import * as React from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Compass,
  Home,
  LifeBuoy,
  ServerCrash,
  Lock,
  Wrench,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface CoveragePageProps {
  /** Tone-setting icon, large + brand-bg */
  icon: LucideIcon;
  /** Short eyebrow above title (e.g. "404 · Lost the trail") */
  eyebrow: string;
  /** One-line italic Fraunces title */
  title: string;
  /** Short paragraph — specific, voice-y, no "something went wrong" */
  description: React.ReactNode;
  /** Primary CTA */
  primaryAction: { href?: string; label: string; onClick?: () => void; icon?: LucideIcon };
  /** Optional secondary CTA */
  secondaryAction?: { href?: string; label: string; onClick?: () => void; icon?: LucideIcon };
  /** For document title */
  pageTitle: string;
  /** test id */
  testId?: string;
}

export function CoveragePage({
  icon: Icon,
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryAction,
  pageTitle,
  testId = "coverage-page",
}: CoveragePageProps) {
  useDocumentTitle(pageTitle);
  const PrimaryIcon = primaryAction.icon;
  const SecondaryIcon = secondaryAction?.icon;
  return (
    <div
      className="min-h-screen w-full flex items-center justify-center px-4 py-16"
      style={{ background: "var(--acr-bg)" }}
      data-testid={testId}
    >
      <div className="w-full max-w-md text-center space-y-6">
        <div
          className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center"
          style={{ background: "var(--acr-brand)", color: "var(--acr-brand-ink)" }}
          aria-hidden="true"
        >
          <Icon className="h-8 w-8" />
        </div>

        <div className="space-y-3">
          <div
            style={{
              font: "600 11px/1 var(--font-sans)",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--acr-ink-3)",
            }}
          >
            {eyebrow}
          </div>
          <h1
            style={{
              fontFamily: "Fraunces, 'Times New Roman', serif",
              fontWeight: 400,
              fontSize: "36px",
              lineHeight: 1.1,
              fontStyle: "italic",
              letterSpacing: "-0.025em",
              color: "var(--acr-ink)",
              textWrap: "balance",
              margin: 0,
            }}
            data-testid={`${testId}-title`}
          >
            {title}
          </h1>
          <div
            className="text-sm sm:text-base max-w-sm mx-auto"
            style={{ color: "var(--acr-ink-2)", lineHeight: 1.55 }}
          >
            {description}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
          {primaryAction.href ? (
            <Button asChild data-testid={`${testId}-primary`}>
              <Link href={primaryAction.href}>
                {PrimaryIcon && <PrimaryIcon className="w-4 h-4 mr-2" aria-hidden="true" />}
                {primaryAction.label}
              </Link>
            </Button>
          ) : (
            <Button onClick={primaryAction.onClick} data-testid={`${testId}-primary`}>
              {PrimaryIcon && <PrimaryIcon className="w-4 h-4 mr-2" aria-hidden="true" />}
              {primaryAction.label}
            </Button>
          )}
          {secondaryAction &&
            (secondaryAction.href ? (
              <Button variant="ghost" asChild data-testid={`${testId}-secondary`}>
                <Link href={secondaryAction.href}>
                  {SecondaryIcon && (
                    <SecondaryIcon className="w-4 h-4 mr-2" aria-hidden="true" />
                  )}
                  {secondaryAction.label}
                </Link>
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={secondaryAction.onClick}
                data-testid={`${testId}-secondary`}
              >
                {SecondaryIcon && (
                  <SecondaryIcon className="w-4 h-4 mr-2" aria-hidden="true" />
                )}
                {secondaryAction.label}
              </Button>
            ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── concrete pages

export function NotFoundPage() {
  return (
    <CoveragePage
      icon={Compass}
      eyebrow="404 · lost the trail"
      title="This page wandered off."
      description={
        <>
          The page you're looking for doesn't exist, has moved, or the link
          is out of date. No harm done — pick where to head next.
        </>
      }
      primaryAction={{ href: "/today", label: "Back to AcreOS", icon: Home }}
      secondaryAction={{ href: "/help", label: "Get help", icon: LifeBuoy }}
      pageTitle="Page not found"
      testId="page-not-found"
    />
  );
}

export function ServerErrorPage({
  onRetry,
}: {
  onRetry?: () => void;
}) {
  return (
    <CoveragePage
      icon={ServerCrash}
      eyebrow="500 · we hit a wall"
      title="AcreOS hit a snag on our end."
      description={
        <>
          Not your fault. Our servers got tripped up loading this. Most retries
          succeed within a few seconds — try again, or come back to the home
          screen.
        </>
      }
      primaryAction={
        onRetry
          ? { label: "Try again", icon: RefreshCw, onClick: onRetry }
          : { href: "/today", label: "Back to AcreOS", icon: Home }
      }
      secondaryAction={
        onRetry
          ? { href: "/today", label: "Back to AcreOS", icon: Home }
          : { href: "/help", label: "Get help", icon: LifeBuoy }
      }
      pageTitle="Server error"
      testId="page-server-error"
    />
  );
}

export function ForbiddenPage() {
  return (
    <CoveragePage
      icon={Lock}
      eyebrow="403 · not your patch"
      title="You don't have access to this."
      description={
        <>
          The owner of this workspace hasn't given you access to this page,
          or your role doesn't include it. Ask your team lead, or head back
          where you came from.
        </>
      }
      primaryAction={{ href: "/today", label: "Back to AcreOS", icon: Home }}
      secondaryAction={{ href: "/help", label: "Get help", icon: LifeBuoy }}
      pageTitle="Access denied"
      testId="page-forbidden"
    />
  );
}

export function MaintenancePage() {
  return (
    <CoveragePage
      icon={Wrench}
      eyebrow="brief pause"
      title="AcreOS is doing a quick tune-up."
      description={
        <>
          We're shipping an upgrade. Should be back in a few minutes. Your
          data is safe — Sophie is still watching the notes, Atlas is still
          watching the parcels. Just the front door is closed.
        </>
      }
      primaryAction={{
        label: "Check again",
        icon: RefreshCw,
        onClick: () => window.location.reload(),
      }}
      pageTitle="Maintenance"
      testId="page-maintenance"
    />
  );
}
