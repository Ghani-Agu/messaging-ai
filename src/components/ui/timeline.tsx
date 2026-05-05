import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Eyebrow } from "./eyebrow";

const dotVariants = cva(
  "absolute left-0 top-1.5 size-3 -translate-x-1/2 rounded-full border-2",
  {
    variants: {
      variant: {
        default:
          "border-[var(--accent-base)] bg-[var(--bg-base)] shadow-[0_0_8px_var(--accent-glow)]",
        muted: "border-[var(--border-strong)] bg-[var(--bg-base)]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

/**
 * Vertical timeline. Renders a thin guide line on the left edge of the
 * list and positions a dot per item. Use for activity feeds, audit
 * trails, message metadata streams.
 */
export const Timeline = forwardRef<
  HTMLUListElement,
  HTMLAttributes<HTMLUListElement>
>(({ className, children, ...props }, ref) => (
  <ul
    ref={ref}
    className={cn(
      "relative space-y-5 pl-5",
      "before:absolute before:bottom-2 before:left-0 before:top-2 before:w-px before:bg-[var(--border-subtle)]",
      className,
    )}
    {...props}
  >
    {children}
  </ul>
));
Timeline.displayName = "Timeline";

// Drop the HTML `title` attribute so the prop carries our ReactNode title
// instead. We never set the native attribute on a <li> in this app.
export interface TimelineItemProps
  extends Omit<HTMLAttributes<HTMLLIElement>, "title">,
    VariantProps<typeof dotVariants> {
  /** Day / time label rendered as an Eyebrow above the title. */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Optional metadata row under the title (text-caption tertiary). */
  meta?: ReactNode;
}

export const TimelineItem = forwardRef<HTMLLIElement, TimelineItemProps>(
  (
    { className, variant, eyebrow, title, meta, children, ...props },
    ref,
  ) => (
    <li ref={ref} className={cn("relative", className)} {...props}>
      <span aria-hidden className={dotVariants({ variant })} />
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <p className="mt-1 text-body-sm font-medium text-[var(--text-primary)]">
        {title}
      </p>
      {meta ? (
        <div className="mt-1 text-caption text-[var(--text-tertiary)]">
          {meta}
        </div>
      ) : null}
      {children ? <div className="mt-2">{children}</div> : null}
    </li>
  ),
);
TimelineItem.displayName = "TimelineItem";

export { dotVariants as timelineDotVariants };
