#!/usr/bin/env tsx
/**
 * Dev-time CLI to insert an encrypted LiveDataSource row without going
 * through the operator UI. Useful for:
 *   - Initial setup of a tenant's first source on a fresh deployment
 *     (the project lead handles WBP this way per the build prompt's
 *     post-construction phase).
 *   - Credential rotation where the UI flow isn't desired.
 *   - Bulk imports from a script.
 *
 * Password handling: the plaintext password is read from stdin so it
 * NEVER appears in:
 *   - Shell history (no inline arg)
 *   - Process listings (ps / Task Manager / WMI)
 *   - The script's environment dump
 *   - Any log line
 *
 * The script encrypts with LIVE_DATA_ENCRYPTION_KEY (must be set in
 * .env.local) before writing the row. Status is PENDING_TEST until
 * the next cron tick OR a manual sync trigger flips it to CONNECTED.
 *
 * Invocation: see docs/integrations.md for the PowerShell + Bash
 * patterns that read the password from a SecureString / `read -s`
 * before piping into stdin.
 */

import { parseArgs } from "node:util";
import { prisma } from "@/server/db/client";
import { encryptConfig } from "@/server/integrations/crypto";
import { OdooConfigSchema } from "@/server/integrations/odoo/config-schema";

type ParsedArgs = {
  values: {
    "tenant-slug"?: string;
    type?: string;
    name?: string;
    url?: string;
    database?: string;
    username?: string;
    "password-from-stdin"?: boolean;
    "brand-field"?: string;
    help?: boolean;
  };
};

function printUsage(): void {
  console.log(`Insert a LiveDataSource row from the CLI.

Usage:
  npx tsx scripts/insert-live-data-source.ts \\
    --tenant-slug <slug> --type ODOO --name "<label>" \\
    --url https://example.odoo.com \\
    --database <database-name> \\
    --username <user@example.com> \\
    --password-from-stdin \\
    [--brand-field <custom-field-name>]

Required flags:
  --tenant-slug          Tenant slug (must exist in the DB).
  --type                 ODOO (only ODOO is supported today).
  --name                 Operator-supplied label, e.g. "Production Odoo".
  --url                  https URL of the Odoo deployment (must be HTTPS).
  --database             Odoo database name.
  --username             Odoo user (typically an email).
  --password-from-stdin  Required flag — password is read from stdin.

Optional:
  --brand-field          Custom many2one field on product.template
                         (e.g. marque_id for Tayssir-wrapped Odoo).
  --help                 Show this message.

Password handling:
  The password is read from stdin so it never lands in shell history
  or process listings. See docs/integrations.md for the PowerShell
  + Bash invocation patterns.

Environment:
  LIVE_DATA_ENCRYPTION_KEY must be set in .env.local. Generate via:
    npx tsx scripts/generate-encryption-key.ts
`);
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    options: {
      "tenant-slug": { type: "string" },
      type: { type: "string" },
      name: { type: "string" },
      url: { type: "string" },
      database: { type: "string" },
      username: { type: "string" },
      "password-from-stdin": { type: "boolean", default: false },
      "brand-field": { type: "string" },
      help: { type: "boolean", default: false },
    },
  }) as unknown as ParsedArgs;

  const { values } = parsed;

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  const required = [
    "tenant-slug",
    "type",
    "name",
    "url",
    "database",
    "username",
  ] as const;
  const missing = required.filter((k) => !values[k]);
  if (missing.length > 0) {
    console.error(
      `Missing required arg(s): ${missing.map((k) => `--${k}`).join(", ")}`,
    );
    console.error("");
    printUsage();
    process.exit(1);
  }

  if (values.type !== "ODOO") {
    console.error(`Type "${values.type}" not supported. Only ODOO.`);
    process.exit(1);
  }

  if (!values["password-from-stdin"]) {
    console.error(
      "Use --password-from-stdin to provide password via stdin pipe.",
    );
    console.error(
      "This avoids password appearing in shell history or process listings.",
    );
    process.exit(1);
  }

  const password = await readStdin();
  if (!password.trim()) {
    console.error("Password from stdin was empty.");
    process.exit(1);
  }

  // Required-flag presence already enforced above; non-null assertion
  // here is safe because the missing-args check guarantees these are set.
  const slug = values["tenant-slug"]!;
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    console.error(`Tenant not found: ${slug}`);
    process.exit(1);
  }

  const config = OdooConfigSchema.parse({
    url: values.url!,
    database: values.database!,
    username: values.username!,
    password: password.trim(),
    additionalFields: values["brand-field"]
      ? { brandField: values["brand-field"] }
      : undefined,
  });

  const source = await prisma.liveDataSource.create({
    data: {
      tenantId: tenant.id,
      type: "ODOO",
      name: values.name!,
      encryptedConfig: encryptConfig(JSON.stringify(config)),
      status: "PENDING_TEST",
    },
  });

  console.log(`Created LiveDataSource: ${source.id}`);
  console.log(`Tenant: ${tenant.slug} (${tenant.id})`);
  console.log(`Status: PENDING_TEST`);
  console.log(``);
  console.log(`To trigger first sync immediately:`);
  console.log(`  curl -X POST http://localhost:3000/api/cron/sync-live-data \\`);
  console.log(`       -H "Authorization: Bearer $CRON_SECRET"`);
  console.log(``);
  console.log(`Or wait for the next cron tick (15min business hrs / 60min off-hrs).`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
