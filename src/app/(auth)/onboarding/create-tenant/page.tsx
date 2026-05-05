import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getRoutingUser } from "@/server/db/tenancy";
import { CreateTenantCard } from "@/components/onboarding/create-tenant-card";

export const metadata: Metadata = {
  title: "Create your workspace",
};

/**
 * Two legitimate ways to land here:
 *
 *   1. Brand-new user, zero memberships — /post-auth dispatcher routed
 *      them here so they can name their first workspace.
 *   2. Existing user explicitly choosing to create *another* workspace
 *      — entered via the workspace switcher / command palette which
 *      append `?intent=add` to opt past the membership guard.
 *
 * Without `?intent=add`, an authenticated user who already has at
 * least one membership is bounced to /post-auth (which then routes
 * them to their last-used workspace). Otherwise the form rendered for
 * any accidental nav and produced duplicate tenants on submit.
 */
export default async function CreateTenantPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?next=/onboarding/create-tenant");
  }

  const { intent } = await searchParams;
  if (intent !== "add") {
    const routing = await getRoutingUser(session.user.id);
    if (routing && routing.memberships.length > 0) {
      redirect("/post-auth");
    }
  }

  return <CreateTenantCard userEmail={session.user.email ?? null} />;
}
