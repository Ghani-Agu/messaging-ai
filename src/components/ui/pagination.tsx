"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { getPageWindow } from "@/lib/pagination";

/**
 * Pagination primitive.
 *
 * Server-driven: the URL's `?page=N` query param is the source of truth;
 * each page number link navigates to a new URL via Next's `<Link>` and the
 * server fetches the matching slice. The component is otherwise stateless.
 *
 * Pure math helpers (`parsePageParam`, `clampPage`, `getPageWindow`) live in
 * `@/lib/pagination` so they can be unit-tested without dragging next/link's
 * React-context dependency into the test environment.
 */

// Re-export the pure helpers so callers have a single import surface.
export {
  parsePageParam,
  clampPage,
  getPageWindow,
  type PageWindowEntry,
} from "@/lib/pagination";

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export interface PaginationProps extends HTMLAttributes<HTMLDivElement> {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  /** URL builder — caller controls path + extra query params. */
  pageHref: (page: number) => string;
  /** Singular label for the count line ("item"). Defaults to "item". */
  itemLabel?: string;
  /** Plural label for the count line ("items"). Defaults to `${itemLabel}s`. */
  itemLabelPlural?: string;
}

export const Pagination = forwardRef<HTMLDivElement, PaginationProps>(
  (
    {
      currentPage,
      totalPages,
      totalCount,
      pageSize,
      pageHref,
      itemLabel = "item",
      itemLabelPlural,
      className,
      ...props
    },
    ref,
  ) => {
    const pluralLabel = itemLabelPlural ?? `${itemLabel}s`;
    const safeTotalPages = Math.max(1, totalPages);
    const page = Math.max(1, Math.min(currentPage, safeTotalPages));
    const window = getPageWindow(page, safeTotalPages);

    const firstRow = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
    const lastRow = Math.min(page * pageSize, totalCount);

    const prevPage = page > 1 ? page - 1 : null;
    const nextPage = page < safeTotalPages ? page + 1 : null;

    const summary =
      totalCount === 0
        ? `No ${pluralLabel}`
        : `Showing ${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${totalCount.toLocaleString()} ${
            totalCount === 1 ? itemLabel : pluralLabel
          }`;

    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col items-center gap-3 pt-4 sm:flex-row sm:justify-between",
          className,
        )}
        {...props}
      >
        <p className="text-caption text-[var(--text-tertiary)]">{summary}</p>
        <nav aria-label="Pagination">
          <ul className="flex items-center gap-1">
            <li>
              <PageLink
                href={prevPage !== null ? pageHref(prevPage) : null}
                ariaLabel="Previous page"
                disabled={prevPage === null}
              >
                <ChevronLeft className="size-3.5" aria-hidden />
                <span className="sr-only sm:not-sr-only sm:ml-1">Prev</span>
              </PageLink>
            </li>
            {window.map((entry) => (
              <li key={typeof entry === "number" ? `p-${entry}` : entry}>
                {entry === "ellipsis-left" || entry === "ellipsis-right" ? (
                  <span
                    aria-hidden
                    className="inline-flex size-8 items-center justify-center text-caption text-[var(--text-tertiary)]"
                  >
                    …
                  </span>
                ) : (
                  <PageNumber
                    page={entry}
                    href={pageHref(entry)}
                    isCurrent={entry === page}
                  />
                )}
              </li>
            ))}
            <li>
              <PageLink
                href={nextPage !== null ? pageHref(nextPage) : null}
                ariaLabel="Next page"
                disabled={nextPage === null}
              >
                <span className="sr-only sm:not-sr-only sm:mr-1">Next</span>
                <ChevronRight className="size-3.5" aria-hidden />
              </PageLink>
            </li>
          </ul>
        </nav>
      </div>
    );
  },
);
Pagination.displayName = "Pagination";

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────────────

const baseButtonClasses = cn(
  "inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-caption font-medium",
  "transition-colors duration-150 ease-out motion-reduce:transition-none",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]",
);

function PageLink({
  href,
  ariaLabel,
  disabled,
  children,
}: {
  href: string | null;
  ariaLabel: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled || href === null) {
    return (
      <span
        aria-disabled="true"
        aria-label={ariaLabel}
        className={cn(
          baseButtonClasses,
          "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-tertiary)] opacity-50",
        )}
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={cn(
        baseButtonClasses,
        "border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)]",
        "hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-elevated)] hover:text-[var(--text-primary)]",
      )}
    >
      {children}
    </Link>
  );
}

function PageNumber({
  page,
  href,
  isCurrent,
}: {
  page: number;
  href: string;
  isCurrent: boolean;
}) {
  if (isCurrent) {
    return (
      <span
        aria-current="page"
        aria-label={`Page ${page}`}
        className={cn(
          baseButtonClasses,
          "border-[var(--accent-base)] bg-[var(--accent-base)]/10 text-[var(--text-primary)]",
        )}
      >
        {page.toLocaleString()}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={`Go to page ${page}`}
      className={cn(
        baseButtonClasses,
        "border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)]",
        "hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-elevated)] hover:text-[var(--text-primary)]",
      )}
    >
      {page.toLocaleString()}
    </Link>
  );
}
