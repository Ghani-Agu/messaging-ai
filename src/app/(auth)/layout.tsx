import Link from "next/link";
import type { ReactNode } from "react";
import { AuthMeshBackdrop } from "@/components/auth/auth-mesh-backdrop";
import { AuthHero } from "@/components/auth/auth-hero";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      {/* Corner-anchored mesh + breathing glows. Fixed-position behind
          everything; client component for the prefers-reduced-motion gate. */}
      <AuthMeshBackdrop />

      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6 lg:px-8">
        <Link
          href="/"
          className="text-body font-semibold tracking-tight text-[var(--text-primary)]"
        >
          messaging-ai
        </Link>
      </header>

      {/* Two-column split at lg+ (hero / card). Below lg the hero is
          hidden and the card sits centered in a single column. */}
      <div className="relative z-10 mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 items-center gap-10 px-6 pb-16 pt-8 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-12">
        <AuthHero />
        <div className="flex w-full items-center justify-center">
          {children}
        </div>
      </div>
    </main>
  );
}
