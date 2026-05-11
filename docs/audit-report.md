# Operator-pages functional audit — 2026-05-05

Read-only diagnosis. No code changes during this audit.

Method: dev server started fresh on `:3000`. JWT forged for
`abdelghani.agu@gmail.com` (the actual user — note the audit prompt's
spelling `.ague` was a typo) per CLAUDE.md §6, salt
`authjs.session-token`. Routes curl'd with the cookie attached. HTML
return checked for runtime overlay, soft errors, and expected content
markers. Server Actions exercised where round-trippable; the rest noted
as manual.

Workspace under test: **`/wbp`** (Owner, isSuperAdmin=true). State at
start: 1 widget channel CONNECTED; no conversations, no knowledge
sources, no items, no Q&A, no gaps. Empty-state coverage is
representative. The `acme-test` tenant was used for the populated
flows (real conversation, real Knowledge Source).

## Tenant-app surfaces

### /wbp/dashboard
- Status: **500 on first cold-cache request, 200 on every subsequent
  request** (5/5 retries). Reproducible, not flaky.
- Renders: clean once warm.
- Root cause: `DATABASE_URL` has `connection_limit=1` and no
  `pool_timeout` override. Dashboard kicks off three parallel queries
  (`getDashboardMetrics` + `getRecentActivity` from
  `dashboard-metrics.ts:55,123`, plus the layout's `getRoutingUser`).
  With pool size 1, queries 2 and 3 queue on a single Prisma client
  connection and trip the 10s default `pool_timeout`. Once warm, the
  connection is reused and the dashboard renders.
- **This is the exact regression CLAUDE.md §6 explicitly warns
  against**: "do not lower it back to 1." The fix is documented in
  CLAUDE.md (`?pgbouncer=true&connection_limit=10&pool_timeout=20`),
  but per the audit hard rules, NOT applied here.
- Interactions tested: KPI row, perf chart, activity timeline render
  the empty/onboarding-strip composition correctly when warm
  (`metrics.hasAnyChannelConnected` is false until inbound traffic
  lands; widget messages from the cross-cutting check below flipped it
  to true).
- Manual-test items: visual fidelity of KPIs / chart axes / timeline
  spacing under a populated tenant.

### /wbp/conversations
- Status: 200.
- Renders: clean. "No conversations" empty state on first hit; after
  cross-cutting widget POSTs, both `audit-tester-1` and `audit-tester-2`
  conversations appear in the list.
- Interactions tested: page-level SSR re-fetch picks up newly-created
  conversations from the widget endpoint within the next render
  (verified). Channel filter pills are static markup in the rendered
  HTML — wbp only has WIDGET, others are disabled.
- Interactions verified by code: 4s polling fires from
  `conversations-list-client.tsx:74` via the `listConversations`
  Server Action (`src/server/conversations/actions.ts:18`).
- Manual-test items: clicking the channel filter pills (WhatsApp /
  Messenger / Instagram are render-disabled until wired); confirming
  the polling live-fetch updates the visible list (the "polling…"
  pulse indicator on the page header).

### /wbp/conversations/[id]
- Status: 200 against the conversation created by the widget round-trip
  (`cmot03rrm0003eowozp0e6a1g`).
- Renders: clean. Customer message, AI reply, "Read-only" banner, and
  message count chip all present.
- Interactions tested: page rendered the correct customer external ID
  ("audit-tester-1"), 2-message count, and the AI's actual reply text.
- Manual-test items: per-message citations sidebar (no citations on
  this conversation since wbp has no knowledge); 4s polling on
  `conversation-detail-client.tsx:74` re-fetching new messages.

### /wbp/knowledge
- Status: 200.
- Renders: "Documents" page header + "Add source" CTA. Empty state.
- Interactions: "Add source" modal trigger and retrieval test panel
  are React-only client interactions; cannot exercise via curl.
- Manual-test items: opening the Add-source modal; upload flow for
  FILE source; URL-paste flow for WEBSITE source; retrieval test panel
  (needs at least one embedded source — wbp has none, but acme-test
  has the docs.upstash.com source if testing on that tenant).

### /wbp/knowledge/[sourceId]
- Status: 404 for fake IDs (verified). Used the acme-test tenant's
  source `cmoiftw4o0001eop49b4pt1x5` to verify rendering.
- Renders: clean. "Source · messaging-ai" title; "Chunks" / "Delete" /
  "Ready" status markers all present.
- Manual-test items: Reingest button; Delete confirmation; chunk-row
  inspector.

### /wbp/knowledge/items
- Status: 200.
- Renders: "Products" header, "Mark all verified" present, empty list.
- Manual-test items: Create item modal; Edit / Delete row actions;
  bulk verify; smart import path.

### /wbp/knowledge/items/import
- Status: 200.
- Renders: clean (paste-text smart import surface).
- Manual-test items: paste a real catalog → click Import → verify
  Anthropic structureItemsFromText returns shaped JSON and Server
  Action persists rows. (CLAUDE.md §7a documents this needs human
  quality review; `npm run probe:smart-import` exists for shape
  checks.)

### /wbp/knowledge/qna
- Status: 200.
- Renders: clean.
- Manual-test items: Create / Edit / Delete Q&A pairs; bulk delete;
  language filter.

### /wbp/knowledge/business-info
- Status: 200.
- Renders: clean.
- Manual-test items: long-form save action (`saveOperationalFacts`).

### /wbp/knowledge/live-data
- Status: 200.
- Renders: placeholder page (Phase 8 deferred; intended).

### /wbp/knowledge/gaps
- Status: 200.
- Renders: "Knowledge gaps" page header, "No gaps" empty state, the
  "Resolve" affordance markup. wbp has 0 gaps; the LOW_CONFIDENCE
  audit-tester messages above did NOT log gaps because the brain
  output's `claudeReason` was `LOW_CONFIDENCE` (not `OUTSIDE_SCOPE`).
- Manual-test items: gap-cluster rendering on a tenant that has gaps;
  "Resolve to Q&A" + "Dismiss" actions.

### /wbp/channels
- Status: 200.
- Renders: clean. WIDGET shows "Connected" pill; the other three
  (WhatsApp / Messenger / Instagram) render as not-connected rows.
- Manual-test items: visual hover/click states.

### /wbp/channels/widget
- Status: 200.
- Renders: clean. The wbp widget is CONNECTED with publicKey
  `wgt_pk_56ff08c22eeef2eac58c7da5d2542291`.
- Interactions tested: the widget public key was used to drive the
  `/api/widget/messages` round-trip (cross-cutting #33 below) end to
  end successfully.
- Manual-test items: the rotate-key button (`rotateWidgetKey`); origin
  allowlist edit (`updateWidgetConfig`); Server Action UI is rendered
  but actions need a real form submit.

### /wbp/channels/whatsapp
- Status: 200.
- Renders: clean. wbp does not have a WhatsApp channel — connect form
  shown.
- Manual-test items: connect-form Server Action
  (`connectWhatsAppChannel`); the encrypted-credentials envelope path;
  webhook secret rotation.

### /wbp/channels/messenger
- Status: 200.
- Renders: clean. Connect surface.
- Manual-test items: Meta OAuth preview (`previewFacebookPage` →
  `confirmFacebookPage`); requires real Meta App or stub flow.

### /wbp/channels/instagram
- Status: 200.
- Renders: clean. Connect surface.
- Manual-test items: same Meta OAuth flow as Messenger.

### /wbp/playground
- Status: 200.
- Renders: placeholder page with phaseNote="Phase 4".
- **Note explicitly per audit instruction**: Phase 4 backend is fully
  shipped (orchestrator, real Claude client, streaming, eval) but the
  Playground operator-facing UI is deferred per CLAUDE.md §7a's
  closing notes. The widget already exercises the brain end-to-end.
  Replacing this placeholder is acceptably-deferred work, NOT a
  regression.

### /wbp/settings
- Status: 307 → /wbp/settings/general (correct).

### /wbp/settings/general
- Status: 200.
- Renders: clean. "Workspace name" form, "Save changes" CTA visible.
- Manual-test items: name save action (`updateTenantNameAction`).

### /wbp/settings/members
- Status: 200.
- Renders: clean. Members list.
- Manual-test items: invite/remove member flows (Phase 9 work, may
  not yet exist as Server Actions — confirm against MASTER_PLAN).

### /wbp/billing
- Status: 200 for OWNER (which Ghani is).
- Renders: placeholder page (Phase 9 deferred; intended).
- Manual-test items: confirm AGENT/VIEWER hits 403 (the
  `requireTenantContext(slug, { minRole: "OWNER" })` chokepoint is in
  place at `billing/page.tsx:17`).

## Auth surfaces

### /login
- Status: 200 (logged out).
- Renders: clean. "Sign in", "Continue with Google", "Email" magic-link
  field present.
- Manual-test items: magic-link form submit triggers
  `signInWithEmail` (`src/server/auth/actions.ts:20`) which calls
  `signIn("resend", ...)`. Resend API key is configured;
  `EMAIL_FROM` is unset so the default `onboarding@resend.dev`
  applies (works for testing only when the recipient is the verified
  Resend sender). **Cannot confirm via curl that an email actually
  arrives.**
- Manual-test items: Google OAuth round-trip.

### /signup
- Status: 200.
- Renders: clean. Same shape as /login; "Continue with Google" + email
  field.
- Manual-test items: same as /login.

### /verify-request
- Status: 200.
- Renders: clean. "Check your email" + "magic link" + "Verify" copy.

### /onboarding/create-tenant
- **Logged-out**: 307 → /post-auth (which itself routes the user to
  /login).
- **Logged-in (existing membership), no `?intent=add`**: 307 →
  /post-auth. **Commit 0fbcef0's guard works as intended.**
- **Logged-in, `?intent=add`**: 200, form renders with "Workspace
  name", "slug", "Create workspace" CTA.
- Manual-test items: form submit (`createTenantAction`).

## Sidebar / chrome interactions

### Workspace switcher dropdown (item 26)
- Markup present in the rendered HTML; the user's three memberships
  (WBP, Acme Test, Ghani) are all listed.
- "Create workspace" link points to `?intent=add` (verified at
  `workspace-switcher.tsx:120`).
- Manual-test items: opening the dropdown (Radix client-only); the
  workspace-switch Server Action (`switchWorkspaceAction`).

### Command palette (Cmd+K) (item 27) — **BROKEN**
- **Bug found.** The `CommandPalette` component (mounted in
  `src/app/(app)/[tenantSlug]/layout.tsx:69-74`) listens for a custom
  `command-palette:open` window event. The keydown listener that
  dispatches that event lives in `CommandPaletteTrigger`
  (`src/components/app/command-palette-trigger.tsx`). **That
  component is never imported anywhere.** Verified by grepping:
  `grep -r "CommandPaletteTrigger"` returns only the file itself plus
  a comment in `sidebar.tsx:49` that claims "the global keybinding
  still works (see CommandPaletteTrigger's keydown handler in the
  layout)" — but the layout doesn't actually mount it.
- Impact: ⌘K / Ctrl-K does nothing. The visible Search button (which
  lived in the same component) is also gone. The palette can only be
  opened via direct programmatic dispatch — i.e. nowhere in v1.
- Per audit hard rules, NOT fixed here. One-line fix would be either
  (a) re-mount `<CommandPaletteTrigger />` somewhere in the chrome,
  or (b) move the keydown logic into `CommandPalette` itself and
  delete the trigger file.

### User menu (item 28)
- Markup present. "Theme" submenu and the user's email
  (abdelghani.agu) render. Sign out wired to `signOutAction` per
  `user-menu.tsx`.
- Manual-test items: dropdown open (Radix); Theme submenu;
  signout round-trip.

### Sidebar collapse (item 29)
- localStorage key `sidebar-collapsed` (`sidebar.tsx:14`).
- Manual-test items: toggling persists across reload; the AI Brain
  bar's expanded↔collapsed crossfade animation; the framer-motion
  width transition.

### Theme toggle (item 30)
- Wired in `use-theme-switcher.ts` via `next-themes`'s `setTheme`,
  with View Transitions API or 220ms CSS-variable fallback.
- Manual-test items: light-mode visual fidelity (audit prompt called
  this out as "visually unvalidated"); switching path on
  Chromium-vs-Firefox; confirming no double-animation flicker.

## Cross-cutting checks

### #31 — Server Actions success/error
Cataloged 36 server actions across 11 files. Only round-trippable
actions exercised:
- `listConversations` (verified — list re-renders with new
  conversations)
- Widget channel was created in earlier seed; the Server Action
  `enableWidgetChannel` was not exercised this session
- Auth `signInWithEmail` Zod-validates input (`actions.ts:24`); error
  state shape is correct
- The remaining actions (knowledge items / qna / channels meta /
  whatsapp / billing) require real form submits via the rendered
  pages — manual.

### #32 — Polling on /conversations and /conversations/[id]
- `POLL_INTERVAL_MS = 4000` confirmed in both
  `conversations-list-client.tsx:29` and
  `conversation-detail-client.tsx:28`.
- Polling implementation: `useEffect` with `setInterval` calling
  `listConversations` / `getConversationDetail` Server Actions
  (functional verification via SSR re-fetch).
- Manual-test items: open the page in a browser, watch network panel
  fire every 4s.

### #33 — Widget streaming endpoint — **WORKING**
- `POST /api/widget/messages` with the wbp public key
  (`wgt_pk_56ff08c22eeef2eac58c7da5d2542291`) returned a clean SSE-shaped
  stream:
  - 9 `delta` chunks with byte-level streaming text
    ("Hello! T", "hank you", " for rea", ...)
  - 1 terminal `done` event with conversationId, full reply,
    language="en", citations=[], computedConfidence=0,
    escalation="LOW_CONFIDENCE", displayName="Website chat"
- Conversation persisted (`cmot03rrm0003eowozp0e6a1g`), surfaced in
  `/wbp/conversations` inbox SSR, and rendered correctly in the
  detail view. End-to-end Phase 4 brain pipeline confirmed live
  against real Anthropic Sonnet 4.5.
- LOW_CONFIDENCE escalation correctly triggered (no knowledge for the
  wbp tenant → confidence floor → handoff path).
- Second message (`audit-tester-2`) round-tripped identically.
  CONNECT-time and stream-end overhead acceptable.

## Summary

- **Total pages tested**: 25 (21 tenant-app + 4 auth, plus 1
  redirect on /wbp/settings).
- **Pages working end-to-end**: 24/25 once Prisma pool is warm.
- **Pages with broken interactions**: 1 — chrome-level: the global
  ⌘K shortcut is dead (the keybinding component is unmounted).
- **Pages with manual-test items**: every page that renders a
  Server-Action-backed form (knowledge create/edit/delete; channel
  connect; settings save; auth magic link; theme toggle visual; OAuth
  flows). See per-page sections.
- **Surprising findings**:
  1. **Dashboard 500 on cold cache is the exact CLAUDE.md §6
     `connection_limit=1` regression.** The Knowledge-base entry
     ("Do not lower it back to 1") was added precisely because of
     this failure. The .env.local currently violates it — first hit
     of any page that issues parallel Promise.all queries trips
     pool_timeout. Dashboard, dashboard-metrics, recent-activity, and
     getRoutingUser all queue against connection_limit=1 and the
     slowest one wins.
  2. **⌘K is broken.** `CommandPaletteTrigger` orphaned —
     keybinding listener never mounted in the React tree, and the
     visible Search button it carried is gone with it. The
     `CommandPalette` host listens for `command-palette:open` but
     no component dispatches that event in v1. Visible side-effect:
     the palette appears unreachable to keyboard-only users.
  3. **Phase 4 brain end-to-end is clean.** Real Anthropic 4.5 reply
     streamed under 2s with byte-level SSE deltas, persisted to
     Postgres, surfaced in inbox + detail views, escalation logic
     fired on a low-knowledge tenant. The widget exercises Phase 4
     better than a Playground UI would have, which validates the
     CLAUDE.md §7a deferral choice.
  4. **First-hit response times are 7–11s for most operator pages**
     and 17–19s for /dashboard on a cold pool. This is the dev-mode
     compile + Prisma cold-start tax; not something to "fix" but
     worth flagging if the team wants to hand the app to anyone for
     hands-on review.
  5. **Three minor warnings** in the dev log are noise:
     - bullmq `child-processor.js` "request of a dependency is an
       expression" (BullMQ ESM build, ignored upstream)
     - DEP0169 `url.parse` deprecation (internal Next.js usage)
     - empty-line `prisma:error` lines (Prisma error output
       formatting)
     None are actionable.

## Notes for the project lead

- The `connection_limit=1` regression should be fixed by editing
  `.env.local` per CLAUDE.md §6. The fix is a single-line config
  change, not code.
- The ⌘K bug is one of:
  - re-mount `<CommandPaletteTrigger />` somewhere visible (e.g.
    the sidebar's collapse-row, or the page-header chrome), OR
  - inline the keydown listener directly in `CommandPalette` (it
    already lives in the layout) and delete `command-palette-trigger.tsx`
- All surfaces excluded from this audit (admin, post-auth, the
  marketing landing page) were not requested. They render fine in
  spot checks but were not exhaustively covered.
- Audit-temp scripts left in `scripts/_audit-*` were used during
  this session; safe to delete (they're git-untracked).
