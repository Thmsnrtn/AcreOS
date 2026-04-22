import * as React from "react";
import { cn } from "@/lib/utils";

type PageHeaderProps = Omit<React.HTMLAttributes<HTMLDivElement>, "title"> & {
  /** Title (h1) — required. */
  title: React.ReactNode;
  /** Subtitle / description rendered under the title. */
  description?: React.ReactNode;
  /** Icon rendered to the left of the title. */
  icon?: React.ReactNode;
  /** Right-side actions (buttons, toggles). */
  actions?: React.ReactNode;
  /** Breadcrumb trail rendered above the title. */
  breadcrumbs?: React.ReactNode;
  /** Extra content rendered below description (badges, verdict lines). */
  children?: React.ReactNode;
};

/**
 * Canonical page header block.
 *
 *   <PageHeader
 *     title="Prompt evolutions"
 *     description="Revisions proposed by the monthly meta-agent."
 *     icon={<Brain className="h-5 w-5 text-muted-foreground" />}
 *     actions={<Button>Run now</Button>}
 *   />
 *
 * Replaces the ad-hoc `<Card>` wrappers + nested `<div>`s that every
 * founder page re-implements for its title block. Consistent spacing
 * (6 bottom, 3 internal gap) and wrap behavior on mobile.
 */
export function PageHeader({
  title,
  description,
  icon,
  actions,
  breadcrumbs,
  children,
  className,
  ...rest
}: PageHeaderProps) {
  return (
    <div className={cn("mb-6", className)} {...rest}>
      {breadcrumbs && <div className="mb-2">{breadcrumbs}</div>}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            {icon}
            <span className="truncate">{title}</span>
          </h1>
          {description && (
            <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
              {description}
            </p>
          )}
          {children && <div className="mt-3">{children}</div>}
        </div>
        {actions && (
          <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>
        )}
      </div>
    </div>
  );
}
