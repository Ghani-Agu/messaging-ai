import type { Metadata } from "next";
import { ResetPasswordRequestForm } from "@/components/auth/reset-password-request-form";

export const metadata: Metadata = {
  title: "Reset your password",
};

export default function ResetPasswordRequestPage() {
  return <ResetPasswordRequestForm />;
}
