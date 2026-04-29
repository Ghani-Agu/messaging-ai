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

### Phase 3: knowledge migration workflow

For any change touching `KnowledgeChunk` / `KnowledgeSource`:

1. Edit `prisma/schema.prisma`.
2. `npm run db:migrate -- --create-only --name <descriptive-name>`.
3. Open the generated `migration.sql`. Strip any `DROP INDEX "KnowledgeChunk_embedding_hnsw"` and any `ALTER COLUMN "searchVector"` Prisma slips in (both come from PSL/DB drift, not your edit).
4. Add custom raw SQL for any new HNSW / GENERATED column work.
5. `npm run db:migrate` to apply.
6. `npx dotenv -e .env.local -- node scripts/verify-knowledge-schema.mjs` to confirm.

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

Dev minted a 24h JWT; the dev server validated it and rendered the auth-gated `/channels` and `/conversations` pages identically to a real session. Useful for CI and curl-based verification harnesses; not committed (the script that does it is a one-off, not infrastructure). Reference: the deleted `scripts/test-phase6-mint-jwt.ts` from the Phase 6 verification pass — pattern only, file no longer in tree.

### Long-running workers + third-party HTTP clients

We hit a Phase-3 incident where the BullMQ worker began failing every Firecrawl crawl with `connect ETIMEDOUT 35.245.250.27:443`, while `curl` from the same machine returned 200 in <1 s. Root cause was specific to the SDK transport, not the network:

- `@mendable/firecrawl-js` 4.x uses axios with no default timeout on the legacy v1 path (`postRequest` only sets `timeout` when the caller passes `params.timeout`).
- axios with no explicit agent reuses Node's `https.globalAgent` keepalive pool. In a long-lived worker, that pool collects sockets the upstream LB has already half-closed. The next axios call reuses one, the write hangs, and Node waits for the OS-level TCP retransmit (~75–120 s on Windows) before surfacing as ETIMEDOUT.

Fix: replace the SDK with native `fetch` + `AbortSignal.timeout()`. Diagnostic + write-up: `scripts/firecrawl-diag.ts`. Upstream issues with the same fingerprint: firecrawl/firecrawl#1912, #2185, #2280.

**Standing rule for this codebase:** any HTTP call from a worker process — or any code path reachable from one — uses native `fetch` with an explicit `AbortSignal.timeout()`. No third-party HTTP-client SDKs in workers (axios, got, superagent, ky, openai-style SDK transports, …). Wrap providers ourselves the way `crawler.ts` and `parser.ts` do, and route 4xx (except 429) through `PermanentError` from `src/server/knowledge/errors.ts` so BullMQ stops retrying. Everything else (5xx, 429, network, AbortError) stays a plain `Error` and gets the existing `attempts: 5` retry budget.

When this section grows large, group by tool.

---

## 7. Phase-1 deviations from MASTER_PLAN

Recorded in MASTER_PLAN §5. Summary:

- Tailwind v4 is configured CSS-first (`@theme inline` in `src/app/globals.css`) instead of via `tailwind.config.ts`. Approved by project lead before Phase 1 build.

---

## 7a. Phase 4 split — partial build

**Status:** Phase 4 was executed only partially. Anthropic credits unavailable at the time (project lead in Algeria — phone verification path unsupported, no path to free credits). Project lead's decision: ship the pure-logic pieces that don't need an API key, defer the rest until credits arrive (likely after first paying client), then move on to Phase 5.

### Done in Phase 4 partial

