export type PasswordResetEmailArgs = {
  resetUrl: string;
  userName?: string | null;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

/**
 * Password-reset email body. Both HTML and plain-text variants are produced
 * — sendEmail requires both, and clients that strip HTML still get the
 * URL out of the text body. Styling is inline because external stylesheets
 * are unreliable across email clients (Gmail web, Outlook, etc.).
 */
export function passwordResetEmail({
  resetUrl,
  userName,
}: PasswordResetEmailArgs): RenderedEmail {
  const trimmedName = userName?.trim();
  const greeting = trimmedName ? `Bonjour ${trimmedName}` : "Bonjour";
  return {
    subject: "Reset your messaging-ai password",
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>${greeting},</h2>
        <p>We received a request to reset your password. Click the link below to set a new one:</p>
        <p><a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #EA580C; color: white; text-decoration: none; border-radius: 6px;">Reset password</a></p>
        <p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>
        <p style="color: #666; font-size: 14px;">Or copy and paste this URL: ${resetUrl}</p>
      </div>
    `.trim(),
    text: `${greeting},

We received a request to reset your password. Open this URL to set a new one:

${resetUrl}

This link expires in 1 hour. If you didn't request this, ignore this email.`,
  };
}
