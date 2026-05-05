import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Drop the HTML `title` attribute so the prop carries our ReactNode title
// instead. We never set the native attribute on a <header> in this app.
export interface PageHeaderProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** Optional eyebrow above the title — usually an <Eyebrow> instance. */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Optional supporting paragraph below the title. */
  description?: ReactNode;
  /** Right-aligned action slot (buttons, status pills, etc.). */
  actions?: ReactNode;
}

/**
 * Standard page-level header. Replaces every page's inline `<header>` block.
 * Title is text-h1 by default; description (when present) is text-body
 * text-secondary capped at max-w-prose for line-length comfort.
 */
export const PageHeader = forwardRef<HTMLElement, PageHeaderProps>(
  (
    { className, eyebrow, title, description, actions, ...props },
    ref,
  ) => (
    <header
      ref={ref}
      className={cn(
        "mb-8 flex flex-wrap items-start justify-between gap-6",
        className,
      )}
      {...props}
    >
      <div className="min-w-0 flex-1">
        {eyebrow ? <div className="mb-2">{eyebrow}</div> : null}
        <h1 className="text-h1 text-[var(--text-primary)]">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-prose text-body text-[var(--text-secondary)]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </header>
  ),
);
PageHeader.displayName = "PageHeader";
