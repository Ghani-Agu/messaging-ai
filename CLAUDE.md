# CLAUDE.md

Operating instructions for Claude Code working on `messaging-ai`.

---

## 1. Source of truth

**[`MASTER_PLAN.md`](./MASTER_PLAN.md) is the single source of truth for this entire project.**

Read it in full at the start of every session before writing any code. Specifically know:

- §3 — locked tech stack (no substitutions without explicit approval)
- §4 — design system (Direction A: Linear-inspired, dark default, electric violet `#7C3AED`)
- §5 — folder structure
- §6 — full v1 database schema
- §9 — phase-by-phase deliverables and acceptance criteria
- §10 — exact phase-prompt format the project lead pastes for each phase
- §11 — required environment variables
- §13 — hard "never do" list

When `MASTER_PLAN.md` and any other document disagree, MASTER_PLAN wins. When MASTER_PLAN is silent on a decision, **stop and ask** — do not guess.

Updates to MASTER_PLAN require explicit project-lead approval. Record those updates in the file with a one-line note above the changed section if needed.

---

## 2. How phases work

Each phase prompt in MASTER_PLAN §10 starts with `Read MASTER_PLAN.md fully. Execute Phase N.` and includes one or more **approval gates**: "show me X before building Y." Honor those gates literally — produce the proposal, stop, wait.

Workflow per phase:

1. Read `MASTER_PLAN.md` end-to-end.
2. Produce the requested proposal (folder tree, tokens, schema, mockups, etc.).
3. Wait for approval. Do not write any project code before approval lands.
4. Build in small, reviewable steps.
5. **Commit after every meaningful step** using conventional commit prefixes (`feat:`, `fix:`, `chore:`, `docs:`, `style:`, `refactor:`, `test:`, `build:`, `ci:`, `perf:`). Never bundle a phase into a single terminal commit.
6. Run typecheck + lint before reporting completion.
7. Demonstrate acceptance criteria (run the dev server, hit the page, etc.).
8. Update CLAUDE.md if conventions changed; update MASTER_PLAN only with project-lead approval.

---

## 3. Hard rules (also see MASTER_PLAN §13)

- Never deviate from the locked stack without explicit approval.
- Never skip approval gates.
- Never commit secrets to git. `.env.local` is gitignored; only `.env.example` is committed.
- Never disable type checking or ESLint to "make it work."
- Never use `any` without a comment explaining why.
- Never write a chatbot reply prompt without language detection + brand-voice injection (Phase 4+).
- Never make a Prisma query without going through `src/server/db/` helpers.
- Never call an LLM API directly outside `src/server/ai/`.
- Never trust client-provided `tenantId`.
- Never hard-code colors, font sizes, spacing, or motion values — always use the design tokens (`src/app/globals.css` for CSS, `src/lib/design-tokens.ts` for JS, `src/lib/motion.ts` for animations).
- Never expose a streaming endpoint as `GET + EventSource`. Always `POST + ReadableStream` with SSE-shaped data (`data: { ... }\n\n` framing for `delta` and `done` events). Settled twice in Phase 5: POST keeps tenant slug / auth headers / structured request body intact, and the data-events shape lets the client demux without reconnect logic.
- Never write a concurrent upsert against a unique-keyed table without wrapping in `withP2002Retry` (`src/server/db/conversations.ts`). The race is real for any `(tenantId, channelType, externalId)` upsert under Phase 6/7 channel adapters — two simultaneous first-time messages from the same brand-new customer can both take the `!exists` branch and one gets `P2002`. Second attempt sees the committed row and goes down the update branch.
- Never bypass security paths in stub channel adapters. Channel adapters follow the `StubXClient` / `RealXClient` / `getXClient(channel)` factory pattern (mirrors the `ClaudeClient` shape from §7a). Proven across three channels by Phase 7: WhatsApp via 360dialog (Phase 6), and Messenger + Instagram via the Meta Graph API (Phase 7). Stubs must exercise the **full** security path — sign payloads with real HMAC against a real (stub) secret, round-trip the encrypted-credentials envelope, validate signatures the same way the real implementation will. The "always return true on signature verify in stub" pattern hides regressions until production. Real-API swap at credential time is a single env-var change per channel family — for example `WHATSAPP_USE_STUB` / `WHATSAPP_360DIALOG_API_KEY` for WhatsApp, `META_USE_STUB` / `META_APP_ID` / `META_APP_SECRET` for both Meta channels (a single Meta App authorizes both Messenger and Instagram on a linked Page).
- Never assume `formData.get(key) ?? undefined` is unnecessary in Server Actions feeding Zod schemas. `FormData.get()` returns `null` for absent keys, but `z.string().optional()` accepts only `undefined` or missing — `null` triggers a "Required" path error and the schema fails. Coerce with `?? undefined` at the parse site for any optional FormData field (especially checkbox-style fields where "absent → unchecked" is normal). Hit during Phase 7e Server Action wiring on the `connectInstagram?` checkbox; tests for "only Messenger selected" / "neither selected" failed with a generic schema error until the coercion landed.
- Never `git add -A` blindly — `.claude/`, `.env.local`, and other locals can sneak in. Stage by path.
- Never `git commit --amend` or `--no-verify` without explicit project-lead approval.

---

## 4. Conventions

- **TypeScript:** strict + `noUncheckedIndexedAccess`. `import type` for type-only imports (auto-fixed by `consistent-type-imports`).
- **Server vs. client:** server-only files under `src/server/**` are never imported by `"use client"` components. App code reaches the database through `src/server/db/`, LLMs through `src/server/ai/`.
- **`src/lib/` vs `src/server/db/` split (Phase 8 standing rule):** anything a client component reaches must NOT live in a `"server-only"` module. Next.js's bundler trips the server-only guard on `import type` paths too — type erasure happens after the import graph is resolved, so a client component reading a `import type { Foo } from "@/server/db/x"` still triggers the runtime error. We've hit this three times (Phase 8b OperationalFacts, Phase 8c Items, would have hit it again with Q&A). The standing fix:
  - `src/lib/<feature>.ts` — Zod schemas, types, pure helpers (no Prisma, no `"server-only"`). Imported by both client components and server code.
  - `src/server/db/<feature>.ts` — Prisma calls, raw SQL, side-effecting helpers. Marked `"server-only"`. Re-exports the schemas/types from `src/lib/` for source-compat with existing server-side callers (orchestrator, workers, Server Actions).
  - When you create a new typed-knowledge or operator-facing entity, default to the lib/server split from the start. Don't wait for the bundler to catch it.
  - References: `src/lib/operational-facts.ts` ↔ `src/server/db/operational-facts.ts`, `src/lib/items.ts` ↔ `src/server/db/items.ts`.
