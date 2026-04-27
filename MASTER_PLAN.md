# MASTER_PLAN.md

**Project:** Multi-channel AI Messaging SaaS (working name: `messaging-ai`)
**Owner:** Project lead (you)
**Build assistant:** Claude Code (this document is the persistent source of truth across all sessions)
**Last updated:** Day 0 — pre-build planning

---

## How to use this document

This file is the single source of truth for the entire project. Claude Code must read this file in full at the start of every session before writing any code. Every phase prompt references this document by name.

Rules:

1. Do not deviate from the architecture, stack, or design language defined here without explicit approval from the project lead.
2. When in doubt, re-read this file rather than guessing.
3. If a decision is genuinely missing from this document, stop and ask before proceeding.
4. Update this file (with project lead approval) when scope or architecture changes — never let it go stale.

---

## 1. Product vision

A multi-tenant AI messaging platform that handles customer conversations on behalf of businesses across multiple channels (WhatsApp, Instagram, Messenger, website chat, email), in multiple languages (Arabic, French, English, Algerian Darija), including voice messages.

The AI is configured per tenant (per company) using their website content, uploaded files, and manual entries. It learns the company's voice, products, and policies, and answers customers like a senior support human or expert salesperson — never sounding like a generic chatbot.

Two go-to-market models:

- **Self-serve SaaS** — companies sign up, configure, pay a subscription
- **Done-for-you** — project lead onboards clients manually, charges setup + monthly

The platform is the same product. Only the onboarding path differs.

### Target user

Algerian and broader MENA SMBs: e-commerce stores, real estate agencies, clinics, restaurants, training centers, service businesses. Typically 1–50 employees. Currently overwhelmed by DMs and WhatsApp messages on multiple channels and losing leads because of slow response times.

### Why we win

