import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";

export const metadata: Metadata = {
  title: "Create your workspace",
};

export default function SignupPage() {
  return <AuthCard mode="signup" />;
}
