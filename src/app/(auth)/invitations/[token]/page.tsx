import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import {
  findInvitationByToken,
  markInvitationExpiredIfNeeded,
} from "@/server/db/invitations";
import { acceptInvitationAction } from "@/server/invitations/actions";
import { InvitationSignInCard } from "@/components/auth/invitation-sign-in-card";

export const metadata: Metadata = {
  title: "Join workspace",
};

type State =
  | { kind: "invalid" }
  | { kind: "expired" }
  | { kind: "used" }
  | { kind: "cancelled" }
  | { kind: "email-mismatch"; expectedEmail: string }
  | {
      kind: "needs-signin";
      token: string;
      tenantName: string;
      inviteeEmail: string;
      role: string;
      inviterName: string | null;
    };

export default async function InvitationAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await findInvitationByToken(token);
  let state: State;

  if (!invite) {
    state = { kind: "invalid" };
  } else {
    const status = await markInvitationExpiredIfNeeded({
      invitationId: invite.id,
      expiresAt: invite.expiresAt,
      status: invite.status,
    });
    if (status === "EXPIRED") state = { kind: "expired" };
    else if (status === "CANCELLED") state = { kind: "cancelled" };
    else if (status === "ACCEPTED") state = { kind: "used" };
    else {
      // PENDING — check session
      const session = await auth();
      if (session?.user?.id && session.user.email) {
        if (
          session.user.email.toLowerCase() === invite.email.toLowerCase()
        ) {
          // Auto-accept inline — server-side, redirects on success.
          const result = await acceptInvitationAction({ token });
          if (result.ok) redirect(`/${result.tenantSlug}/dashboard`);
          // Action returned an error; render it as the invalid state to
          // avoid leaking specifics.
          state = { kind: "invalid" };
        } else {
          state = { kind: "email-mismatch", expectedEmail: invite.email };
        }
      } else {
        state = {
          kind: "needs-signin",
          token,
          tenantName: invite.tenant.name,
          inviteeEmail: invite.email,
          role: invite.role,
          inviterName: invite.inviter.name,
        };
      }
    }
  }

  return <InvitationView state={state} />;
}

function InvitationView({ state }: { state: State }) {
  if (state.kind === "needs-signin") {
    return (
      <InvitationSignInCard
        token={state.token}
        tenantName={state.tenantName}
        inviteeEmail={state.inviteeEmail}
        role={state.role}
        inviterName={state.inviterName}
      />
    );
  }

  if (state.kind === "email-mismatch") {
    return (
      <ErrorCard
        title="Wrong account"
        body={
          <>
            <p className="text-body text-[var(--text-secondary)]">
              This invitation is for{" "}
              <strong className="text-[var(--text-primary)]">
                {state.expectedEmail}
              </strong>
              . You&apos;re signed in with a different email.
            </p>
            <p className="mt-3 text-body-sm text-[var(--text-tertiary)]">
              Sign out and click the invitation link again with that
              email.
            </p>
            <div className="mt-6">
              <Link
                href="/login"
                className="inline-flex h-10 items-center justify-center rounded-md bg-[var(--accent-base)] px-4 text-body-sm font-medium text-white transition-colors duration-150 ease-out hover:bg-[var(--accent-hover)]"
              >
                Go to sign in
              </Link>
            </div>
          </>
        }
      />
    );
  }

  if (state.kind === "expired") {
    return (
      <ErrorCard
        title="Invitation expired"
        body="This invitation expired more than seven days after it was sent. Ask the inviter to send a fresh one."
      />
    );
  }
  if (state.kind === "used") {
    return (
      <ErrorCard
        title="Already accepted"
        body="This invitation has already been used. Sign in to your workspace from the link below."
      />
    );
  }
  if (state.kind === "cancelled") {
    return (
      <ErrorCard
        title="Invitation cancelled"
        body="This invitation was cancelled. Ask the inviter to send a fresh one."
      />
    );
  }
  return (
    <ErrorCard
      title="Invalid invitation"
      body="This invitation link isn't valid. Double-check it or ask the inviter to resend."
    />
  );
}

function ErrorCard({
  title,
  body,
}: {
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div className="w-full max-w-[420px]">
      <div
        className="rounded-2xl border border-[var(--border-subtle)] p-8 text-center shadow-[var(--shadow-lg)] backdrop-blur-xl"
        style={{
          backgroundColor:
            "color-mix(in oklab, var(--bg-surface) 88%, transparent)",
        }}
      >
        <h1 className="mb-2 text-h2 text-[var(--text-primary)]">{title}</h1>
        {typeof body === "string" ? (
          <p className="text-body text-[var(--text-secondary)]">{body}</p>
        ) : (
          body
        )}
        <p className="mt-6 text-body-sm text-[var(--text-tertiary)]">
          <Link
            href="/login"
            className="font-medium text-[var(--accent-hover)] hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
