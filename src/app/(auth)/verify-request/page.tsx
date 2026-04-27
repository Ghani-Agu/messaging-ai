import type { Metadata } from "next";
import { Mail } from "lucide-react";

export const metadata: Metadata = {
  title: "Check your email",
};

export default function VerifyRequestPage() {
  return (
    <div className="w-full max-w-[420px]">
      <div
        className="rounded-2xl border border-[var(--border-subtle)] p-8 text-center shadow-[var(--shadow-lg)] backdrop-blur-xl"
        style={{
          backgroundColor:
            "color-mix(in oklab, var(--bg-surface) 88%, transparent)",
        }}
      >
        <div
          aria-hidden
          className="mx-auto mb-6 flex size-12 items-center justify-center rounded-full"
          style={{
            backgroundColor:
              "color-mix(in oklab, var(--accent-base) 20%, transparent)",
            color: "var(--accent-hover)",
          }}
        >
          <Mail className="size-6" />
        </div>
        <h1 className="mb-2 text-h2 text-[var(--text-primary)]">
          Check your email
        </h1>
        <p className="text-body text-[var(--text-secondary)]">
          We sent you a magic link. Click it to finish signing in. The link
          expires in 24 hours.
        </p>
        <p className="mt-6 text-body-sm text-[var(--text-tertiary)]">
          Didn&apos;t get it? Check spam, or close this tab and try again.
        </p>
      </div>
    </div>
  );
}
