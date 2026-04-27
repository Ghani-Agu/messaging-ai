import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, Shield } from "lucide-react";
import { auth } from "@/server/auth";

/**
 * Super-admin gate. Two-step:
 *   1. No session → /login.
 *   2. Session without isSuperAdmin → notFound() (opaque 404; we don't
 *      reveal that this route exists).
 *
 * isSuperAdmin is set out-of-band (Prisma Studio or scripts/) per the
 * Phase 2 design — there's no self-service surface in v1.
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?next=/admin");
  }
  if (!session.user.isSuperAdmin) {
    notFound();
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-8 items-center justify-center rounded-lg"
              style={{
                backgroundColor:
                  "color-mix(in oklab, var(--accent-base) 18%, transparent)",
                color: "var(--accent-hover)",
              }}
            >
              <Shield className="size-4" />
            </span>
            <div className="leading-tight">
              <p className="text-body-sm font-medium text-[var(--text-primary)]">
                messaging-ai · admin
              </p>
              <p className="text-caption text-[var(--text-tertiary)]">
                Super-admin only
              </p>
            </div>
          </div>
          <Link
            href="/post-auth"
            className="inline-flex items-center gap-1.5 text-body-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <ArrowLeft className="size-3.5" />
            Back to app
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