- **Voice profile schema** (`src/lib/validators.ts`): Zod-validated `VoiceProfile` inside `Tenant.settings.voiceProfile`. Defaults applied on tenant creation; `prisma/seed.ts` retrofits any tenant whose settings is missing the field.
- **System-prompt builders** (`src/server/ai/prompts/system.ts`): Block A (platform rules, 594 tokens, vitest-asserted ≤ 800), Block B (per-tenant identity + voice + few-shot), Block C (runtime: citations + history + new message). `buildPrompt()` returns the multi-block array shape so Anthropic prompt caching (`cache_control: ephemeral`) is a one-line annotation later.
- **Confidence formula** (`src/server/ai/confidence.ts`): deterministic post-tool-call computation — weights confirmed by project lead. `decideEscalation()` overrides Claude's choice with `LOW_CONFIDENCE` below the 0.6 threshold; original reason preserved in `Message.aiMetadata`.
- **ClaudeClient interface** (`src/server/ai/claude-client.ts`): `ClaudeClient` interface, `SEND_REPLY_TOOL` JSON Schema, `StubClaudeClient` (deterministic canned shapes — happy path / OUTSIDE_SCOPE / EXPLICIT_REQUEST / PAYMENT_DISPUTE), `getClaudeClient()` factory. **The boundary the resumption swap touches.**
- **Orchestrator** (`src/server/ai/orchestrator.ts`): full `runBrain()` pipeline — load tenant → retrieve → build prompts → input-budget guard → `client.sendReply()` → compute confidence → decide escalation → shape `BrainResult`. End-to-end tested against the stub.
- **Vitest** alias `@/*` → `./src/*` wired so source files using the alias load identically under tests and Next.js.

### Deferred — needs Anthropic credits

The full original Phase 4 build order is in this conversation's context. Renumbered for resumption:

1. **Real `src/server/ai/claude.ts`.** Implement `class RealClaudeClient implements ClaudeClient` using native `fetch` + `AbortSignal.timeout` per CLAUDE.md §6. **First sub-task:** run `scripts/list-anthropic-models.ts` (already shipped — read-only, awaiting key) and have the project lead pick the dated Sonnet 4.6 snapshot. Pin as `ANTHROPIC_MODEL_DEFAULT` const, env-overridable via `ANTHROPIC_MODEL`. Implement `sendReply` first; `streamReply` follows in step 3.
2. **`scripts/brain-eval.ts` + `npm run brain:eval`.** 8-row query bank (AR / FR / EN / Darija-Arabizi / Darija-Arabic-script / FR↔Darija code-switch / off-topic / refund-anger). Validate **reply text** language with a langid library (e.g. `franc`), **not** Claude's self-reported `send_reply.language` — the self-report is a null check on Claude's introspection; we want to catch "Claude says Darija, actually replied MSA" regressions. For Darija specifically, accept either Arabic-script-with-Algerian-vocab OR Arabizi (Latin + numeral-stand-ins for ع/ح/ق); document the heuristic inline. Run after every prompt change. **Gate: must pass before step 3.**
3. **Streaming API route** — `src/app/api/playground/stream/route.ts`. `ReadableStream` of SSE-style events (`delta` for text deltas, `done` for the structured `send_reply` args + computed confidence + citations). The streaming variant on `ClaudeClient` (`streamReply`) gets implemented on the real wrapper at this point. **`streamReply` must consume Anthropic's native SSE stream** — the `content_block_delta` / `text_delta` / `message_stop` events on `/v1/messages` with `stream: true` — and pipe individual deltas as Claude generates them. **It must not call `sendReply` and chunk the resulting text server-side.** The chunk-after-the-fact shape currently in `runBrainStream` (`src/server/ai/orchestrator.ts:244`) is a *stub-only* pattern: `StubClaudeClient` returns the full reply in one shot, so the orchestrator slices it into fake deltas to keep the dashboard playground UI development unblocked. Real streaming requires native event consumption — otherwise the user sees no incremental text until the full reply has been generated server-side, which defeats the point.
4. **Playground UI** — `src/app/(app)/[tenantSlug]/playground/page.tsx`. Chat surface, breathing-cursor stream, sidebar (detected-language badge, citations with chunk previews, groundedness, computed confidence, escalation pill with reason). All design tokens — no hard-coded values.
5. **Sidebar voice-profile preset switcher** (read-only persistence this phase). The Phase-4 demo lets you A/B tone live without writing back to the DB. Persisted edit UI lives in Phase 9 (onboarding wizard).

Acceptance for full Phase 4 (when resuming): open playground, type each of the 8 query-bank rows, watch streaming, see the matching script in Darija replies, see chunks light up in the sidebar, see groundedness/confidence/escalation update per turn.

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