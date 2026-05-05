import type { Metadata } from "next";
import { Globe, Instagram, MessageCircle } from "lucide-react";
import { getTenantContext } from "@/server/tenancy/context";
import {
  getInstagramChannel,
  getMessengerChannel,
  getWhatsAppChannel,
  getWidgetChannel,
} from "@/server/db/channels";
import {
  ChannelRow,
  type ChannelRowStatus,
} from "@/components/app/channels/channel-row";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Eyebrow } from "@/components/ui/eyebrow";

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
  const [widget, whatsapp, messenger, instagram] = await Promise.all([
    getWidgetChannel(ctx.tenant.id),
    getWhatsAppChannel(ctx.tenant.id),
    getMessengerChannel(ctx.tenant.id),
    getInstagramChannel(ctx.tenant.id),
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

  let messengerStatus: ChannelRowStatus = "available";
  if (messenger) {
    messengerStatus =
      messenger.status === "CONNECTED" ? "connected" : "paused";
  }
  const messengerDescription = messenger
    ? `${messenger.displayName} — Page DMs via the Meta Graph API.`
    : "Connect a Facebook Page to handle Messenger DMs through the AI brain.";

  let instagramStatus: ChannelRowStatus = "available";
  if (instagram) {
    instagramStatus =
      instagram.status === "CONNECTED" ? "connected" : "paused";
  }
  const instagramDescription = instagram
    ? `${instagram.displayName} — IG Business DMs via the Meta Graph API.`
    : "Connect an Instagram Business account (linked to a Facebook Page) for DMs.";

  return (
    <PageShell width="3xl">
      <PageHeader
        eyebrow={<Eyebrow>Workspace</Eyebrow>}
        title="Channels"
        description="Connect the surfaces customers reach you on. Each channel routes incoming messages through the same AI brain and conversation thread."
      />

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
            icon={MessageCircle}
            name="Messenger"
            description={messengerDescription}
            status={messengerStatus}
            href={`/${tenantSlug}/channels/messenger`}
          />
        </li>
        <li>
          <ChannelRow
            icon={Instagram}
            name="Instagram"
            description={instagramDescription}
            status={instagramStatus}
            href={`/${tenantSlug}/channels/instagram`}
          />
        </li>
      </ul>
    </PageShell>
  );
}
