import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/server/db/client";

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
};

export const authConfig = {
  adapter: PrismaAdapter(prisma),
  // JWT strategy keeps middleware edge-safe (no Prisma call per request);
  // the adapter is still used for User/Account/VerificationToken so magic
  // links and OAuth account-linking work the standard way.
  session: { strategy: "jwt" },
  secret: requireEnv("NEXTAUTH_SECRET"),
  trustHost: true,
  pages: {
    signIn: "/login",
    verifyRequest: "/verify-request",
    error: "/login",
  },
  providers: [
    Google({
      clientId: requireEnv("GOOGLE_CLIENT_ID"),
      clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
    }),
    Resend({
      apiKey: requireEnv("RESEND_API_KEY"),
      // Dev default targets Resend's shared sandbox sender, which only
      // delivers to the email associated with the Resend account. Set
      // EMAIL_FROM to a verified-domain address before going to staging/prod.
      from: process.env.EMAIL_FROM ?? "onboarding@resend.dev",
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.id && session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
