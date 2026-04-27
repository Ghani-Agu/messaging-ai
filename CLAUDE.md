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

## 5. Pending local-machine setup

Tracked here so future sessions don't re-derive it.

- [ ] **Docker Desktop** — not installed yet on this machine. Phase 1 includes a working `docker-compose.yml` (Postgres+pgvector + Redis) but the boot test was deferred. Once Docker Desktop is installed, run `docker compose up -d`, then `npx prisma migrate dev --name init`, then `npm run db:seed`. The demo page at `/` works fine without Docker.

When this list is empty, delete this section.

---

## 6. Phase-1 deviations from MASTER_PLAN

Recorded in MASTER_PLAN §5. Summary:

- Tailwind v4 is configured CSS-first (`@theme inline` in `src/app/globals.css`) instead of via `tailwind.config.ts`. Approved by project lead before Phase 1 build.

---

## 7. Memory

The user maintains a Claude Code memory store at `~/.claude/projects/.../memory/`. Relevant facts about the user's working preferences, the project, and recurring rules live there and are loaded automatically. Update memory when you learn something durable; do not duplicate facts that already exist in MASTER_PLAN or this file.
