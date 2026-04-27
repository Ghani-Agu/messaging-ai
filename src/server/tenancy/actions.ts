"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/server/auth";
import {
  createTenantWithOwner,
  isSlugAvailable,
  setLastUsedTenant,
} from "@/server/db/tenancy";
import { slugSchema, tenantNameSchema } from "@/lib/slug";

export type CreateTenantState =
  | { status: "idle" }
  | { status: "error"; field?: "name" | "slug" | "form"; message: string };

const initial: CreateTenantState = { status: "idle" };

export async function createTenantAction(
  _prev: CreateTenantState,
  formData: FormData,
): Promise<CreateTenantState> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?next=/onboarding/create-tenant");
  }

  const nameResult = tenantNameSchema.safeParse(formData.get("name"));
  if (!nameResult.success) {
    return {
      status: "error",
      field: "name",
      message: nameResult.error.issues[0]?.message ?? "Invalid workspace name.",
    };
  }

  const slugResult = slugSchema.safeParse(formData.get("slug"));
  if (!slugResult.success) {
    return {
      status: "error",
      field: "slug",
      message: slugResult.error.issues[0]?.message ?? "Invalid workspace URL.",
    };
  }

  if (!(await isSlugAvailable(slugResult.data))) {
    return {
      status: "error",
      field: "slug",
      message: "That workspace URL is taken — try another.",
    };
  }

  let tenantSlug: string;
  try {
    const tenant = await createTenantWithOwner({
      userId: session.user.id,
      name: nameResult.data,
      slug: slugResult.data,
    });
    tenantSlug = tenant.slug;
  } catch (err) {
    // P2002 = unique constraint violation. Race-condition fallback for the
    // tiny window between isSlugAvailable() and create.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return {
        status: "error",
        field: "slug",
        message: "That workspace URL was just claimed — try another.",
      };
    }
    throw err;
  }

  redirect(`/${tenantSlug}/dashboard`);
}

export { initial as createTenantInitialState };

const switchSchema = z.object({
  tenantId: z.string().min(1),
  slug: z.string().min(1),
});

/**
 * Update the user's lastUsedTenantId and redirect to the chosen workspace.
 * Called from the workspace switcher dropdown. setLastUsedTenant is a no-op
 * if the user isn't a member of the target tenant — they still get
 * redirected, but the tenant layout will then 404 them, which is the
 * correct behavior for tampered IDs.
 */
export async function switchWorkspaceAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const parsed = switchSchema.safeParse({
    tenantId: formData.get("tenantId"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) redirect("/post-auth");

  await setLastUsedTenant({
    userId: session.user.id,
    tenantId: parsed.data.tenantId,
  });
  redirect(`/${parsed.data.slug}/dashboard`);
}
