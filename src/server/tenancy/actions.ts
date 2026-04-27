"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/server/auth";
import { revalidatePath } from "next/cache";
import {
  createTenantWithOwner,
  isSlugAvailable,
  setLastUsedTenant,
  updateTenantName,
} from "@/server/db/tenancy";
import { requireTenantContext } from "@/server/tenancy/context";
import { slugSchema, tenantNameSchema } from "@/lib/slug";
import type {
  CreateTenantState,
  UpdateTenantState,
} from "@/server/tenancy/state";

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

const updateTenantSchema = z.object({
  tenantSlug: z.string().min(1),
  name: tenantNameSchema,
});

/**
 * Update the workspace name. ADMIN role floor — agents and viewers can read
 * settings but not change them. (OWNER is implicitly allowed via the rank.)
 */
export async function updateTenantNameAction(
  _prev: UpdateTenantState,
  formData: FormData,
): Promise<UpdateTenantState> {
  const parsed = updateTenantSchema.safeParse({
    tenantSlug: formData.get("tenantSlug"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      field: "name",
      message: parsed.error.issues[0]?.message ?? "Invalid workspace name.",
    };
  }
  const ctx = await requireTenantContext(parsed.data.tenantSlug, {
    minRole: "ADMIN",
  });
  await updateTenantName({ tenantId: ctx.tenant.id, name: parsed.data.name });
  // Refresh the sidebar / switcher copy that pulls the tenant name.
  revalidatePath(`/${ctx.tenant.slug}`, "layout");
  return { status: "saved" };
}
