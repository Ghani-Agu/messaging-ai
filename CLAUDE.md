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
- Any future raw-SQL index added the same way — when you add one, add it to this list too.

When you strip a line, leave a one-line `-- INTENTIONAL: do not drop <index name> — managed via raw SQL` comment in its place so a future maintainer doesn't undo the strip. The verify scripts (`scripts/verify-knowledge-schema.mjs`, `scripts/verify-channels-schema.mjs`) catch missed strips after apply and should be run after every migration.

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