- **Styling:** Tailwind v4 CSS-first. Tokens defined in `src/app/globals.css` via `@theme inline`. There is no `tailwind.config.ts` (this is a Phase 1 deviation from MASTER_PLAN §5; the deviation is recorded there).
- **Class strings:** must be statically detectable by Tailwind's content scanner. No `` `text-${variant}` ``. Use literal class maps for variants.
- **Components:** `forwardRef` + `displayName`. CVA for variants. shadcn/ui patterns, but always restyled to the design tokens — no out-of-the-box shadcn look anywhere.
- **Motion:** import easing/duration constants from `src/lib/motion.ts`. No inline `[0.4, 0, 0.2, 1]` curves anywhere else.
- **Validation:** Zod everywhere user input crosses a trust boundary.
- **Commits:** conventional commits, granular, per meaningful step.

---

## 5. Local development environment

Local dev uses Supabase exclusively for Postgres (and any future Redis / queue infrastructure will be sourced from a hosted provider too) — Docker Desktop is not required for any phase through 10.

---

## 6. Setup gotchas

Things that bit us once and would bite again. Read before fighting tooling.

### Supabase: direct host is IPv6-only on the free tier

`db.<project>.supabase.co` resolves to IPv6 only on the free plan. Most home/ISP networks (and Windows + most VPNs) can't reach it. Symptom: Prisma migrations fail with `P1001: Can't reach database server`.

Fix: both `DATABASE_URL` and `DIRECT_DATABASE_URL` must use the **pooler** hostname (`aws-<n>-<region>.pooler.supabase.com`), just on different ports:

| Var | Port | Mode | Required params |
|---|---|---|---|
| `DATABASE_URL` | 6543 | transaction (pgbouncer) | `?pgbouncer=true&connection_limit=1` |
| `DIRECT_DATABASE_URL` | 5432 | session | none |

Username on both is `postgres.<project_ref>` (the form with the dot). Password is the same. Copy from Supabase Dashboard → Project Settings → Database → "Connection string" → Session pooler / Transaction pooler tabs.

### Supabase: pre-installed extensions cause Prisma drift

Supabase pre-installs six extensions across three schemas: `pg_stat_statements`, `pgcrypto`, `uuid-ossp` in `extensions`; `supabase_vault` in `vault`; `vector` (pgvector) and `plpgsql` in `public` / `pg_catalog`. If `prisma/schema.prisma` doesn't declare them with the right schema annotations, `prisma migrate dev` reports drift and wants to reset the public schema.

What works:

```
extensions = [
  pg_stat_statements(schema: "extensions"),
  pgcrypto(schema: "extensions"),
  plpgsql,
  supabase_vault(schema: "vault"),
  uuid_ossp(map: "uuid-ossp", schema: "extensions"),
  vector
]
```

(Single line in the actual schema.prisma — Prisma's parser doesn't accept multi-line array literals here.)

Plus: the init migration's SQL must `CREATE SCHEMA IF NOT EXISTS "extensions"` and `CREATE SCHEMA IF NOT EXISTS "vault"` **before** the `CREATE EXTENSION ... WITH SCHEMA` statements — Prisma's shadow database is bare, so it needs those schemas to exist before extensions can be installed into them. Otherwise the shadow replay fails with `P3006`.

`scripts/inspect-extensions.mjs` lists every extension and its schema as installed on the live DB — useful for diagnosing future drift.

### Prisma + .env.local

Prisma's CLI only reads `.env`, not Next.js's `.env.local`. All `db:*` npm scripts wrap with `dotenv -e .env.local --` so they pick up the right URLs. Don't run bare `prisma migrate dev` — use `npm run db:migrate` instead.

### Prisma can't express pgvector HNSW indexes

Prisma 6.1's `@@index(type: ...)` accepts only `BTree | Hash | Gist | Gin | SpGist | Brin`. There is no `Hnsw`. Our HNSW index on `KnowledgeChunk.embedding` is created via raw SQL inside `20260427235200_add_knowledge_models/migration.sql` and is invisible to PSL. `prisma migrate diff` will permanently report:

```
[*] Changed the `KnowledgeChunk` table
  [+] Added index on columns (embedding)
