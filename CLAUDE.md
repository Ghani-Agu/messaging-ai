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

When this section grows large, group by tool.

---

## 7. Phase-1 deviations from MASTER_PLAN

Recorded in MASTER_PLAN §5. Summary:

- Tailwind v4 is configured CSS-first (`@theme inline` in `src/app/globals.css`) instead of via `tailwind.config.ts`. Approved by project lead before Phase 1 build.

---

## 8. Memory

The user maintains a Claude Code memory store at `~/.claude/projects/.../memory/`. Relevant facts about the user's working preferences, the project, and recurring rules live there and are loaded automatically. Update memory when you learn something durable; do not duplicate facts that already exist in MASTER_PLAN or this file.


## 9. End-of-session protocol
At the end of every session, before yielding control:
1. Stage and commit any uncommitted changes
2. Print a summary including: files created, files modified, packages installed, migrations run, commits made (hash + message), and any issues encountered or deferred
3. Note any decisions made that should be reflected in MASTER_PLAN.md