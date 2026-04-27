import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { CreateTenantCard } from "@/components/onboarding/create-tenant-card";

export const metadata: Metadata = {
  title: "Create your workspace",
};

export default async function CreateTenantPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?next=/onboarding/create-tenant");
  }
  return <CreateTenantCard userEmail={session.user.email ?? null} />;
}
