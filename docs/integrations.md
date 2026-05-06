# Live Data Integrations

Operating notes for the Live Data Sources feature: ERP / catalog
connectors that auto-populate KnowledgeItem rows. Today only **Odoo**
(XML-RPC, polling) is implemented; the data layer reserves enum
values for SHOPIFY / WOOCOMMERCE / MANUAL_CSV / GOOGLE_SHEETS /
WEBHOOK so future commits can add adapters without re-migrating.

---

## Required environment variables

These two MUST be set before any Live Data Source can be created or
synced. The app fails fast at the first encryption call if either is
missing or wrong length.

| Var | Format | Where it's used |
|---|---|---|
| `LIVE_DATA_ENCRYPTION_KEY` | base64 of 32 random bytes | `src/server/integrations/crypto.ts` — wraps every credential JSON in AES-256-GCM before persistence |
| `CRON_SECRET` | base64 of 32 random bytes | `src/app/api/cron/sync-live-data/route.ts` — `Authorization: Bearer <secret>` gate on the cron route |

### Generating both keys

One-liner (PowerShell or Bash, run from the repo root):

```
npx tsx scripts/generate-encryption-key.ts && \
node -e "console.log('CRON_SECRET=' + require('node:crypto').randomBytes(32).toString('base64'))"
```

Copy both lines into `.env.local`. **Save both keys to your password
manager as a backup.** Losing `LIVE_DATA_ENCRYPTION_KEY` means losing
access to every encrypted credential — operators have to re-enter
every Odoo password. `CRON_SECRET` can be rotated freely (just update
the deployment platform's cron config to match).

In production, both vars MUST live in the deployment platform's
secret manager (Vercel Project Environment Variables, Fly.io secrets,
etc.). Never commit either to git.

In development, missing keys log a warning and degrade gracefully:
the page renders, but any encrypt/decrypt call throws — i.e. you
cannot create or sync a Live Data Source until the key is set.

---

## Why AES-256-GCM

GCM is authenticated encryption — every ciphertext carries an
authentication tag that's verified on decrypt. Tampering with the
ciphertext (or swapping in a ciphertext encrypted with a different
key) fails decryption with a clear error rather than producing
garbage plaintext. Wire format is:

```
base64( IV (12 bytes) ‖ authTag (16 bytes) ‖ ciphertext )
```

The IV is fresh-random per call so two encryptions of the same
plaintext produce different ciphertexts. Verified by
`src/server/integrations/__tests__/crypto.test.ts`.

---

## Inserting a Live Data Source via CLI (development)

For dev setup, credential rotation, or bulk imports, use the
stdin-piped CLI helper:

**PowerShell:**

```powershell
$pw = Read-Host -AsSecureString "Password"
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw))
echo $plain | npx tsx scripts/insert-live-data-source.ts `
  --tenant-slug wbp --type ODOO --name "WBP Production Odoo" `
  --url https://wbp.tayssir-erp.dz `
  --database wbp.tayssir-erp.dz `
  --username [user-email] `
  --password-from-stdin --brand-field marque_id
```

**Bash:**

```bash
read -s -p "Password: " pw && echo
echo "$pw" | npx tsx scripts/insert-live-data-source.ts \
  --tenant-slug wbp --type ODOO --name "WBP Production Odoo" \
  --url https://wbp.tayssir-erp.dz \
  --database wbp.tayssir-erp.dz \
  --username [user-email] \
  --password-from-stdin --brand-field marque_id
```

The password reads from stdin; it never appears in shell history,
process listings, or environment dumps. The script encrypts with
`LIVE_DATA_ENCRYPTION_KEY` before insertion. The new row lands with
`status = PENDING_TEST` — the next cron run promotes it to
CONNECTED on a successful sync, or ERROR with `lastSyncError` set.

To trigger the first sync immediately (instead of waiting for the
cron):

```bash
curl -X POST http://localhost:3000/api/cron/sync-live-data \
  -H "Authorization: Bearer $CRON_SECRET"
```

---

## What's stored vs what's not

**Stored encrypted (in `LiveDataSource.encryptedConfig`):**
- Odoo URL, database, username, password
- Optional `additionalFields.brandField` (column name on Odoo's
  `product.template` that holds the brand many2one — typically
  `marque_id` for Tayssir-wrapped Odoo, or just `brand` on stock
  Odoo).

**Stored cleartext (in `LiveDataSource` columns):**
- Operator-supplied label (`name`)
- Status, last-synced-at, last-error, record count
- Type enum (ODOO, etc.)

**Never stored anywhere, ever:**
- Cleartext password in any column
- Cleartext config in logs / API responses / error messages /
  test fixtures / console output
- The encryption key itself

The crypto module's `decryptConfig()` is the single chokepoint that
materializes plaintext, and it only does so during the seconds-long
window of an active sync or test-connection call. Audit any new code
path that touches `encryptedConfig` to confirm it doesn't leak.

---

## Adapter dispatch (forward-looking)

`src/server/integrations/dispatch.ts` switches on
`LiveDataSource.type` to pick the adapter. Adding a new adapter is:

1. New folder under `src/server/integrations/<type>/` with `client`,
   `models`, `sync`, `test-connection`, `index` files.
2. New case in `dispatch.ts`'s switch.
3. New enum value on `LiveDataSourceType` (already reserved).
4. New connect modal + Server Action under
   `src/components/app/live-data/`.
5. Optional: new `additionalFields` shape if the type needs more
   than url/db/user/pw.

No core code in this file changes. The encryption layer, the cron
route, the dispatch switch, the source-card UI, and the brain's
KnowledgeItem retrieval all stay the same.
