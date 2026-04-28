/**
 * Phase 1 seed — creates one demo tenant + owner so Phase 2 has a row to
 * log into. Idempotent: safe to run multiple times.
 *
 * Phase 4 addendum: every tenant now carries a default voiceProfile inside
 * settings.voiceProfile. The seed retrofits any existing tenant that
 * predates Phase 4 so the AI brain always has a profile to read.
 *
 * Usage: npm run db:seed
 */
import { PrismaClient, Plan, Role, type Prisma } from "@prisma/client";
import { defaultVoiceProfile, getVoiceProfile } from "../src/lib/validators";

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
        voiceProfile: defaultVoiceProfile(),
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

  // Retrofit existing tenants — patch any that are missing voiceProfile in
  // settings. getVoiceProfile() returns the default for null / malformed
  // input, so we only need to overwrite when settings.voiceProfile is absent.
  const allTenants = await prisma.tenant.findMany({
    select: { id: true, slug: true, settings: true },
  });
  let patched = 0;
  for (const t of allTenants) {
    const current =
      t.settings && typeof t.settings === "object" && !Array.isArray(t.settings)
        ? (t.settings as Record<string, unknown>)
        : {};
    if (current.voiceProfile) continue;
    const next: Record<string, unknown> = {
      ...current,
      voiceProfile: getVoiceProfile(t.settings),
    };
    await prisma.tenant.update({
      where: { id: t.id },
      data: { settings: next as Prisma.InputJsonValue },
    });
    patched++;
    console.log(`  + voiceProfile retrofitted onto tenant '${t.slug}'`);
  }

  console.log(
    `Seeded tenant '${tenant.slug}' with owner ${owner.email}` +
      (patched > 0 ? ` (also retrofitted ${patched} existing tenant(s))` : ""),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
