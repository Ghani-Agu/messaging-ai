#!/usr/bin/env tsx
/**
 * Grants the platform-level isSuperAdmin flag to a user identified by email.
 * Used out-of-band (no self-service surface in v1) to gate the /admin route.
 *
 * Usage:
 *   npm run grant:superadmin -- user@example.com
 *
 * Or directly:
 *   dotenv -e .env.local -- tsx scripts/grant-superadmin.ts user@example.com
 */
import { PrismaClient } from "@prisma/client";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: grant-superadmin <email>");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const before = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, isSuperAdmin: true },
    });

    if (!before) {
      const all = await prisma.user.findMany({
        select: { email: true },
        orderBy: { createdAt: "asc" },
      });
      console.error(`No user found with email "${email}".`);
      if (all.length) {
        console.error("Existing users:");
        for (const u of all) console.error(`  - ${u.email}`);
      } else {
        console.error("(no users in the database yet)");
      }
      process.exit(1);
    }

    if (before.isSuperAdmin) {
      console.log(`User ${before.email} is already a super-admin. No changes made.`);
      return;
    }

    const after = await prisma.user.update({
      where: { email },
      data: { isSuperAdmin: true },
      select: { id: true, email: true, name: true, isSuperAdmin: true },
    });

    console.log("Granted isSuperAdmin:");
    console.log(`  id:           ${after.id}`);
    console.log(`  email:        ${after.email}`);
    console.log(`  name:         ${after.name ?? "(null)"}`);
    console.log(`  isSuperAdmin: ${after.isSuperAdmin}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