```

That gap is intentional — do **not** "fix" it by adding a non-HNSW `@@index([embedding])` (Prisma would then try to drop our HNSW index and create a useless BTree one). When generating future migrations, always use `npm run db:migrate -- --create-only --name <name>`, and **delete any `DROP INDEX "KnowledgeChunk_embedding_hnsw"` line** Prisma slips into the generated SQL before applying. Our `scripts/verify-knowledge-schema.mjs` confirms the index is still present after each migration.

The same script checks the GENERATED `searchVector` column — also added via raw SQL since Prisma's `@default(dbgenerated(...))` doesn't actually emit `GENERATED ALWAYS AS ... STORED`. Run it whenever the Knowledge schema changes.

### Phase 3 / 8a: knowledge migration workflow

For any change touching `KnowledgeChunk` / `KnowledgeSource` / `KnowledgeItem` / `QnaPair` / `OperationalFacts` / `KnowledgeGap`:

1. Edit `prisma/schema.prisma`.
2. `npm run db:migrate -- --create-only --name <descriptive-name>`.
3. Open the generated `migration.sql`. Strip any `DROP INDEX` line targeting one of the names in the strip list above (they come from PSL/DB drift, not your edit). Strip any `ALTER COLUMN "searchVector"` Prisma slips in.
4. Add custom raw SQL for any new HNSW / GENERATED column work.
5. `npm run db:migrate` to apply.
6. Run BOTH verify scripts to confirm:
    - `npx dotenv -e .env.local -- node scripts/verify-knowledge-schema.mjs` (Phase 3 — KnowledgeSource/Chunk).
    - `npx dotenv -e .env.local -- node scripts/verify-typed-knowledge-schema.mjs` (Phase 8a — Item/QnaPair/OpFacts/Gap).

**Phase 8a recovery note: when migrate-dev refuses on the Phase 7a checksum drift,** use `prisma migrate diff --from-schema-datasource ... --to-schema-datamodel ... --script` to generate the SQL (read-only, no shadow DB, no drift prompt, no pre-flight pending-apply pass). Then hand-write the migration directory and apply via `db:migrate:deploy`. Reference: `20260430000000_phase8a_typed_knowledge_tables/migration.sql` was generated this way and documents the three deviations that had to be applied on top of the diff (strip DROP INDEX, hand-write the GENERATED ALWAYS clause for `KnowledgeItem.searchVector`, append HNSW indexes).

### Prisma migrate dev: drift prompt + DROP INDEX inspection

Two interactive surprises around `prisma migrate dev`. Both stem from the same root cause as the HNSW section above: PSL doesn't model HNSW indexes or partial-unique-on-JSON, so the live DB will *always* look "drifted" to Prisma's diff engine.

**The drift-fix prompt — always Ctrl+C.** When `prisma migrate dev` detects schema/DB drift it asks interactively whether to "create a drift fix migration." **Skip with Ctrl+C every time.** Accepting it generates a `DROP INDEX "KnowledgeChunk_embedding_hnsw"` (and would happily target any future raw-SQL index the same way) — applying that wipes irreplaceable indexes that took minutes to rebuild against the embedded corpus. The drift is intentional; the live DB state is correct. To verify migrations applied without invoking the drift detector, use one of:

- `npx dotenv -e .env.local -- prisma migrate status` — read-only, no shadow DB, no prompts.
- `npm run db:migrate:deploy` — applies pending migrations only; no drift check, no shadow DB.

**Generated SQL inspection — standing rule for every new migration.** Every `prisma migrate dev --create-only` run can slip a `DROP INDEX` line targeting any PSL-invisible raw-SQL index into the generated `migration.sql`. Before `npm run db:migrate`, open the migration and strip any `DROP INDEX` line that targets one of:

- `KnowledgeChunk_embedding_hnsw` — HNSW on `KnowledgeChunk.embedding` (Phase 3).
- `Channel_widget_publicKey_unique` — partial unique on `config->>'publicKey'` where `type='WIDGET'` (Phase 6).
- `Channel_whatsapp_phoneNumberId_unique` — partial unique on `config->>'phoneNumberId'` where `type='WHATSAPP'` (Phase 6a).
- `Channel_messenger_pageId_unique` — partial unique on `config->>'pageId'` where `type='MESSENGER'` (Phase 7a).
- `Channel_instagram_igUserId_unique` — partial unique on `config->>'igUserId'` where `type='INSTAGRAM'` (Phase 7a).
- `KnowledgeItem_embedding_hnsw` — HNSW on `KnowledgeItem.embedding` (Phase 8a).
- `QnaPair_questionEmbedding_hnsw` — HNSW on `QnaPair.questionEmbedding` (Phase 8a).
- `KnowledgeGap_embedding_hnsw` — HNSW on `KnowledgeGap.embedding` (Phase 8a).
- Any future raw-SQL index added the same way — when you add one, add it to this list too.

In current observed behavior, only the HNSW index actually triggers a generated `DROP INDEX` line (the partial-unique-on-JSON ones are "missing in PSL but not extra in DB" from Prisma's perspective, so the diff engine doesn't try to drop them). The other entries are defensive — if Prisma's diff behavior changes or some edge case generates a drop for them, the rule covers it before destructive damage.

When you strip a line, leave a one-line `-- INTENTIONAL: do not drop <index name> — managed via raw SQL` comment in its place so a future maintainer doesn't undo the strip. The verify scripts (`scripts/verify-knowledge-schema.mjs`, `scripts/verify-channels-schema.mjs`) catch missed strips after apply and should be run after every migration.

**Recovery: pgbouncer-pooled session holds the advisory lock after Ctrl+C.** Hit during Phase 6a. `prisma migrate dev` takes a session-level advisory lock (`pg_advisory_lock(72707369)`) before running. If you Ctrl+C the drift prompt (per the rule above), the OS-level node process dies, but its pgbouncer-pooled DB session does not — the lock survives in the pooled session. Subsequent `db:migrate:deploy` / `db:migrate` calls then fail with `P1002: Timed out trying to acquire a postgres advisory lock`. Recovery options:

- `npx dotenv -e .env.local -- node scripts/release-migrate-lock.mjs` — identifies any session in `pg_locks` holding objid=72707369 and `pg_terminate_backend`s it. Fast.
- Wait for Supavisor's idle timeout (~10 min) and retry.

**Recovery: migrate-dev pre-flight applies pending on-disk migrations destructively.** Hit during Phase 7a, root cause of the corrective `20260429020000_phase7a_corrective_restore_hnsw_add_meta_indexes` migration. The full sequence that bit:

1. `npm run db:migrate -- --create-only --name add_meta_routing` generated `20260429014012_add_meta_routing/migration.sql` with a spurious `DROP INDEX "KnowledgeChunk_embedding_hnsw"` line at the top.
2. The drift prompt fired; we Ctrl+C'd it. The flawed migration file was NOT yet applied — but it was **on disk** in `prisma/migrations/`.
3. The next `npm run db:migrate` invocation runs a pre-flight pass that **applies any pending on-disk migration before generating the next one**. The pre-flight applied the flawed migration as-is, dropping the HNSW index destructively before we ever got the chance to strip the line.

**Standing rule.** After Ctrl+C-ing the drift prompt:

- **Inspect `prisma/migrations/` for any newly-created directory.** If found (it usually is — `--create-only` always writes the file), strip the spurious `DROP INDEX` line per the strip list above before doing anything else.
- **Use `npm run db:migrate:deploy` (not `migrate dev`) to apply** the corrected file. `migrate:deploy` skips the pre-flight pending-migration scan and the drift detector; it just applies what's on disk in order.
- Only after the corrected file applies cleanly should you run `migrate dev` again for the next change.

If the destructive apply already ran (HNSW index gone, vector queries returning empty results / sequential scans), the recovery is a corrective hand-rolled migration that re-creates the index — see `20260429020000_phase7a_corrective_restore_hnsw_add_meta_indexes/migration.sql` for the template. Rebuilding the HNSW index on the embedded corpus takes 1-2 minutes; not catastrophic but not zero either.

### Phase 6: widget public-key partial unique index is invisible to Prisma

The same PSL gap that hides the HNSW index also hides the partial unique index on the widget's public key. The lookup the widget API runs on every request — `WHERE ("config"->>'publicKey') = $1 AND "type"='WIDGET'` — is served by:

```
CREATE UNIQUE INDEX "Channel_widget_publicKey_unique"
    ON "Channel" (("config" ->> 'publicKey'))
    WHERE "type" = 'WIDGET' AND ("config" ->> 'publicKey') IS NOT NULL;
