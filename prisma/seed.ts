/**
 * Phase 1 seed — creates one demo tenant + owner so Phase 2 has a row to
 * log into. Idempotent: safe to run multiple times.
 *
 * Usage: npm run db:seed
 */
import { PrismaClient, Plan, Role } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const owner = await prisma.user.upsert({
    where: { email: "founder@acme.test" },
    update: {},
    create: {
      email: "founder@acme.test",
      name: "Acme Founder",
    },
  });

  const tenant = await prisma.tenant.upsert({
    where: { slug: "acme" },
    update: {},
    create: {
      slug: "acme",
      name: "Acme Co.",
      plan: Plan.STARTER,
      settings: {
        defaultLanguage: "en",
        brandVoice: "friendly-professional",
        businessHours: { tz: "Africa/Algiers" },
      },
    },
  });

  await prisma.tenantUser.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: owner.id } },
    update: { role: Role.OWNER },
    create: {
      tenantId: tenant.id,
      userId: owner.id,
      role: Role.OWNER,
    },
  });

  console.log(`Seeded tenant '${tenant.slug}' with owner ${owner.email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
