import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { verifyPassword } from "@/server/auth/password";

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
};

// Authorize-callback input shape. Schema-validated so a tampered POST
// can't reach Prisma with an undefined email or a non-string password.
const credentialsInputSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(1024),
});

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
    // Email + password sign-in. Users acquire a password via the reset
    // flow ("set your initial password" works against any existing
    // account regardless of how it was originally created). The
    // authorize callback returns null on EVERY failure mode — wrong
    // email, wrong password, no password set — so the client can't
    // distinguish "no such user" from "wrong password" by response.
    Credentials({
      name: "Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(rawCredentials): Promise<{ id: string; email: string; name: string | null; image: string | null; isSuperAdmin: boolean } | null> {
        const parsed = credentialsInputSchema.safeParse(rawCredentials);
        if (!parsed.success) return null;
        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            isSuperAdmin: true,
            passwordHash: true,
          },
        });
        if (!user?.passwordHash) return null;
        const ok = await verifyPassword(parsed.data.password, user.passwordHash);
        if (!ok) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          isSuperAdmin: user.isSuperAdmin,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // `user` is only present on initial sign-in. We snapshot the
      // super-admin flag onto the JWT then; flipping it later requires the
      // user to sign out and back in (acceptable for a rarely-changed
      // platform-level flag).
      if (user) {
        token.id = user.id;
        token.isSuperAdmin =
          (user as { isSuperAdmin?: boolean }).isSuperAdmin ?? false;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.id && session.user) {
        session.user.id = token.id as string;
        session.user.isSuperAdmin = Boolean(token.isSuperAdmin);
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
