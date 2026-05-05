import type { ReactNode } from "react";
import { AuthMeshBackdrop } from "@/components/auth/auth-mesh-backdrop";
import { AuthHero } from "@/components/auth/auth-hero";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      {/* Corner-anchored mesh + breathing glows. Fixed-position behind
          everything; client component for the prefers-reduced-motion gate. */}
      <AuthMeshBackdrop />

      {/* Auth surfaces are product entry points — no platform header.
          AuthHero + AuthCard carry the brand. */}

      {/* Two-column split at lg+ (hero / card). Below lg the hero is
          hidden and the card sits centered in a single column. */}
      <div className="relative z-10 mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 items-center gap-10 px-6 py-12 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-16">
        <AuthHero />
        <div className="flex w-full items-center justify-center">
          {children}
        </div>
      </div>
    </main>
  );
}