1. Real Algerian Darija quality (not just MSA Arabic)
2. Voice message handling (huge in MENA, ignored by competitors)
3. 5-minute onboarding (paste website URL → AI ready)
4. Premium UI/UX that signals quality (most competitors look like 2018 Bootstrap)
5. Smart human-handoff (AI knows when to escalate; doesn't bluff)

---

## 2. V1 scope (first 5–6 weeks)

**In scope for v1:**

- Channels: WhatsApp, website chat widget, Instagram DMs
- Languages: Arabic (MSA), French, English, Algerian Darija
- Mode: text only (voice messages in v1.1)
- Multi-tenancy: full (one platform serves many client companies)
- Knowledge sources: website crawl, file upload (PDF/DOCX/TXT), manual entry
- Human handoff: confidence-based escalation, live takeover UI, notifications
- Onboarding: 5-minute wizard
- Billing: Stripe subscriptions with plan tiers
- Dashboard: full SaaS control panel for tenants + super-admin panel for project lead

**Explicitly out of scope for v1 (postponed to v1.1+):**

- Voice message handling (incoming voice → STT → AI → text reply)
- Voice replies (TTS)
- Messenger (Facebook) — added in v1.1 alongside Instagram
- Email channel (Gmail OAuth + IMAP)
- Advanced analytics, A/B testing of reply strategies
- CRM integrations (HubSpot, Zoho)
- Mobile app
- White-label option

---

## 3. Tech stack (locked, do not change without approval)

### Frontend
- **Next.js 15** (App Router, Server Components, Server Actions)
- **TypeScript** (strict mode)
- **Tailwind CSS v4** with custom design token system
- **shadcn/ui** primitives, heavily restyled (no out-of-the-box shadcn look anywhere)
- **Framer Motion** for animations
- **Radix UI** under shadcn for accessibility
- **Lucide icons** as the primary icon set
- **next-themes** for dark/light/auto with smooth transitions
- **CVA (class-variance-authority)** for component variants
- **Geist Sans + Geist Mono** as the typography system

### Backend
- **Next.js API routes / Server Actions** (no separate backend service for v1)
- **NextAuth v5** for authentication (email magic link + Google OAuth)
- **Prisma ORM** for database access
- **Postgres** (Supabase in production, local Docker in development)
- **pgvector** extension for embeddings (Supabase supports natively)
- **Redis** + **BullMQ** for the message queue (Upstash Redis in production, local Docker in development)
- **Zod** for runtime validation everywhere

### AI / ML
- **Claude Sonnet 4.6** (primary brain, via Anthropic API)
- **GPT-4o-mini** (cheap path for cheap ops: intent classification, language detection, summarization, via OpenAI API)
- **Voyage AI** for embeddings (multilingual, strong on Arabic) — falls back to OpenAI text-embedding-3-small if Voyage unavailable
- **Firecrawl** for website crawling
- **LlamaParse** for PDF/DOCX parsing (free tier covers v1)

### Channels
- **360dialog** for WhatsApp Business API (lowest markup, EU-based)
- **Meta Graph API** for Instagram (direct, no BSP)
- **Custom JS widget** for website chat (built in-house, not third-party)

### Infrastructure
- **Railway** for app hosting (Node.js + worker dyno for queue)
- **Supabase** for Postgres + pgvector + storage
- **Upstash Redis** for queue and rate limiting
- **Stripe** for billing
- **Resend** for transactional email
- **Sentry** for error tracking
- **PostHog** for product analytics

---

## 4. Design system (Direction A: Linear-inspired)

### Color tokens

All colors defined as CSS variables in `:root` and `[data-theme="dark"]`. Default theme is dark.

**Dark theme (primary):**

| Token | Value | Use |
|---|---|---|
| `--bg-base` | `#0A0A0B` | App background |
| `--bg-surface` | `#111113` | Cards, panels |
| `--bg-surface-elevated` | `#18181B` | Modals, popovers, hover states |
| `--bg-surface-overlay` | `#1F1F23` | Highest elevation |
| `--border-subtle` | `#1F1F23` | Default borders |
| `--border-default` | `#27272A` | Emphasized borders |
| `--border-strong` | `#3F3F46` | Focus rings, active states |
| `--text-primary` | `#FAFAFA` | Main text |
| `--text-secondary` | `#A1A1AA` | Secondary text |
| `--text-tertiary` | `#71717A` | Tertiary text, placeholders |
| `--text-disabled` | `#52525B` | Disabled |
| `--accent-base` | `#7C3AED` | Primary action (electric violet) |
| `--accent-hover` | `#8B5CF6` | Primary hover |
| `--accent-active` | `#6D28D9` | Primary pressed |
| `--accent-glow` | `rgba(124, 58, 237, 0.35)` | Glow effects |
| `--accent-secondary` | `#06B6D4` | Cyan secondary accent (sparingly) |
| `--success` | `#10B981` | Success states |
| `--warning` | `#F59E0B` | Warning states |
| `--danger` | `#EF4444` | Error/destructive |
| `--gradient-primary` | `linear-gradient(135deg, #7C3AED 0%, #06B6D4 100%)` | Hero gradients, key CTAs |
| `--gradient-mesh` | `radial-gradient(at 27% 37%, hsla(265,75%,55%,0.18) 0px, transparent 50%), radial-gradient(at 97% 21%, hsla(189,75%,55%,0.12) 0px, transparent 50%), radial-gradient(at 52% 99%, hsla(280,75%,55%,0.10) 0px, transparent 50%)` | Login/onboarding backgrounds |

**Light theme:** designed but not the default. Mirror of dark with inverted neutrals; accent stays violet but slightly darker (`#6D28D9`) for contrast.

### Typography

- **Display / heading:** Geist Sans, weights 500 / 600 / 700
- **Body:** Geist Sans, weights 400 / 500
- **Code / mono:** Geist Mono

Type scale:

| Token | Size | Line height | Use |
|---|---|---|---|
| `text-display` | 56px / 3.5rem | 1.05 | Hero headlines |
| `text-h1` | 40px / 2.5rem | 1.1 | Page titles |
| `text-h2` | 32px / 2rem | 1.15 | Section headings |
| `text-h3` | 24px / 1.5rem | 1.2 | Subsections |
| `text-h4` | 20px / 1.25rem | 1.3 | Card titles |
| `text-body-lg` | 18px / 1.125rem | 1.55 | Lead paragraph |
| `text-body` | 15px / 0.9375rem | 1.6 | Default body |
| `text-body-sm` | 13px / 0.8125rem | 1.55 | Secondary text |
| `text-caption` | 12px / 0.75rem | 1.4 | Labels, captions |

Default body text size is 15px (not 16px) — this matches Linear's denser feel.

### Spacing scale

Base unit: 4px. Use Tailwind defaults but limit to: `1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64`. No arbitrary values without reason.

### Border radius

| Token | Value | Use |
|---|---|---|
| `radius-sm` | 6px | Small elements (badges, tags) |
| `radius-md` | 8px | Default (buttons, inputs) |
| `radius-lg` | 12px | Cards |
| `radius-xl` | 16px | Modals, large surfaces |
| `radius-2xl` | 24px | Hero cards |
| `radius-full` | 9999px | Pills, avatars |

### Shadows

| Token | Value |
|---|---|
| `shadow-sm` | `0 1px 2px rgba(0,0,0,0.4)` |
| `shadow-md` | `0 4px 12px rgba(0,0,0,0.5)` |
| `shadow-lg` | `0 12px 32px rgba(0,0,0,0.55)` |
| `shadow-glow` | `0 0 32px var(--accent-glow)` |
| `shadow-glow-strong` | `0 0 64px var(--accent-glow), 0 0 16px var(--accent-glow)` |

### Motion (Framer Motion presets)

Define these as exported constants in `lib/motion.ts` and use everywhere — no ad-hoc transitions.

| Preset | Config |
|---|---|
| `easeStandard` | `[0.4, 0, 0.2, 1]` (Material-style) |
| `easeOutExpo` | `[0.16, 1, 0.3, 1]` (Linear's signature ease) |
| `easeSpring` | `{ type: "spring", stiffness: 400, damping: 30 }` |
| `easeSpringBouncy` | `{ type: "spring", stiffness: 500, damping: 25 }` |
| `durationFast` | 150ms |
| `durationMedium` | 250ms |
| `durationSlow` | 400ms |
| `durationDeliberate` | 600ms (used only for theatrical moments) |

Hover state default: 150ms ease-out. Layout shifts: spring. Page transitions: 250ms ease-out-expo. Modal enter: spring. Stagger: 40ms between children.

### Theatrical moments (the "wow" budget)

These get extra animation polish. Everywhere else stays calm and fast.

1. **Login screen** — animated mesh gradient background (slowly shifting), glassmorphic card, magnetic-pull button on hover
2. **Onboarding wizard** — full-screen scenes with smooth transitions, live website-crawl visualization (animated graph nodes), particle-burst on completion
3. **Dashboard home (first load)** — stagger-in cards, animated number counters, charts that draw in
4. **AI playground** — streaming response with breathing cursor, entity highlighting, animated confidence meter
5. **Theme picker** — smooth color transitions across the entire UI when accent changes
6. **Command palette** (⌘K) — Linear-style spring-in
7. **Empty states** — animated illustrations, never sad icons

Daily-use surfaces (settings, conversation list, tables) stay calm: subtle hover lifts (2px), soft shadow expansions, no shimmer or magnetic pulls.

---

## 5. File / folder structure

```
messaging-ai/
├── MASTER_PLAN.md                    # This file — the source of truth
├── CLAUDE.md                         # Auto-loaded by Claude Code; references MASTER_PLAN.md
├── README.md                         # Human-readable setup
├── .env.example                      # All required env vars
├── .gitignore
├── package.json
├── tsconfig.json
├── next.config.mjs
├── tailwind.config.ts
├── postcss.config.mjs
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── public/
│   ├── fonts/
│   └── images/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── (marketing)/              # Public marketing site
│   │   │   ├── page.tsx              # Landing page
│   │   │   └── layout.tsx
│   │   ├── (auth)/                   # Auth flows
│   │   │   ├── login/
│   │   │   └── signup/
│   │   ├── (app)/                    # Authenticated app
│   │   │   ├── layout.tsx            # Sidebar shell
│   │   │   ├── [tenantSlug]/         # Tenant-scoped routes
│   │   │   │   ├── dashboard/
│   │   │   │   ├── conversations/
│   │   │   │   ├── knowledge/
│   │   │   │   ├── channels/
│   │   │   │   ├── playground/
│   │   │   │   ├── settings/
│   │   │   │   └── billing/
│   │   ├── (admin)/                  # Super-admin (project lead only)
│   │   │   └── admin/
│   │   ├── api/
│   │   │   ├── webhooks/
│   │   │   │   ├── whatsapp/
│   │   │   │   ├── instagram/
│   │   │   │   └── stripe/
│   │   │   ├── widget/               # Website widget endpoints
│   │   │   └── trpc/                 # If we add tRPC later
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/                       # shadcn primitives, restyled
│   │   ├── marketing/                # Landing-page-specific
│   │   ├── app/                      # Dashboard-specific
│   │   ├── motion/                   # Reusable motion components
│   │   └── icons/                    # Custom SVG icons
│   ├── lib/                          # Pure utilities
│   │   ├── utils.ts                  # cn(), formatters
│   │   ├── motion.ts                 # Framer Motion presets
│   │   ├── design-tokens.ts          # Token exports for JS access
│   │   └── validators.ts             # Zod schemas
│   ├── server/                       # Server-only code
│   │   ├── auth/                     # NextAuth config
│   │   ├── db/                       # Prisma client + helpers
│   │   ├── ai/                       # LLM clients + prompt templates
│   │   │   ├── claude.ts
│   │   │   ├── openai.ts
│   │   │   ├── embeddings.ts
│   │   │   ├── prompts/              # System prompts per use case
│   │   │   └── orchestrator.ts       # Main "brain" loop
│   │   ├── channels/                 # Channel adapters
│   │   │   ├── whatsapp/
│   │   │   ├── instagram/
│   │   │   └── widget/
│   │   ├── knowledge/                # Ingestion pipeline
│   │   │   ├── crawler.ts            # Firecrawl wrapper
│   │   │   ├── parser.ts             # LlamaParse wrapper
│   │   │   ├── chunker.ts
│   │   │   └── retriever.ts
│   │   ├── queue/                    # BullMQ setup + workers
│   │   │   ├── queues.ts
│   │   │   ├── workers/
│   │   │   └── jobs.ts
│   │   ├── billing/                  # Stripe wrapper
│   │   ├── tenancy/                  # Multi-tenant helpers
│   │   └── escalation/               # Human handoff logic
│   ├── hooks/                        # React hooks
│   ├── styles/                       # If anything escapes Tailwind
│   └── types/                        # Shared TS types
├── widget/                           # Standalone website widget (separate build)
│   ├── src/
│   ├── package.json
│   └── vite.config.ts
├── docker-compose.yml                # Local Postgres + Redis
└── scripts/                          # Dev / ops scripts
```

Conventions:
- Server-only files import from `src/server/**` and never run on client
- Client components are explicitly marked with `"use client"`
- Database access happens only through `src/server/db/**` helpers, never raw Prisma in app code
- LLM calls happen only through `src/server/ai/**`, never raw API calls elsewhere

---

## 6. Database schema (v1)

Defined in `prisma/schema.prisma`. Multi-tenancy is row-level: every tenant-scoped model has a `tenantId`.

### Core multi-tenancy

- **Tenant** — a client company. Fields: `id`, `slug` (unique URL part), `name`, `logoUrl`, `accentColor`, `plan`, `stripeCustomerId`, `createdAt`, `settings` (JSON: business hours, escalation rules, brand voice config, default language, etc.)
- **User** — a person. Fields: `id`, `email`, `name`, `imageUrl`, `createdAt`. NextAuth fields included.
- **TenantUser** — join table. Fields: `id`, `tenantId`, `userId`, `role` (OWNER / ADMIN / AGENT / VIEWER), `createdAt`. Unique on `(tenantId, userId)`.

### Knowledge

- **KnowledgeSource** — a source of truth for the AI. Fields: `id`, `tenantId`, `type` (WEBSITE / FILE / MANUAL), `name`, `sourceUrl`, `status` (PENDING / PROCESSING / READY / ERROR), `lastIngestedAt`, `metadata` (JSON)
- **KnowledgeChunk** — chunked, embedded text. Fields: `id`, `sourceId`, `tenantId`, `content`, `embedding` (vector), `metadata` (JSON: page URL, section, etc.), `tokenCount`. Has pgvector index on `embedding`.

### Channels

- **Channel** — a connected channel for a tenant. Fields: `id`, `tenantId`, `type` (WHATSAPP / INSTAGRAM / WIDGET), `displayName`, `status` (CONNECTED / DISCONNECTED / ERROR), `credentials` (JSON, encrypted), `config` (JSON), `createdAt`
- **Customer** — an end customer of a tenant (someone messaging the company). Fields: `id`, `tenantId`, `externalId` (channel-specific ID), `channelType`, `name`, `phone`, `email`, `metadata` (JSON), `firstSeenAt`, `lastSeenAt`. Unique on `(tenantId, channelType, externalId)`.
- **Conversation** — a thread. Fields: `id`, `tenantId`, `customerId`, `channelId`, `status` (ACTIVE / PAUSED / CLOSED / HUMAN_HANDLING), `aiEnabled`, `assignedUserId`, `lastMessageAt`, `summary`, `language`, `sentiment`, `metadata` (JSON)
- **Message** — a single message. Fields: `id`, `conversationId`, `tenantId`, `direction` (INBOUND / OUTBOUND), `sender` (CUSTOMER / AI / HUMAN_AGENT), `senderUserId` (nullable), `content`, `contentType` (TEXT / IMAGE / VOICE / FILE), `mediaUrl`, `aiMetadata` (JSON: model used, tokens, latency, confidence, sources used), `createdAt`

### Escalation

- **Escalation** — a flagged conversation needing human attention. Fields: `id`, `conversationId`, `tenantId`, `reason` (LOW_CONFIDENCE / NEGATIVE_SENTIMENT / EXPLICIT_REQUEST / OUTSIDE_SCOPE / PAYMENT_DISPUTE), `status` (PENDING / RESOLVED / DISMISSED), `resolvedByUserId`, `createdAt`, `resolvedAt`

### Audit / observability

- **AuditLog** — append-only log of significant actions. Fields: `id`, `tenantId`, `userId`, `action`, `targetType`, `targetId`, `metadata`, `createdAt`
- **UsageRecord** — for billing. Fields: `id`, `tenantId`, `period` (YYYY-MM), `messagesProcessed`, `aiTokensUsed`, `voiceMinutesProcessed`, `metadata`

---

## 7. Multi-tenancy strategy

**Approach:** row-level isolation with `tenantId` on every tenant-scoped table.

**Enforcement:**
- All Prisma queries go through helpers in `src/server/db/` that automatically inject `tenantId` from the request context
- Request context derived from URL path (`/[tenantSlug]/...`) or from session for super-admin routes
- A central `getTenantContext()` function used by every server action and API route
- Never trust client-provided `tenantId`

**URL strategy:** path-based (`messaging-ai.app/acme/dashboard`), not subdomain. Easier in v1, can add subdomain support later.

---

## 8. AI brain orchestration

### The main loop (per incoming message)

```
1. Receive message via channel webhook
2. Normalize to internal Message format
3. Persist to DB (status: pending AI)
4. Enqueue AI processing job (BullMQ)

Worker picks up job:
5. Detect language (cheap call to GPT-4o-mini)
6. Update conversation summary if needed
7. Retrieve top-K knowledge chunks via pgvector cosine similarity
8. Build prompt: system (tenant brand voice + tools) + history + retrieved context + new message
9. Call Claude Sonnet 4.6
10. Parse response: extract reply text, confidence, suggested escalation
11. Run safety/guardrail checks
12. Decide: reply automatically OR escalate to human
13. If reply: send via channel adapter, persist, update conversation
14. If escalate: create Escalation, notify tenant, leave conversation in HUMAN_HANDLING state
```

### Escalation triggers (any one fires)

- AI self-reports confidence below threshold (configurable per tenant, default 0.6)
- Sentiment classifier returns NEGATIVE with high score
- Customer message matches escalation patterns (refund, complaint, lawyer, manager request)
- Knowledge retrieval returns no chunks above similarity threshold
- Conversation has been going for N turns without resolution
- Customer explicitly asks for a human

### Brand voice

Every tenant has a `voiceProfile` in their settings: tone (formal / friendly / casual), formality level, signature phrases, things to avoid, default language, fallback language. Fed into the system prompt for every reply.

### Few-shot examples

Each tenant can store up to 20 example exchanges (customer message → ideal reply). These are auto-included in the system prompt for similar incoming messages. This is how we hit "doesn't sound like AI."

---

## 9. Phases (week-by-week)

Each phase ends with a working, demoable milestone. Each phase corresponds to one Claude Code session prompt.

### Phase 1 — Foundation (Days 1–2)

**Deliverable:** A running Next.js 15 app with the design system fully wired, a demo page showcasing typography / colors / motion, Prisma initialized, Docker Compose for local Postgres + Redis, .env.example, README, CLAUDE.md.

**Acceptance:** `npm run dev` shows a polished demo page at `/` proving the design system works. `docker compose up` boots Postgres + Redis. `npx prisma migrate dev` runs the starter schema.

### Phase 2 — Auth + multi-tenancy + dashboard shell (Days 3–5)

**Deliverable:** NextAuth working (magic link + Google), users can sign up, create a tenant, get redirected to `/[tenantSlug]/dashboard`. Sidebar shell with all nav items (mostly placeholder pages). Theme picker. ⌘K command palette skeleton. Super-admin route gated.

**Acceptance:** Sign up → create tenant → land on dashboard. Sidebar nav works. Different tenants are properly isolated.

### Phase 3 — Knowledge ingestion + RAG (Days 6–9)

**Deliverable:** "Knowledge" page where tenants paste a website URL (Firecrawl crawls it), upload files (LlamaParse parses them), or add manual entries. Chunks are embedded (Voyage) and stored in pgvector. A retrieval test UI lets you query and see top results.

**Acceptance:** Paste a URL → see crawl progress → see chunks appear → query "what are your shipping costs?" and get relevant chunks back.

### Phase 4 — AI brain (Days 10–12)

**Deliverable:** "Playground" page where you chat with the tenant's AI. Streaming responses. The full orchestration loop (language detection → retrieval → Claude call → response). System prompts built from tenant voice profile + retrieved chunks. Multi-language working (AR / FR / EN / Darija).

**Acceptance:** In the playground, you can chat in any of the 4 languages, get coherent on-brand answers grounded in the knowledge base, see streaming, see which chunks were used.

### Phase 5 — Channel: website widget (Days 13–14)

**Deliverable:** A standalone JS widget (separate build in `widget/`) that any client embeds with one `<script>` tag. Beautiful chat UI matching the design system. Connects via WebSocket / SSE to backend. Conversation persists, AI replies through the brain from Phase 4. Live conversation view in dashboard.

**Acceptance:** Embed widget on a test HTML page → message it → AI replies → see conversation in dashboard in real time.

### Phase 6 — Channel: WhatsApp via 360dialog (Days 15–17)

**Deliverable:** Tenant connects their 360dialog credentials in Channels page. Inbound webhook handles incoming WhatsApp messages, routes to AI brain, sends replies. Templates for outbound. Same conversation UI as widget.

**Acceptance:** Real WhatsApp number sends a message → arrives in dashboard → AI replies → reply lands in WhatsApp.

### Phase 7 — Channel: Instagram (Days 18–19)

**Deliverable:** Meta OAuth flow for tenant to connect their IG Business account. Webhook handles IG DMs, routes to AI brain, replies via Graph API.

**Acceptance:** DM the connected IG account → AI replies in IG.

### Phase 8 — Human handoff + escalation (Days 20–22)

**Deliverable:** Confidence scoring, sentiment detection, escalation rules engine, live takeover UI (agent can pause AI on a conversation and reply manually), notifications (in-app + email), shared inbox view.

**Acceptance:** Trigger an escalation (angry customer message), see the notification, take over, reply as agent, hand back to AI.

### Phase 9 — Onboarding wizard + billing (Days 23–25)

**Deliverable:** The "5-minute setup" wizard — paste URL, crawl runs, review, connect first channel, done. Stripe billing with three plans (Starter / Pro / Business), usage metering, plan limits enforced, billing portal.

**Acceptance:** Brand-new user signs up and goes from zero to "AI is replying" in under 5 minutes. Subscriptions can be created, upgraded, cancelled.

### Phase 10 — Polish, observability, deploy (Days 26–30)

**Deliverable:** Sentry + PostHog wired in, rate limiting, retry logic, error boundaries, loading states everywhere, empty states, accessibility audit, performance audit (LCP < 1.5s on dashboard), Railway production deployment, Supabase production database, custom domain, Stripe live mode.

**Acceptance:** Production URL live. Real test client can sign up and use the product end-to-end without bugs.

---

## 10. Phase prompts (paste these in order)

These are the exact prompts to paste into Claude Code at the start of each phase. Each one assumes `MASTER_PLAN.md` is in the project root.

### Phase 1
```
Read MASTER_PLAN.md fully. Execute Phase 1 (Foundation).

Before writing any code, show me:
1. The final folder structure you'll create
2. The exact design token values you'll set
3. The list of npm packages you'll install with versions
4. The Prisma starter schema for Phase 1

Wait for my approval, then build. Commit to git after each meaningful step. End by running the dev server and reporting that the demo page is live. Also create CLAUDE.md that references MASTER_PLAN.md as the source of truth for all future sessions.
```

### Phase 2
```
Phase 1 is complete and verified. Read MASTER_PLAN.md fully. Execute Phase 2 (Auth + multi-tenancy + dashboard shell). Show me the auth flow design and route structure for approval before building.
```

### Phase 3
```
Phase 2 is complete and verified. Read MASTER_PLAN.md fully. Execute Phase 3 (Knowledge ingestion + RAG). Confirm Firecrawl, LlamaParse, and Voyage API keys are present in .env before starting; if not, list exactly what's missing.
```

### Phase 4
```
Phase 3 is complete and verified. Read MASTER_PLAN.md fully. Execute Phase 4 (AI brain). Confirm Anthropic and OpenAI API keys are present. Show me the system prompt design for the four languages before building.
```

### Phase 5
```
Phase 4 is complete and verified. Read MASTER_PLAN.md fully. Execute Phase 5 (Website widget). The widget build lives in /widget and is separate from the main app. Show me the widget UI mockup (as code) before integrating with the backend.
```

### Phase 6
```
Phase 5 is complete and verified. Read MASTER_PLAN.md fully. Execute Phase 6 (WhatsApp via 360dialog). Confirm 360dialog credentials are available. If they aren't yet, build the integration scaffold and webhook handler with mocked responses so I can plug in the real keys later without code changes.
```

### Phase 7
```
Phase 6 is complete and verified. Read MASTER_PLAN.md fully. Execute Phase 7 (Instagram). Same approach as Phase 6 for missing credentials — build with mocks if needed.
```

### Phase 8
```
Phase 7 is complete and verified. Read MASTER_PLAN.md fully. Execute Phase 8 (Human handoff + escalation). Show me the escalation rules engine design before implementing.
```

### Phase 9
```
Phase 8 is complete and verified. Read MASTER_PLAN.md fully. Execute Phase 9 (Onboarding wizard + billing). Confirm Stripe API keys are present. Show me the wizard step-by-step flow before building.
```

### Phase 10
```
Phase 9 is complete and verified. Read MASTER_PLAN.md fully. Execute Phase 10 (Polish, observability, deploy). Produce a deployment checklist before starting and confirm Railway, Supabase, Upstash, Sentry, PostHog accounts and keys are ready.
```

---

## 11. Required environment variables

These belong in `.env.example` and need real values in `.env.local` (dev) and Railway (production).

```
# App
NEXT_PUBLIC_APP_URL=
NEXTAUTH_URL=
NEXTAUTH_SECRET=

# Database
DATABASE_URL=
DIRECT_DATABASE_URL=

# Redis
REDIS_URL=

# Auth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
RESEND_API_KEY=

# AI
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
VOYAGE_API_KEY=

# Knowledge
FIRECRAWL_API_KEY=
LLAMAPARSE_API_KEY=

# Channels
WHATSAPP_360DIALOG_API_KEY=
META_APP_ID=
META_APP_SECRET=
META_VERIFY_TOKEN=

# Billing
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_STARTER=
STRIPE_PRICE_PRO=
STRIPE_PRICE_BUSINESS=

# Observability
SENTRY_DSN=
POSTHOG_KEY=

# Encryption (for storing channel credentials)
ENCRYPTION_KEY=
```

---

## 12. Definition of done (every phase)

A phase is not "complete" until all of the following are true:

1. All deliverables in the phase description are working
2. Code is committed to git with meaningful messages
3. No TypeScript errors
4. No ESLint errors
5. The dev server runs cleanly
6. The acceptance criteria for the phase have been demonstrated to the project lead
7. CLAUDE.md is updated if any conventions changed
8. MASTER_PLAN.md is updated if any architecture decisions changed (with project lead approval)

---

## 13. Things Claude Code must never do

- Never deviate from the locked stack without explicit approval
- Never skip approval gates ("show me X before building Y")
- Never commit secrets to git
- Never disable type checking or eslint to "make it work"
- Never use `any` type without a comment explaining why
- Never write a chatbot reply prompt without language-detection + brand-voice injection
- Never make a Prisma query without going through `src/server/db/` helpers
- Never call an LLM API directly outside `src/server/ai/`
- Never trust client-provided `tenantId`
- Never hard-code colors, font sizes, spacing, or motion values — always use the design tokens

---

## 14. Open questions / future decisions

To be revisited at the appropriate phase:

- Voice messages (v1.1): which STT provider — NeuralSpace vs OpenAI gpt-4o-transcribe — depends on real Darija benchmarking
- Email channel (v1.1): Gmail OAuth + IMAP fallback architecture
- Messenger (v1.1): same Meta App as Instagram, just additional permissions
- White-label option (v2): subdomain-based tenancy
- Mobile app (v2): React Native or just a great PWA?
- Fine-tuned Darija model (v2): if prompt-based Darija quality plateaus, train an open model
