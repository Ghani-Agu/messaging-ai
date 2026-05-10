import type { Metadata } from "next";
import { ResetPasswordConfirmForm } from "@/components/auth/reset-password-confirm-form";

export const metadata: Metadata = {
  title: "Set a new password",
};

export default async function ResetPasswordConfirmPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ResetPasswordConfirmForm token={token} />;
}
