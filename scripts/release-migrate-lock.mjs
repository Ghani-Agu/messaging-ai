// One-shot: find and terminate any session holding the Prisma migrate
// advisory lock (objid 72707369). Used to recover from a killed
// `prisma migrate dev` whose pgbouncer-pooled session still holds the lock.
//
// Run: npx dotenv -e .env.local -- node scripts/release-migrate-lock.mjs

import { PrismaClient } from "@prisma/client";

const PRISMA_MIGRATE_ADVISORY_LOCK_OBJID = 72707369;

const prisma = new PrismaClient();
try {
  const holders = await prisma.$queryRawUnsafe(
    `SELECT a.pid, a.application_name, a.state, a.query_start, a.query
       FROM pg_locks l
       JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.locktype = 'advisory' AND l.objid = $1`,
    PRISMA_MIGRATE_ADVISORY_LOCK_OBJID,
  );
  if (holders.length === 0) {
    console.log("No session holds the migrate advisory lock right now.");
  } else {
    for (const h of holders) {
      console.log(
        `holder pid=${h.pid} app=${h.application_name} state=${h.state} since=${h.query_start}`,
      );
    }
    for (const h of holders) {
      // pg_terminate_backend takes integer, not bigint — Prisma binds JS
      // numbers as bigint over the protocol, so cast explicitly.
      const r = await prisma.$queryRawUnsafe(
        `SELECT pg_terminate_backend($1::int) AS terminated`,
        Number(h.pid),
      );
      console.log(`pg_terminate_backend(${h.pid}) -> ${JSON.stringify(r)}`);
    }
  }
} catch (err) {
  console.error("release-migrate-lock failed:", err);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
