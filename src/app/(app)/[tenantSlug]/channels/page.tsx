import type { Metadata } from "next";
import { Globe, Instagram, MessageCircle } from "lucide-react";
import { getTenantContext } from "@/server/tenancy/context";
import { getWhatsAppChannel, getWidgetChannel } from "@/server/db/channels";
import {
  ChannelRow,
  type ChannelRowStatus,
} from "@/components/app/channels/channel-row";

export const metadata: Metadata = {
  title: "Channels",
};

export default async function ChannelsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const [widget, whatsapp] = await Promise.all([
    getWidgetChannel(ctx.tenant.id),
    getWhatsAppChannel(ctx.tenant.id),
  ]);

  let widgetStatus: ChannelRowStatus = "available";
  if (widget) {
    widgetStatus = widget.status === "CONNECTED" ? "connected" : "paused";
  }
  const widgetDescription = widget
    ? "Embedded chat for your website. Configure origins, theme, and key."
    : "Embedded chat for your website. Enable to mint a public key and embed snippet.";

  let whatsappStatus: ChannelRowStatus = "available";
  if (whatsapp) {
    whatsappStatus =
      whatsapp.status === "CONNECTED" ? "connected" : "paused";
  }
  const whatsappDescription = whatsapp
    ? "Connected via 360dialog. Configure display, rotate webhook secret, or pause."
    : "Connect your 360dialog number for two-way WhatsApp Business messaging.";

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 lg:px-10 lg:py-14">
      <header className="mb-8">
        <h1 className="text-h1 text-[var(--text-primary)]">Channels</h1>
        <p className="mt-2 text-body text-[var(--text-secondary)]">
          Connect the surfaces customers reach you on. Each channel routes
          incoming messages through the same AI brain and conversation thread.
        </p>
      </header>

      <ul className="space-y-2.5">
        <li>
          <ChannelRow
            icon={Globe}
            name="Website widget"
            description={widgetDescription}
            status={widgetStatus}
            href={`/${tenantSlug}/channels/widget`}
          />
        </li>
        <li>
          <ChannelRow
            icon={MessageCircle}
            name="WhatsApp"
            description={whatsappDescription}
            status={whatsappStatus}
            href={`/${tenantSlug}/channels/whatsapp`}
          />
        </li>
        <li>
          <ChannelRow
            icon={Instagram}
            name="Instagram"
            description="Reply to Instagram DMs from a connected Business account."
            comingInPhase={7}
          />
        </li>
      </ul>
    </div>
  );
}
