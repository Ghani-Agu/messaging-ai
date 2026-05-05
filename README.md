# messaging-ai

Multi-tenant AI messaging platform that handles customer conversations on behalf of businesses across WhatsApp, Instagram, web chat, and email — in Arabic, French, English, and Algerian Darija.

> **Status:** Phase 1 / 10 — foundation. The design system, folder structure, Prisma multi-tenancy schema, and demo page are live. Auth, channels, AI brain, and billing arrive in subsequent phases.
>
> **Source of truth:** [`MASTER_PLAN.md`](./MASTER_PLAN.md). Every architectural decision lives there. See [`CLAUDE.md`](./CLAUDE.md) for how Claude Code is expected to operate against this repo.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4 (CSS-first `@theme`) · shadcn/ui primitives (restyled) · Framer Motion · next-themes · Geist Sans/Mono |
| Backend | Next.js Server Actions / API routes · NextAuth v5 (Phase 2) · Prisma 6 · Postgres + pgvector |
| Queue | Redis · BullMQ (Phase 5+) |
| AI | Claude Sonnet 4.6 · GPT-4o-mini · Voyage embeddings · Firecrawl · LlamaParse |
| Channels | 360dialog (WhatsApp) · Meta Graph (Instagram) · in-house JS widget (web) |
| Infra | Railway · Supabase · Upstash · Stripe · Resend · Sentry · PostHog |

Stack is locked. See `MASTER_PLAN.md` §3.

---

## Setup

### Prerequisites

- Node.js ≥ 20
- npm 11+
- Docker Desktop (for local Postgres + Redis) — **pending install on this machine**, see `CLAUDE.md`
- Git

### First-time setup

```bash
# 1. Install dependencies
npm install

# 2. Copy env file and fill in values
cp .env.example .env.local
# (Phase 1 only needs DATABASE_URL, DIRECT_DATABASE_URL, REDIS_URL.
#  The defaults in .env.example match docker-compose.yml.)

# 3. Start local Postgres + Redis (requires Docker)
docker compose up -d

# 4. Run the first Prisma migration
npx prisma migrate dev --name init

# 5. Seed the demo tenant
npm run db:seed

# 6. Run the dev server
npm run dev
```

Open http://localhost:3000 — you should see the design-system demo page.

### Without Docker (Phase 1 demo only)

The demo page at `/` does not touch the database. You can boot the dev server with `npm run dev` and view the design system without running Postgres or Redis. Database-backed work starts in Phase 2.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start Next.js dev server on `:3000` |
| `npm run build` | Production build |
| `npm start` | Run the production build |
| `npm run lint` | ESLint (flat config, `eslint-config-next`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run format` | Prettier + Tailwind class sorting |
| `npm run db:generate` | Regenerate Prisma client |
| `npm run db:migrate` | Run Prisma migrations against local DB |
| `npm run db:push` | Push schema without a migration (prototyping only) |
| `npm run db:seed` | Seed the demo tenant `acme` |
| `npm run db:studio` | Open Prisma Studio |
| `npm run check:env` | Validate `.env.local` against `.env.example` per phase |

---

## Folder layout (Phase 1 active dirs only)

```
src/
├── app/
│   ├── layout.tsx          Root layout, Geist fonts, ThemeProvider
│   ├── globals.css         Design tokens (@theme inline, dark + light)
│   └── page.tsx            Demo page at /
├── components/
│   ├── ui/                 Restyled shadcn primitives — Button, Card
│   └── motion/             Framer Motion components — GlowCard, FadeIn, ThemeProvider
├── lib/
│   ├── motion.ts           Easing curves, durations, variants
│   ├── design-tokens.ts    JS-side mirror of CSS tokens
│   ├── utils.ts            cn() helper
│   └── validators.ts       Shared Zod schemas
└── server/
    └── db/client.ts        Singleton Prisma client
```

Future-phase directories (`src/server/auth`, `src/server/ai`, `src/server/channels`, etc.) are scaffolded with `.gitkeep` and populated phase-by-phase. Full target layout: `MASTER_PLAN.md` §5.

---

## Design system

Direction A — Linear-inspired. Deep charcoal base (`#0A0A0B`), platform orange accent (`#EA580C`), Geist fonts, dark default with light parity. Tokens live in `src/app/globals.css` (CSS variables surfaced as Tailwind v4 utilities via `@theme inline`) and as TS constants in `src/lib/design-tokens.ts`.

Hard rule: never hard-code colors, font sizes, spacing, or motion values. Always use the tokens. (See `MASTER_PLAN.md` §13.)

Visit `/` to see typography, color tokens, button variants, and motion behavior.

---

## Conventions

- Server-only code lives under `src/server/**` — never imported by client components.
- Database access goes through `src/server/db/**` helpers, never raw Prisma in app code (Phase 2 wires up the tenancy-aware wrappers).
- LLM calls go through `src/server/ai/**` (Phase 4).
- All Tailwind class strings must be statically detectable — no `text-${variant}` patterns. Use literal class maps when variants are needed.
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, etc. Commit per meaningful step, never bundle a phase into one commit.

---

## License

UNLICENSED — proprietary, all rights reserved.