```

PSL can't model this — Prisma's `@@unique` doesn't accept JSON path expressions, and partial-WHERE by enum value isn't supported either. The index is created via raw SQL appended to `20260428205650_add_channel_models/migration.sql` (same pattern as the HNSW index in `20260427235200_add_knowledge_models`).

**Standing rule when generating future migrations:** every `prisma migrate dev --create-only` run will slip a `DROP INDEX "KnowledgeChunk_embedding_hnsw"` line into the generated SQL — strip it. (The widget public-key index is only "missing" from PSL, not "extra in DB", so Prisma doesn't try to drop it; only the HNSW one needs stripping.) `scripts/verify-channels-schema.mjs` confirms the partial unique index is present and that the planner picks it for the widget public-key lookup (EXPLAIN with `enable_seqscan=off`); run it whenever the Channel schema changes.

Same workflow as Phase 3: `npm run db:migrate -- --create-only --name <name>`, edit, `npm run db:migrate` to apply, then run both verify scripts.

### Webhook security checklist (Phase 6+ inbound webhooks)

Standing rules for every inbound webhook handler in this codebase. Followed by the WhatsApp ingress (`src/app/api/whatsapp/webhook/route.ts`) and the Meta ingress (`src/app/api/meta/webhook/route.ts`).

1. **`req.text()` once, before HMAC.** Read the raw body as a string exactly once and parse it via `JSON.parse` from that string. Never call `req.json()` (or any parse-then-stringify dance) before signature verification — re-stringifying produces a different byte sequence and the HMAC fails.
2. **`crypto.timingSafeEqual` for signature comparison.** Never plain string `===` on the hash bytes. Length-check first (`timingSafeEqual` throws on length mismatch); the check is itself constant-time relative to header content.
3. **5-minute replay window.** Each inbound message / status carries a unix timestamp (seconds for WhatsApp, milliseconds for Meta); reject anything outside `±5 min` from `now`. Not crypto-strong (an attacker with a leaked signature can still replay within 5 min) but raises the bar against passive signature leak attacks.
4. **Channel-resolution ordering depends on whether the secret is per-channel or global.** Two patterns coexist:
   - **Per-channel-secret scheme (WhatsApp via 360dialog, Phase 6).** Each Channel row stores its own `webhookSecret` in the encrypted credentials envelope. The handler must resolve the Channel from the routing field in the payload (`phone_number_id`) BEFORE signature verification — the secret to compare against lives on the row. **Order: lookup first → 404 on miss with no HMAC computed → decrypt → HMAC verify.** 404 on lookup miss avoids leaking channel existence via response timing (a 401 would prove the routing key matched a known channel but the signature was wrong).
   - **Global-secret scheme (Meta Graph for Messenger + Instagram, Phase 7).** `META_APP_SECRET` is an env var, identical for every Channel routed by a given Meta App. The handler **must** verify HMAC FIRST with the global secret, then resolve the Channel from the payload, then **200-ack + structured-log + drop** on unknown routing key. **Order: HMAC verify first → 401 on miss → JSON parse → channel lookup → 200+log+drop on unknown.** 200 (not 404) on lookup miss because Meta forwards events from any subscribed Page, including ones we may have disconnected; 4xx makes Meta retry indefinitely. The HMAC-first order is correct here precisely because the secret is channel-agnostic — no per-channel state to wait for. Implemented in `src/app/api/meta/webhook/route.ts` per Gate 1 H4.
5. **Idempotency dedupe by `providerMessageId` before `recordInboundMessage`.** Webhook providers retry on 5xx (sometimes on slow 2xx too). The `Message_tenantId_providerMessageId_idx` composite from Phase 6a serves the lookup.
6. **No bypass on stub.** The stub channel adapter signs with real HMAC against a real (stub) secret — stored in the encrypted credentials envelope for per-channel-secret schemes, or returned by `getMetaAppSecret()`'s dev fallback for the global-secret scheme. The route's verification path is exercised in dev exactly as it will be in prod — see §3 "stub→real swap" rule.
7. **Per-message dispatch failure ≠ batch failure.** A malformed message in a batched payload shouldn't cause the whole batch to retry — log the failure, continue. Idempotency catches dupes on retry of the WHOLE batch (which the provider will also do).

### Auth-gated test inspection: forging JWT cookies (NextAuth v5)

NextAuth v5 in this project uses `session.strategy: "jwt"` (see `src/server/auth/config.ts`) — sessions live entirely in a signed JWT cookie, NOT in the `Session` DB table. Inserting a row in `Session` does NOT produce a working auth cookie.

To drive auth-gated pages from `curl` in test/verification scripts (e.g. the Phase 6 verification pass), forge a JWT directly:

1. Look up the user via Prisma.
2. Use `next-auth/jwt`'s `encode({ token, secret, salt, maxAge })` with `secret = process.env.NEXTAUTH_SECRET` and `salt = "authjs.session-token"` (the dev/HTTP cookie name).
3. The `token` payload must include `sub`, `id`, `email`, `name`, `isSuperAdmin` — matches the shape the `jwt()` callback emits after a real login, and the shape the `session()` callback in `src/server/auth/config.ts` reads.
4. Send the result as `Cookie: authjs.session-token=<jwt>` on every request. (HTTPS deployments use `__Secure-authjs.session-token`.)

Dev minted a 24h JWT; the dev server validated it and rendered the auth-gated `/channels` and `/conversations` pages identically to a real session. Useful for CI and curl-based verification harnesses; not committed (the script that does it is a one-off, not infrastructure). Reference: the deleted `scripts/test-phase6-mint-jwt.ts` from the Phase 6 verification pass — pattern only, file no longer in tree. Phase 7's `scripts/verify-phase7.ts` (next subsection) uses the same JWT-forging pattern in step 8.

### Phase verification harnesses

`scripts/verify-knowledge-schema.mjs` — Phase 3 schema check (KnowledgeSource, KnowledgeChunk, HNSW + GIN, GENERATED searchVector). Run after any migration touching these tables.

`scripts/verify-typed-knowledge-schema.mjs` — Phase 8a schema check (KnowledgeItem, QnaPair, OperationalFacts, KnowledgeGap; weighted GENERATED searchVector on KnowledgeItem; HNSW on the three new vector columns; composite UNIQUEs). Run alongside the Phase 3 verifier after any migration touching the typed-knowledge tables.

`scripts/verify-phase7.ts` — 8-step end-to-end check that exercises the full Messenger + Instagram pipeline against stubs. Run via `npm run verify:phase7`. Pre-requisites: dev server running, `.env.local` has `ENCRYPTION_KEY` + `META_VERIFY_TOKEN` + `DEV_WEBHOOK_SIMULATOR=enabled` + `META_USE_STUB` unset or `true`. After real Meta credentials arrive, the same harness validates the real-API integration — swap `META_USE_STUB=false` / `META_APP_ID=<real>` / `META_APP_SECRET=<real>` in `.env.local` and re-run. The script itself is the source of truth for the verification rules; this section is just a discoverability pointer.

### Long-running workers + third-party HTTP clients

We hit a Phase-3 incident where the BullMQ worker began failing every Firecrawl crawl with `connect ETIMEDOUT 35.245.250.27:443`, while `curl` from the same machine returned 200 in <1 s. Root cause was specific to the SDK transport, not the network:

- `@mendable/firecrawl-js` 4.x uses axios with no default timeout on the legacy v1 path (`postRequest` only sets `timeout` when the caller passes `params.timeout`).
- axios with no explicit agent reuses Node's `https.globalAgent` keepalive pool. In a long-lived worker, that pool collects sockets the upstream LB has already half-closed. The next axios call reuses one, the write hangs, and Node waits for the OS-level TCP retransmit (~75–120 s on Windows) before surfacing as ETIMEDOUT.

Fix: replace the SDK with native `fetch` + `AbortSignal.timeout()`. Diagnostic + write-up: `scripts/firecrawl-diag.ts`. Upstream issues with the same fingerprint: firecrawl/firecrawl#1912, #2185, #2280.

**Standing rule for this codebase (worker scope):** any HTTP call from a **long-lived worker process** — `scripts/worker.ts` and any BullMQ processor it spawns, or any code path reachable from one — uses native `fetch` with an explicit `AbortSignal.timeout()`. No third-party HTTP-client SDKs in workers (axios, got, superagent, ky, openai-style SDK transports, …). Wrap providers ourselves the way `crawler.ts` and `parser.ts` do, and route 4xx (except 429) through `PermanentError` from `src/server/knowledge/errors.ts` so BullMQ stops retrying. Everything else (5xx, 429, network, AbortError) stays a plain `Error` and gets the existing `attempts: 5` retry budget.

**Request-scoped exception (Gate-1 K2 — Phase 4 resumption).** The keepalive-pool failure mode is specific to long-lived processes that hold sockets open across many requests. Next.js route handlers and Server Actions are short-lived per request — sockets close with the response — so the failure mode does not apply. **Anthropic calls via `@anthropic-ai/sdk` are allowed in request-scoped code only**: `src/server/ai/real-claude-client.ts` (consumed by `runBrain` from API routes + Server Actions), but never from `scripts/worker.ts` or any BullMQ processor. If a future worker needs to call Claude, it MUST go through native `fetch` + `AbortSignal.timeout()` per the worker rule, not the SDK. The SDK exception is a single, named, audited boundary; it does not generalize.

When this section grows large, group by tool.

---

## 7. Phase-1 deviations from MASTER_PLAN

Recorded in MASTER_PLAN §5. Summary:

- Tailwind v4 is configured CSS-first (`@theme inline` in `src/app/globals.css`) instead of via `tailwind.config.ts`. Approved by project lead before Phase 1 build.

---

## 7a. Phase 4 split — partial build, resumption in progress

**Status (2026-05-03):** Phase 4 was executed only partially during the original build pass — Anthropic credits were unavailable at the time. The pure-logic pieces shipped, then the project moved through Phases 5–8 against the StubClaudeClient. Anthropic credits are now live (`ANTHROPIC_API_KEY` in `.env.local`). Phase 4 is being resumed in 6 commits (P4r-1 through P4r-6) following the Gate-1 plan in `docs/` (or this section's Deferred subsection below). P4r-1 (Foundation) lands first; later commits gate on project-lead review.

**Model pin (Gate-1 K1):** `ANTHROPIC_MODEL_DEFAULT = "claude-sonnet-4-6"` (alias) in `src/server/ai/anthropic-config.ts`. Override via `ANTHROPIC_MODEL` in `.env.local`. Anthropic does not currently expose a dated snapshot for Sonnet 4.6 in the public model list (`scripts/list-anthropic-models.ts` returns the alias only); when a dated handle becomes available, pin it via env override or update the default. Pricing in `src/server/ai/pricing.ts` strips trailing `-YYYYMMDD` suffixes and falls back to the family alias, so a future dated pin works without a pricing-table edit unless rates change.

**Block A / Block B cache invalidation cost (Gate-1 B).** Once prompt caching lands in P4r-3, every byte-level edit to `BLOCK_A_TEXT` (in `src/server/ai/prompts/system.ts`) invalidates the cached prefix process-wide; every same-tenant edit that propagates into Block B invalidates that tenant's cache. The next first-call after each invalidation eats the cache-write surcharge (input tokens × 1.25 for the 5-min ephemeral TTL) — a one-time cost per invalidation event, paid by whichever tenant's conversation lands first. If you're tuning Block A iteratively during eval, every iteration costs every active tenant +25% input tokens on their next first conversation. Plan accordingly.

**CI must not have ANTHROPIC_API_KEY in test secrets (Gate-1 K9).** When CI lands (post-Phase 9), the test job's environment must NOT include `ANTHROPIC_API_KEY`. The `getClaudeClient` factory has a `VITEST=true` guard that returns the stub even when the key is set — but defense in depth: keep the key out of CI test scope so an environmental drift never burns credits via accidental real-API hits.

**`[brain-cost]` log volume in high-traffic production.** Each successful `runBrain` call emits a `[brain-cost]` line. At v1 scale this is fine — operators want every cost visible. As traffic grows the log volume becomes noise. Future work (Phase 10 observability or earlier if needed): introduce sampling/filtering — e.g., emit one `[brain-cost]` per N calls + always log calls where retries > 0 or cost exceeds an absolute threshold. The Phase 9 per-tenant rollup table (deferred from K6) eventually replaces the log line as the source-of-truth for billing-grade cost tracking; until then, the structured one-liner is what we have.

**`ClaudeClient` interface is stable after P4r-4.** P4r-3 attempted a contract change (split `reply` into natural content + metadata tool); P4r-4 reverted it after the schema probe found it incompatible with Sonnet 4.6's forced tool_use. The current `ClaudeClient` / `SendReplyArgs` / `SendReplyResult` shape — single tool, reply inside `toolArgs.reply` — is now stable. P4r-5 (smart-import real wiring) and P4r-6 (eval harness) consume the existing surface. Any future shape change is a breaking change to every call site (orchestrator, smart-import action, route handler, tests) and must be gated by an explicit Gate-1.

**Real-API probe scripts + eval harness.** Four reusable diagnostics gated on `ANTHROPIC_API_KEY`:
- `npm run probe:schema` (~$0.003) — single Sonnet call, validates the tool_use response shape (reply / language / groundedness / citations_used / escalation_recommended). Run after any change to `BLOCK_A_TEXT`, `SEND_REPLY_TOOL`, or `RealClaudeClient.sendReplyOnce`.
- `npm run probe:cache` (~$0.006) — seeds the acme tenant with substantial voice profile + tier-1 facts, runs two consecutive `runBrain` calls, verifies `cache_creation_input_tokens > 0` on turn 1 and `cache_read_input_tokens > 0` on turn 2. Failure mode is documented in P4r-5 above.
- `npm run probe:smart-import` (~$0.005) — sends realistic messy FR catalog at `structureItemsFromText`, prints extracted items for human quality review. Gates on shape only (every item has a name); quality is subjective. Run after `SMART_IMPORT_SYSTEM_PROMPT` or `SEND_STRUCTURED_ITEMS_TOOL` changes.
- `npm run brain:eval` (~$0.05–0.10/run) — full 11-row regression bank against the active model. Switch models via `--model claude-sonnet-4-5`. Default report goes to `eval/reports/{ts}-{model}.json`; baseline diff against most-recent prior report for the same model auto-runs. Run after Block A/B prompt changes, model swaps, or before deciding cache-vs-quality trade-offs (see P4r-6 above).

**Smart-import quality requires manual review.** Stub `structureItemsFromText` and real Claude diverge most here — the stub does pattern-matching against keywords, real Claude does actual extraction with reasoning over the messy text. After any prompt change, run `npm run probe:smart-import` and eyeball the items: currency picks, availability mapping ("rupture de stock" → OUT_OF_STOCK, "2 disponibles" → LOW_STOCK), spec extraction (concrete key/value pairs only, no marketing copy as specs), notes field (does Claude surface ambiguous decisions to the operator?). Vitest tests cover shape (call args, retry behavior, error mapping) but cannot grade extraction quality.

**Synthetic streaming is the v1 design.** `RealClaudeClient.streamReply` chunks the complete reply text after the SDK call returns, rather than streaming tokens as Claude generates them. Forced tool_use means there's no text content to stream incrementally — Claude builds the JSON tool-args server-side and emits the complete block at the end. The chunked-after-the-fact UX is fine for typical 50–200 word support replies; the customer sees deltas at ~30–50ms cadence, indistinguishable from real streaming for replies of this length. Revisit only if a future use case (long-form replies, real-time agent assist, etc.) actually needs per-token streaming. If/when revisited: the architectural alternatives explored at P4r-3 (reply-as-content + metadata-tool split, two-call approach, partial-JSON streaming via `input_json_delta` with `eager_input_streaming`) are all options.

### Done in Phase 4 partial

- **Voice profile schema** (`src/lib/validators.ts`): Zod-validated `VoiceProfile` inside `Tenant.settings.voiceProfile`. Defaults applied on tenant creation; `prisma/seed.ts` retrofits any tenant whose settings is missing the field.
- **System-prompt builders** (`src/server/ai/prompts/system.ts`): Block A (platform rules, 594 tokens, vitest-asserted ≤ 800), Block B (per-tenant identity + voice + few-shot), Block C (runtime: citations + history + new message). `buildPrompt()` returns the multi-block array shape so Anthropic prompt caching (`cache_control: ephemeral`) is a one-line annotation later.
- **Confidence formula** (`src/server/ai/confidence.ts`): deterministic post-tool-call computation — weights confirmed by project lead. `decideEscalation()` overrides Claude's choice with `LOW_CONFIDENCE` below the 0.6 threshold; original reason preserved in `Message.aiMetadata`.
- **ClaudeClient interface** (`src/server/ai/claude-client.ts`): `ClaudeClient` interface, `SEND_REPLY_TOOL` JSON Schema, `StubClaudeClient` (deterministic canned shapes — happy path / OUTSIDE_SCOPE / EXPLICIT_REQUEST / PAYMENT_DISPUTE), `getClaudeClient()` factory. **The boundary the resumption swap touches.**
- **Orchestrator** (`src/server/ai/orchestrator.ts`): full `runBrain()` pipeline — load tenant → retrieve → build prompts → input-budget guard → `client.sendReply()` → compute confidence → decide escalation → shape `BrainResult`. End-to-end tested against the stub.
- **Vitest** alias `@/*` → `./src/*` wired so source files using the alias load identically under tests and Next.js.

### Resumption commits (P4r-1 through P4r-6)

P4r-1 — **Foundation (this commit).** Pricing table (`src/server/ai/pricing.ts` — Sonnet/Haiku/Opus families, dated-snapshot fallback to family alias), Anthropic config (`src/server/ai/anthropic-config.ts` — model resolution, base URL, request/budget timeouts, conversation retry cap), typed errors (`src/server/ai/errors.ts` — Auth/RateLimit/Server/Timeout/MissingMetadata/ToolRefusal), `getClaudeClient` test isolation guard (VITEST=true → stub regardless of API key) + `__setClaudeClientForTests` injection helper. SDK pinned at `@anthropic-ai/sdk@0.92.0`. The factory still returns the stub when `ANTHROPIC_API_KEY` is set — the real-client wiring lands in P4r-2.

P4r-2 — **RealClaudeClient.sendReply (non-streaming) + retries + cost log.** Implements the SDK call with forced tool-use on `SEND_REPLY_TOOL` (still the original schema — post-P4r-3 schema split into natural-content reply + metadata-tool), maps `tool_use` block → `SendReplyResult`, treats `end_turn` without `tool_use` as `OUTSIDE_SCOPE` + `TOOL_REFUSAL` with a deterministic per-language fallback reply (FR/AR/EN/Darija) so the conversation continues gracefully and the gap-logger picks it up. Retry/backoff per Gate-1 K5; `[brain-cost]` per-call log line with computed USD; `[brain-error]` for Anthropic failures; per-conversation retry-budget counter (cap 5, resets on a clean turn). Wires `getClaudeClient` to actually return the real client when `ANTHROPIC_API_KEY` is set. Probe outcome: `claude-sonnet-4-6-20260217` rejected with 404 by `/v1/messages`; pin stays on alias `claude-sonnet-4-6`. (Re-run via `npm run probe:model -- claude-sonnet-4-6-20260217` if a future dated handle becomes available.)

P4r-3 — **Prompt caching wired + log channel split.** `cache_control: { type: "ephemeral" }` on `tools[]` + end of Block A + end of Block B. 5-min TTL. `Message.aiMetadata.usage` extended with `cacheCreationInputTokens` / `cacheReadInputTokens`. `[brain-cache]` block-A SHA log on first call per process; block-B SHA log on first call per tenant (re-logged when SHA rotates — that's the cache-invalidation signal). `AnthropicMissingMetadataError` defensive path (carries replyText + modelId + usage); orchestrator surfaces the partial reply with `escalation: "LOW_CONFIDENCE"` and `claudeReason: "MISSING_METADATA"`. `[brain-refusal]` log channel split from `[brain-error]` — refusals are content/safety signals (different remediation path from infrastructure outages); customer message included truncated to 200 chars for refusal-pattern investigation.

P4r-3 also briefly attempted a **tool-use schema restructure** (Gate-1 E option a): `SEND_REPLY_TOOL` → `SEND_REPLY_METADATA_TOOL` with reply as natural content. **P4r-4 reverted this** after the schema-validation probe (`npm run probe:schema`) found that **Sonnet 4.6 with forced `tool_choice` is exclusive — emits the tool_use block only, no text content alongside**. Real per-token streaming via the schema split was therefore impossible. Decision: keep the simpler single-tool design (reply inside tool args), accept synthetic chunked-after-the-fact streaming. Customer-support replies (typically 50–200 words) feel paced enough this way. The probe script and the `AnthropicMissingMetadataError` defensive path stay; they're cheap insurance against unusual model behavior.

P4r-4 — **Streaming + abort propagation.** `RealClaudeClient.streamReply` opens the SDK's `messages.stream()`, awaits the complete `finalMessage()`, then yields synthetic delta chunks (8 codepoints per chunk, 35ms apart — same cadence the stub fallback uses) followed by a `done` event. Why call `messages.stream()` if we don't yield real per-token deltas? Two reasons: (1) abort propagation — the widget route's `ReadableStream` cancel callback fires `AbortController.abort()`, which closes the upstream HTTP connection and stops billing for replies the customer won't see; (2) infrastructure-readiness for any future model where forced tool_use isn't exclusive. `runBrainStream` now branches: if the client implements `streamReply`, it forwards delta + done events; otherwise it falls back to chunk-after-the-fact via `sendReply`. Orchestrator refactored to share prep / error-handling / finalize helpers between `runBrain` and `runBrainStream` (CallContext, prepareCallContext, handleClaudeError, finalizeBrainResult). Block A reverted from 794 → 738 tokens. **`ClaudeClient` interface is stable after P4r-4** — no further contract changes through P4r-6.

P4r-4 — **streamReply via Anthropic SDK streaming.** Pipes content deltas straight through (no synthetic 35 ms pacing). Wires `req.signal` from the route's `ReadableStream` cancel into the SDK's abort signal. `runBrainStream` gains a "use real streamReply when available" branch; the chunk-after-the-fact path stays as the stub fallback. Widget consumer unchanged.

P4r-5 — **`structureItemsFromText` against real Claude + cache observability.** Real SDK call replaces the P4r-4 stub-delegation placeholder. Temperature 0.1 (Gate-1 K7), forced `tool_choice` on `SEND_STRUCTURED_ITEMS_TOOL`, max_tokens 4000 for fan-out (typical paste produces 10–20 items). Dedicated `SMART_IMPORT_SYSTEM_PROMPT` separate from Block A — focused on "extract structured product data from messy text," documents the don't-fabricate rules. `cache_control: ephemeral` on the system prompt so multi-import sessions hit the cache. Same `withRetry` / `mapSdkError` envelope as `sendReply`; missing tool_use → `AnthropicToolRefusalError` (smart-import has no graceful fallback — surfaces the error to the operator). `StructureItemsResult` extended with `retriesUsed` + optional cache-token fields. `npm run probe:smart-import` (~$0.005/run) sends a realistic messy FR catalog and dumps the extracted items + notes for human quality review — quality is subjective, so the probe gates only on shape (items[] non-empty, every item has a name).

**Cache-effectiveness finding (P4r-5 follow-up — needs your decision).** `npm run probe:cache` seeded the acme tenant with a substantial voice profile + full tier-1 facts (Block B = 339 tokens, total cacheable prefix ~2077 tokens — well above Anthropic's 1024-token Sonnet minimum) and ran two consecutive `runBrain` calls with the same conversationId. **`cache_creation_input_tokens` and `cache_read_input_tokens` were both 0 on every call.** Isolation tests via `scripts/probe-cache-raw.ts` (raw fetch, bypasses our SDK + RealClaudeClient layers): identical request body returns:
  - `claude-sonnet-4-6` (alias, current pin): cache_create=0, cache_read=0 — caching silently disabled.
  - `claude-sonnet-4-5` (alias): cache_create=2011, cache_read=2011 — caching works.
  - `claude-sonnet-4-5-20250929` (dated): cache_create=2011, cache_read=2011 — caching works.

So **Anthropic's `claude-sonnet-4-6` alias does not support prompt caching**. The cache_control markers we ship are silently ignored. P4r-5 also tried merging breakpoints to one cumulative segment at end of Block B (drop tools[] + Block A markers) and adding the legacy `anthropic-beta: prompt-caching-2024-07-31` header — neither helped, confirming the constraint is upstream and model-specific.

The cache_control markers stay in the codebase (single Block-B breakpoint, simplified from the P4r-3 three-breakpoint design) — they're zero-cost no-ops on 4.6 and ready for whichever model lands caching. Decision pending: Sonnet 4.6 (best quality, no caching) vs Sonnet 4.5 (caching saves ~80–90% on cached portions, possibly slightly lower quality). The probe scripts are reusable: `npm run probe:cache` after any model change.

P4r-7 — **Phase 4 closing commit. Model pin switch + Algerian Darija coaching.**

Model pin switched from `claude-sonnet-4-6` → `claude-sonnet-4-5-20250929` (dated snapshot). Decision rationale, empirical from the P4r-6 brain-eval bench against both models:
- 4.6 alias does not support prompt caching (cache_create/cache_read both 0 even on prefixes well above the 1024-token Sonnet minimum). 4.5 caches normally — observed ~47% cost reduction on the 11-row eval ($0.107 → $0.057).
- No observable quality differentiator between 4.5 and 4.6 on the 11-row bank. Both produced clean MSA/FR/EN replies; both produced non-Algerian Darija on rows 4–6 (the latter is a prompt-layer problem, not a model-layer one).
- Dated snapshot pin (not the floating `claude-sonnet-4-5` alias) so silent rotation can't drift quality underneath us. Re-validate via `npm run probe:schema` after any future pin change.

`BLOCK_A_TEXT` rewritten with **Algerian-specific Darija coaching**. The platform serves Algerian businesses, NOT generic Maghrebi or Moroccan. Without explicit Algerian vocabulary guidance, both Sonnet 4.5 and 4.6 default to French or MSA on Darija inputs (or worse, drift toward Moroccan vocabulary), which sounds foreign to Algerian customers. The new LANGUAGE HANDLING section pins:
- Algerian markers in customer messages (Arabic-script + Arabizi).
- Algerian vocabulary to USE: wach (not "ash"), kifach (not "shnu"), bessah (not "walakin"), barka (not "safi"), drahem (not "flus"), rani/raki (not "ana kayn").
- Arabizi spelling: "ch" not "sh".
- Negation pattern: ma...sh.
- Present continuous: "rani nakteb" form (NOT Moroccan "kankteb").
- Three concrete examples (Arabizi, Arabic-script, FR-Darija mix).
- Default-to-Algerian fallback when ambiguous.

**Future prompt edits MUST preserve the Algerian-specific coaching.** Never broaden to "Maghrebi Darija" or "generic Darija" — the platform's customers are Algerian. The `prompts/system.test.ts` assertions pin the load-bearing Algerian markers (`ALGERIAN`, `NOT Moroccan`, `kifach`, `bessah`, `rani nakteb`, `default to Algerian`) so accidental broadening fails CI.

Block A token-budget assertion bumped 800 → 1150 (measured 1119 after coaching). The +380 vs P4r-6 are load-bearing for product quality with Algerian customers — worth the budget. See the system.ts header comment for the full rationale.

P4r-7 brain-eval against the new pin + new Block A: **10/11 passed**. Rows 4 (Arabizi), 5 (Arabic-script Darija), 6 (FR-Darija code-switch) ALL pass with Algerian replies (e.g., row 5 produced "السلام! معليش، ما عنديش المعلومات على أوقات الخدمة متاعنا… واش تحب نديرلك هاذا؟" — solid Algerian Darija). The single failure (row 8 `refund-anger`) is an intermittent Supabase pooler error: `Transaction API error: Unable to start a transaction in the given time` — same infrastructure timeout that hit a different row on the original 4.5 run; not a brain quality issue. Caching observed firing on every row beyond the first (cache_read=1940 tokens consistent across rows).

Validator footnote: the brain-eval Darija detector originally used `\b` word boundaries which don't match around Arabic letters. Expanded to substring matching with a broader Algerian marker vocabulary (`معليش`, `متاع`, `باش`, `نقدر`, `نديرلك`, `تحب`, `هاذا`, etc.) so excellent Darija replies aren't false-flagged.

**Phase 4 acceptance — DONE.** runBrain hits real Sonnet 4.5 with caching firing; brain-eval passes 10/11 (the eleventh is infrastructure flake). Real customer-facing Darija quality validated.

P4r-6 — **`scripts/brain-eval.ts` + `npm run brain:eval`.** Model-aware regression harness. 11-row query bank: AR (MSA) / FR / EN / Darija-Arabizi / Darija-Arabic-script / FR↔Darija code-switch / off-topic / refund-anger / priced-item lookup / tier-2 hours fact / Q&A near-verbatim. Idempotent fixture seeder embeds a Macbook Pro M3 KnowledgeItem + a "Vous livrez à Constantine ?" QnaPair + full operational facts on the acme tenant before the run. Per-row report: customer message → retrieval → tool result → franc-based language validation on the reply text (special handling for Darija — Arabizi via numeral-pattern detection, Arabic-script via dialect markers like واش/راكم/دير; franc can't distinguish Darija-MSA in Arabic script) → groundedness/confidence/escalation → token usage + USD cost → PASS/FAIL on shape (reply non-empty, language valid, citations indices in range, etc.). Cost-confirmation prompt at startup ("This will make N real API calls against {model} and cost approximately $X.XX. Continue? [y/N]"); skip with `--no-prompt`. JSON report always written to `eval/reports/{ts}-{model}.json`; optional Markdown via `--markdown`. Baseline-comparison mode diffs against the most recent prior report for the same model; flags language changes, escalation changes, citations-used delta, >20% reply-length change. `--model claude-sonnet-4-5` switches the pin for empirical 4.5-vs-4.6 comparison.

P4r-6 also added the **`[brain-cache-warn]` log line** (small follow-up): when the cumulative system-block token count exceeds Anthropic's 1024-token minimum but the response shows `cache_create=0 AND cache_read=0`, emit `[brain-cache-warn] tenant=… model=… cacheable_tokens=… (caching SHOULD have fired but did not)`. Surfaces silent caching failures (the kind we found accidentally with Sonnet 4.6) in production logs without needing a probe run.

Deferred to a later phase (originally part of Phase 4):

- **Playground UI** (`src/app/(app)/[tenantSlug]/playground/page.tsx`) — chat surface, breathing-cursor stream, citations sidebar. The widget already exercises the streaming pipeline end-to-end against real customers; a separate operator-facing playground is a nice-to-have, not blocking for the Phase 4 resumption acceptance.
- **Sidebar voice-profile preset switcher** — A/B tone demo. Better to ship as part of the Phase 9 onboarding wizard once the persisted edit UI lands.

Phase 4 resumption acceptance (when P4r-6 completes): widget chat through `/api/widget/messages` returns real Claude replies, streams token-by-token, includes correct citations + escalation + confidence, prompt caching produces measurable cost savings on the second turn of any conversation, and `npm run brain:eval` passes the 11-row bank.

### Architectural rules established in Phase 4 partial

- **Tool-use is the contract for AI replies.** The brain must always go through the `send_reply` tool — never free text. Every conformant `ClaudeClient` implementation enforces this on the way out.
- **The orchestrator owns confidence.** Claude reports `groundedness` (self-rated support); confidence is a deterministic combination of that with verifiable retrieval signals. Never trust the model to score itself; always compute server-side.
- **No LLM call outside `src/server/ai/`** (already in CLAUDE.md §3, reinforced here). The orchestrator + ClaudeClient interface is the *only* path.

---

## 8. Memory

The user maintains a Claude Code memory store at `~/.claude/projects/.../memory/`. Relevant facts about the user's working preferences, the project, and recurring rules live there and are loaded automatically. Update memory when you learn something durable; do not duplicate facts that already exist in MASTER_PLAN or this file.


## 9. End-of-session protocol
At the end of every session, before yielding control:
1. Stage and commit any uncommitted changes
2. Print a summary including: files created, files modified, packages installed, migrations run, commits made (hash + message), and any issues encountered or deferred
3. Note any decisions made that should be reflected in MASTER_PLAN.md