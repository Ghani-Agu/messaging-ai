import type { Metadata } from "next";
import { getTenantContext } from "@/server/tenancy/context";
import { WorkspaceNameForm } from "@/components/app/workspace-name-form";

export const metadata: Metadata = { title: "Settings · General" };

export default async function GeneralSettingsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const canEdit = ctx.membership.role === "OWNER" || ctx.membership.role === "ADMIN";

  return (
    <div className="space-y-10">
      <section aria-labelledby="general-heading">
        <h2 id="general-heading" className="mb-4 text-h4 text-[var(--text-primary)]">
          Workspace
        </h2>
        <WorkspaceNameForm
          tenantSlug={tenantSlug}
          initialName={ctx.tenant.name}
          canEdit={canEdit}
        />
      </section>

      <section aria-labelledby="url-heading">
        <h2 id="url-heading" className="mb-4 text-h4 text-[var(--text-primary)]">
          Workspace URL
        </h2>
        <div className="flex h-10 max-w-md items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-body text-[var(--text-tertiary)]">
          <span>messaging-ai.app/</span>
          <span className="text-[var(--text-primary)]">{ctx.tenant.slug}</span>
        </div>
        <p className="mt-2 text-body-sm text-[var(--text-tertiary)]">
          Changing the workspace URL is coming in a future phase. It would
          break existing bookmarks, so we want to handle redirects properly
          first.
        </p>
      </section>

      <section aria-labelledby="theme-heading">
        <h2 id="theme-heading" className="mb-4 text-h4 text-[var(--text-primary)]">
          Theme
        </h2>
        <p className="text-body-sm text-[var(--text-secondary)]">
          Use the theme picker in the user menu (bottom-left of the sidebar)
          to switch between Light, Dark, and System.
        </p>
      </section>
    </div>
  );
}
