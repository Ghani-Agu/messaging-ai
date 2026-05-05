import { getTenantContext } from "@/server/tenancy/context";
import { getVoiceProfile } from "@/lib/validators";
import { PlaygroundClient } from "./playground-client";

/**
 * Server component bridge for the Playground page. Resolves the tenant
 * context (auth + membership), reads the voice profile out of
 * Tenant.settings, and hands the minimal shape the client needs into
 * `PlaygroundClient`. Zero secrets cross the boundary — only the slug,
 * display name, default language, and tone label.
 */
export async function PlaygroundShell({ tenantSlug }: { tenantSlug: string }) {
  const ctx = await getTenantContext(tenantSlug);
  const voice = getVoiceProfile(ctx.tenant.settings);

  return (
    <PlaygroundClient
      tenantSlug={ctx.tenant.slug}
      tenantName={ctx.tenant.name}
      defaultLanguage={voice.defaultLanguage}
      voiceTone={voice.tone}
    />
  );
}
