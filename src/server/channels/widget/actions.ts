"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenantContext } from "@/server/tenancy/context";
import {
  getWidgetChannel,
  rotateWidgetChannelKey,
  upsertWidgetChannel,
} from "@/server/db/channels";
import { NotEnabledError } from "./errors";
import { originsTextSchema } from "./origins-parser";
import type {
  EnableWidgetChannelState,
  RotateWidgetKeyState,
  UpdateWidgetConfigState,
} from "./state";

/**
 * Phase-6 widget channel server actions. Three surfaces:
 *
 *   enableWidgetChannel  — AGENT — create-if-not-exists, no-op on second
 *                          call. First call mints the publicKey and the row.
 *   updateWidgetConfig   — AGENT — patch displayName / themeAccent /
 *                          originsAllowlist on an existing channel. Throws
 *                          NotEnabledError if the channel doesn't exist.
 *   rotateWidgetKey      — ADMIN — replace the publicKey with a fresh one.
 *                          Invalidates every embed snippet in the wild —
 *                          gated to ADMIN because AGENTs can fix typos but
 *                          should not be able to break production deploys.
 *
 * Defense in depth: pages and components disable controls based on
 * ROLE_RANK derived from the same context, but the security boundary is
 * the requireTenantContext({ minRole }) call inside each action — never
 * the page-level disable.
 */

const enableSchema = z.object({
  tenantSlug: z.string().min(1),
});

export async function enableWidgetChannel(
  _prev: EnableWidgetChannelState,
  formData: FormData,
): Promise<EnableWidgetChannelState> {
  const parsed = enableSchema.safeParse({
    tenantSlug: formData.get("tenantSlug"),
  });
  if (!parsed.success) return { status: "error", message: "Invalid request." };

  const ctx = await requireTenantContext(parsed.data.tenantSlug, {
    minRole: "AGENT",
  });

  // upsertWidgetChannel is the no-op path when a row already exists. It
  // preserves the existing publicKey and surface fields. First-time call
  // mints the key and creates the row with default surface fields; the
  // operator fills them in via updateWidgetConfig afterwards.
  const channel = await upsertWidgetChannel({ tenantId: ctx.tenant.id });

  revalidatePath(`/${ctx.tenant.slug}/channels`);
  revalidatePath(`/${ctx.tenant.slug}/channels/widget`);
  return { status: "ok", channelId: channel.id };
}

const updateConfigSchema = z.object({
  tenantSlug: z.string().min(1),
  displayName: z
    .string()
    .trim()
    .min(1, "Display name is required")
    .max(80, "Display name is too long"),
  themeAccent: z
    .string()
    .trim()
    .max(64, "Theme accent is too long")
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
  originsText: originsTextSchema,
});

export async function updateWidgetConfig(
  _prev: UpdateWidgetConfigState,
  formData: FormData,
): Promise<UpdateWidgetConfigState> {
  const result = updateConfigSchema.safeParse({
    tenantSlug: formData.get("tenantSlug"),
    displayName: formData.get("displayName"),
    themeAccent: formData.get("themeAccent") ?? "",
    originsText: formData.get("originsText") ?? "",
  });

  if (!result.success) {
    const fieldErrors: NonNullable<
      Extract<UpdateWidgetConfigState, { status: "error" }>["fieldErrors"]
    > = {};
    let formMessage: string | undefined;

    for (const issue of result.error.issues) {
      const [head, second] = issue.path;
      if (head === "displayName") {
        fieldErrors.displayName ??= issue.message;
      } else if (head === "themeAccent") {
        fieldErrors.themeAccent ??= issue.message;
      } else if (head === "originsText" && second === "origins") {
        // Per-line origin error from originsTextSchema:
        //   path = ["originsText", "origins", <idx>]
        const idx = issue.path[2];
        if (typeof idx === "number") {
          fieldErrors.originsByIndex ??= {};
          fieldErrors.originsByIndex[idx] = issue.message;
        }
      } else if (head === "originsText") {
        // The "max 20 origins" overflow message — form-level, not per-line.
        formMessage ??= issue.message;
      } else {
        formMessage ??= issue.message;
      }
    }

    return { status: "error", formMessage, fieldErrors };
  }

  const ctx = await requireTenantContext(result.data.tenantSlug, {
    minRole: "AGENT",
  });

  const existing = await getWidgetChannel(ctx.tenant.id);
  if (!existing) {
    throw new NotEnabledError();
  }

  await upsertWidgetChannel({
    tenantId: ctx.tenant.id,
    displayName: result.data.displayName,
    themeAccent: result.data.themeAccent,
    originsAllowlist: result.data.originsText,
  });

  revalidatePath(`/${ctx.tenant.slug}/channels`);
  revalidatePath(`/${ctx.tenant.slug}/channels/widget`);
  return { status: "saved" };
}

const rotateSchema = z.object({
  tenantSlug: z.string().min(1),
});

export async function rotateWidgetKey(
  _prev: RotateWidgetKeyState,
  formData: FormData,
): Promise<RotateWidgetKeyState> {
  const parsed = rotateSchema.safeParse({
    tenantSlug: formData.get("tenantSlug"),
  });
  if (!parsed.success) return { status: "error", message: "Invalid request." };

  const ctx = await requireTenantContext(parsed.data.tenantSlug, {
    minRole: "ADMIN",
  });

  const existing = await getWidgetChannel(ctx.tenant.id);
  if (!existing) {
    throw new NotEnabledError();
  }

  const { publicKey } = await rotateWidgetChannelKey(ctx.tenant.id);
  revalidatePath(`/${ctx.tenant.slug}/channels`);
  revalidatePath(`/${ctx.tenant.slug}/channels/widget`);
  return { status: "rotated", publicKey };
}
