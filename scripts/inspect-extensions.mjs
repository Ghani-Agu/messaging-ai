import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const rows = await prisma.$queryRawUnsafe(
  `SELECT e.extname, n.nspname AS schema, e.extversion
   FROM pg_extension e
   JOIN pg_namespace n ON n.oid = e.extnamespace
   ORDER BY n.nspname, e.extname`
);
console.log(JSON.stringify(rows, null, 2));
await prisma.$disconnect();
