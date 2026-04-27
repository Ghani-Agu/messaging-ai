import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getRoutingUser } from "@/server/db/tenancy";

export const dynamic = "force-dynamic";

/**
 * Post-authentication dispatcher. Every successful sign-in / sign-up redirects
 * here, and this page picks the right next destination based on the user's
 * current memberships. Never renders UI — always 302s.
 */
export default async function PostAuthPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const user = await getRoutingUser(session.user.id);
  if (!user) {
    // User record vanished (e.g. deleted while session was still valid).
    redirect("/login");
  }

  if (user.memberships.length === 0) {
    redirect("/onboarding/create-tenant");
  }

  // Prefer last-used tenant, but only if the user is still a member of it.
  const stillMemberOfLastUsed =
    user.lastUsedTenant !== null &&
    user.memberships.some((m) => m.tenant.id === user.lastUsedTenant?.id);

  const slug = stillMemberOfLastUsed
    ? user.lastUsedTenant!.slug
    : user.memberships[0]!.tenant.slug;

  redirect(`/${slug}/dashboard`);
}
