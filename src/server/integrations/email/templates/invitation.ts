import type { RenderedEmail } from "./password-reset";

export type InvitationEmailArgs = {
  inviteUrl: string;
  tenantName: string;
  inviterName: string;
  role: string;
  inviteeName?: string | null;
};

/**
 * Invitation email — sent by the Members invite flow. Both HTML and text
 * bodies; inline styles so email clients (Gmail web, Outlook) don't strip
 * them. Footer always carries the "if you don't recognize this" line so
 * recipients can ignore an unwanted invite without a support ticket.
 */
export function invitationEmail({
  inviteUrl,
  tenantName,
  inviterName,
  role,
  inviteeName,
}: InvitationEmailArgs): RenderedEmail {
  const trimmedName = inviteeName?.trim();
  const greeting = trimmedName ? `Bonjour ${trimmedName}` : "Bonjour";
  const subject = `${inviterName} invited you to ${tenantName} on messaging-ai`;
  const roleLabel = role.toLowerCase();

  return {
    subject,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>${greeting},</h2>
        <p><strong>${inviterName}</strong> has invited you to join <strong>${tenantName}</strong> on messaging-ai as a <strong>${roleLabel}</strong>.</p>
        <p>Click the button below to accept and set up your account:</p>
        <p>
          <a href="${inviteUrl}" style="display: inline-block; padding: 12px 24px; background: #EA580C; color: white; text-decoration: none; border-radius: 6px;">
            Accept invitation
          </a>
        </p>
        <p>This invitation expires in 7 days.</p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 32px 0;" />
        <p style="color: #666; font-size: 14px;">Or copy and paste this URL: ${inviteUrl}</p>
        <p style="color: #999; font-size: 13px;">If you don't recognize this invitation, you can safely ignore this email.</p>
      </div>
    `.trim(),
    text: `${greeting},

${inviterName} has invited you to join ${tenantName} on messaging-ai as a ${roleLabel}.

Open this URL to accept and set up your account:

${inviteUrl}

This invitation expires in 7 days.

If you don't recognize this invitation, you can safely ignore this email.`,
  };
}
