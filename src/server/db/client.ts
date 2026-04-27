/**
 * Singleton Prisma client. App code never imports `@prisma/client` directly —
 * always import from here (or from a tenancy-aware helper that wraps this).
 *
 * The global cache prevents Next.js dev hot-reload from spawning a new client
 * per render and exhausting Postgres connections.
 */
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
