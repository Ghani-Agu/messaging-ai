import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      {/* Animated mesh gradient backdrop. The slow-shifting motion is in
          AuthMeshBackdrop (client component). */}
      <AuthMeshBackdrop />

      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6 lg:px-8">
        <Link
          href="/"
          className="text-body font-semibold tracking-tight text-[var(--text-primary)]"
        >
          messaging-ai
        </Link>
      </header>

      <div className="relative z-10 flex flex-1 items-center justify-center px-6 pb-16 pt-8">
        {children}
      </div>
    </main>
  );
}

import { AuthMeshBackdrop } from "@/components/auth/auth-mesh-backdrop";
