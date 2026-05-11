# `messaging-ai` UI current-state report

Read-only snapshot of the codebase as of `git HEAD` = `e30c7ae` (Phase 4 P4r-7 — Sonnet 4.5 pin + Algerian Darija coaching). Working directory is clean. The recipient of this report should not assume anything beyond what's stated here; if a section is silent on a thing, assume it does not exist in the repo.

---

## 1. Repo & stack snapshot

### `src/` tree (depth 3)

```
src/
├── app/
│   ├── (admin)/
│   │   └── admin/
│   ├── (app)/
│   │   └── [tenantSlug]/
│   ├── (auth)/
│   │   ├── login/
│   │   ├── onboarding/
│   │   ├── signup/
│   │   └── verify-request/
│   ├── (marketing)/
│   ├── api/
│   │   ├── auth/
│   │   ├── dev/
│   │   ├── meta/
│   │   ├── whatsapp/
│   │   └── widget/
│   └── post-auth/
├── components/
│   ├── app/
│   │   ├── channels/
│   │   ├── conversations/
│   │   ├── gaps/
│   │   ├── items/
│   │   ├── knowledge/
│   │   ├── operational-facts/
│   │   └── qna/
│   ├── auth/
│   ├── icons/                    # empty
│   ├── marketing/                # empty
│   ├── motion/
│   ├── onboarding/
│   └── ui/
├── hooks/
├── lib/
├── server/
│   ├── ai/
│   │   └── prompts/
│   ├── auth/
│   ├── billing/                  # empty
│   ├── channels/
│   │   ├── instagram/
│   │   ├── messenger/
│   │   ├── meta/
│   │   ├── whatsapp/
│   │   └── widget/
│   ├── conversations/
│   ├── db/
│   ├── escalation/               # empty
│   ├── knowledge/
│   │   ├── gaps/
│   │   ├── items/
│   │   ├── operational-facts/
│   │   └── qna/
│   ├── queue/
│   │   └── workers/
│   ├── storage/
│   └── tenancy/
├── styles/                        # empty
└── types/                         # next-auth.d.ts only
```

The `(marketing)` route group exists but has no `page.tsx` — there is no public landing page yet. The root `/` is served by `src/app/page.tsx` directly (the Phase 1 design-system demo). `src/components/marketing/` and `src/components/icons/` exist as empty directories; no marketing components or custom icons have been authored.

### UI-relevant `package.json` versions

```json
{
  "dependencies": {
    "next": "^15.5.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "next-auth": "^5.0.0-beta.31",
    "next-themes": "^0.4.4",

    "tailwindcss": "^4.1.0",
    "@tailwindcss/postcss": "^4.1.0",
    "tailwind-merge": "^2.6.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "prettier-plugin-tailwindcss": "^0.6.9",

    "framer-motion": "^11.18.0",
    "lucide-react": "^0.460.0",
    "geist": "^1.3.1",
    "cmdk": "^1.1.1",

    "@radix-ui/react-avatar": "^1.1.11",
    "@radix-ui/react-dropdown-menu": "^2.1.16",
    "@radix-ui/react-slot": "^1.1.1",
    "@radix-ui/react-tooltip": "^1.2.8"
  }
}
```

`tailwindcss` is v4; `@tailwindcss/postcss` is the v4 PostCSS plugin. There is **no `tailwind.config.ts` / .js / .mjs at the repo root or anywhere else** — Phase 1 deviation per `MASTER_PLAN.md` §5: tokens are configured CSS-first via `@theme inline` in `src/app/globals.css`. Confirmed by `find -name tailwind.config.*` returning no results.

There is no shadcn `components.json`; primitives are written by hand against Radix + CVA rather than scaffolded by the shadcn CLI.

### Token locations

- **CSS tokens:** `src/app/globals.css` — `:root` / `[data-theme="dark"]` / `[data-theme="light"]` blocks plus a `@theme inline` block that surfaces them as Tailwind v4 utility classes.
- **JS tokens:** `src/lib/design-tokens.ts` — typed constants (`colors`, `radii`, `shadows`, `typography`, `gradients`) for code paths that can't read CSS vars (Framer Motion `style` props, canvas, etc.).
- **Motion tokens:** `src/lib/motion.ts` — easing curves, durations, spring presets, reusable Framer Motion variants.
- **Widget tokens (separate build):** `widget/src/tokens.ts` (generated from the canonical `src/lib/design-tokens.ts` via `scripts/generate-widget-tokens.ts`; pre-commit hook `widget:check-tokens` verifies they're in sync). Widget styling is otherwise self-contained in `widget/src/styles.css`.

---

## 2. Design tokens — full source

### `src/app/globals.css`

```css
@import "tailwindcss";

/* =========================================================================
   Design tokens — Direction A: Linear-inspired, electric violet on charcoal.
   Source of truth: MASTER_PLAN.md §4. Do not hard-code these values anywhere
   else in the app.
   ========================================================================= */

:root,
[data-theme="dark"] {
  /* Backgrounds */
  --bg-base: #0a0a0b;
  --bg-surface: #111113;
  --bg-surface-elevated: #18181b;
  --bg-surface-overlay: #1f1f23;

  /* Borders */
  --border-subtle: #1f1f23;
  --border-default: #27272a;
  --border-strong: #3f3f46;

  /* Text */
  --text-primary: #fafafa;
  --text-secondary: #a1a1aa;
  --text-tertiary: #71717a;
  --text-disabled: #52525b;

  /* Accent (electric violet) */
  --accent-base: #7c3aed;
  --accent-hover: #8b5cf6;
  --accent-active: #6d28d9;
  --accent-glow: rgba(124, 58, 237, 0.35);
  --accent-secondary: #06b6d4;

  /* Semantic */
  --success: #10b981;
  --warning: #f59e0b;
  --danger: #ef4444;

  /* Gradients */
  --gradient-primary: linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%);
  --gradient-mesh:
    radial-gradient(at 27% 37%, hsla(265, 75%, 55%, 0.18) 0px, transparent 50%),
    radial-gradient(at 97% 21%, hsla(189, 75%, 55%, 0.12) 0px, transparent 50%),
    radial-gradient(at 52% 99%, hsla(280, 75%, 55%, 0.1) 0px, transparent 50%);

  /* Radius */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-2xl: 24px;
  --radius-full: 9999px;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.5);
  --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.55);
  --shadow-glow: 0 0 32px var(--accent-glow);
  --shadow-glow-strong:
    0 0 64px var(--accent-glow), 0 0 16px var(--accent-glow);
}

[data-theme="light"] {
  --bg-base: #ffffff;
  --bg-surface: #fafafa;
  --bg-surface-elevated: #f4f4f5;
  --bg-surface-overlay: #e4e4e7;

  --border-subtle: #e4e4e7;
  --border-default: #d4d4d8;
  --border-strong: #a1a1aa;

  --text-primary: #18181b;
  --text-secondary: #3f3f46;
  --text-tertiary: #71717a;
  --text-disabled: #a1a1aa;

  --accent-base: #6d28d9;
  --accent-hover: #7c3aed;
  --accent-active: #5b21b6;
  --accent-glow: rgba(109, 40, 217, 0.25);
  --accent-secondary: #0891b2;

  --success: #059669;
  --warning: #d97706;
  --danger: #dc2626;

  --gradient-primary: linear-gradient(135deg, #6d28d9 0%, #0891b2 100%);
  --gradient-mesh:
    radial-gradient(at 27% 37%, hsla(265, 75%, 55%, 0.1) 0px, transparent 50%),
    radial-gradient(at 97% 21%, hsla(189, 75%, 55%, 0.08) 0px, transparent 50%),
    radial-gradient(at 52% 99%, hsla(280, 75%, 55%, 0.06) 0px, transparent 50%);

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.06);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);
  --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.12);
}

/* =========================================================================
   Tailwind v4 @theme — surfaces tokens as utility classes.
   Use bg-base, text-primary, border-subtle, rounded-lg, shadow-glow, etc.
   ========================================================================= */

@theme inline {
  /* Colors */
  --color-bg-base: var(--bg-base);
  --color-bg-surface: var(--bg-surface);
  --color-bg-surface-elevated: var(--bg-surface-elevated);
  --color-bg-surface-overlay: var(--bg-surface-overlay);

  --color-border-subtle: var(--border-subtle);
  --color-border-default: var(--border-default);
  --color-border-strong: var(--border-strong);

  --color-text-primary: var(--text-primary);
  --color-text-secondary: var(--text-secondary);
  --color-text-tertiary: var(--text-tertiary);
  --color-text-disabled: var(--text-disabled);

  --color-accent: var(--accent-base);
  --color-accent-hover: var(--accent-hover);
  --color-accent-active: var(--accent-active);
  --color-accent-secondary: var(--accent-secondary);

  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-danger: var(--danger);

  /* Fonts — variables come from `geist` package via root layout */
  --font-sans: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, "SF Mono", monospace;

  /* Type scale (line-height embedded in Tailwind v4 syntax) */
  --text-display: 3.5rem;
  --text-display--line-height: 1.05;
  --text-display--font-weight: 700;
  --text-display--letter-spacing: -0.02em;

  --text-h1: 2.5rem;
  --text-h1--line-height: 1.1;
  --text-h1--font-weight: 600;
  --text-h1--letter-spacing: -0.02em;

  --text-h2: 2rem;
  --text-h2--line-height: 1.15;
  --text-h2--font-weight: 600;
  --text-h2--letter-spacing: -0.015em;

  --text-h3: 1.5rem;
  --text-h3--line-height: 1.2;
  --text-h3--font-weight: 600;
  --text-h3--letter-spacing: -0.01em;

  --text-h4: 1.25rem;
  --text-h4--line-height: 1.3;
  --text-h4--font-weight: 500;

  --text-body-lg: 1.125rem;
  --text-body-lg--line-height: 1.55;

  --text-body: 0.9375rem;
  --text-body--line-height: 1.6;

  --text-body-sm: 0.8125rem;
  --text-body-sm--line-height: 1.55;

  --text-caption: 0.75rem;
  --text-caption--line-height: 1.4;

  /* Radius */
  --radius-sm: var(--radius-sm);
  --radius-md: var(--radius-md);
  --radius-lg: var(--radius-lg);
  --radius-xl: var(--radius-xl);
  --radius-2xl: var(--radius-2xl);
  --radius-full: var(--radius-full);

  /* Shadows */
  --shadow-sm: var(--shadow-sm);
  --shadow-md: var(--shadow-md);
  --shadow-lg: var(--shadow-lg);
  --shadow-glow: var(--shadow-glow);
  --shadow-glow-strong: var(--shadow-glow-strong);
}

/* =========================================================================
   Base layer — apply tokens to html/body so the whole app inherits.
   ========================================================================= */

html {
  color-scheme: dark;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

[data-theme="light"] {
  color-scheme: light;
}

body {
  background-color: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: var(--text-body);
  line-height: var(--text-body--line-height);
  font-feature-settings: "ss01", "cv11";
}

::selection {
  background-color: var(--accent-base);
  color: var(--text-primary);
}

/* Focus ring — uses accent token, matches Linear's restrained style */
*:focus-visible {
  outline: 2px solid var(--accent-base);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

/* =========================================================================
   Theme-switch transition (CSS-variable fallback)

   Browsers without document.startViewTransition (Firefox today, older
   Safari) fall back to this: useThemeSwitcher() adds the
   `.theme-transitioning` class for ~220ms during a theme change, then
   removes it. While the class is on, every element animates between the
   old and new color tokens with a 200ms ease-out-expo curve. We only
   transition color-related properties so day-to-day hover states keep
   their snappy 150ms timings and don't double-animate.

   Respects prefers-reduced-motion: users who opt out get an instant swap.
   ========================================================================= */

@media (prefers-reduced-motion: no-preference) {
  .theme-transitioning,
  .theme-transitioning *,
  .theme-transitioning *::before,
  .theme-transitioning *::after {
    transition:
      background-color 200ms cubic-bezier(0.16, 1, 0.3, 1),
      color 200ms cubic-bezier(0.16, 1, 0.3, 1),
      border-color 200ms cubic-bezier(0.16, 1, 0.3, 1),
      fill 200ms cubic-bezier(0.16, 1, 0.3, 1),
      stroke 200ms cubic-bezier(0.16, 1, 0.3, 1) !important;
  }
}
```

### `src/lib/design-tokens.ts`

```ts
/**
 * Design tokens as TypeScript constants — for any code path that can't reach
 * CSS variables (Framer Motion `style`, canvas, JS-driven animations, etc.).
 *
 * Source of truth: MASTER_PLAN.md §4. The CSS-side definitions live in
 * src/app/globals.css. Keep these two in sync.
 */

export const colors = {
  bg: {
    base: "#0A0A0B",
    surface: "#111113",
    surfaceElevated: "#18181B",
    surfaceOverlay: "#1F1F23",
  },
  border: {
    subtle: "#1F1F23",
    default: "#27272A",
    strong: "#3F3F46",
  },
  text: {
    primary: "#FAFAFA",
    secondary: "#A1A1AA",
    tertiary: "#71717A",
    disabled: "#52525B",
  },
  accent: {
    base: "#7C3AED",
    hover: "#8B5CF6",
    active: "#6D28D9",
    glow: "rgba(124, 58, 237, 0.35)",
    secondary: "#06B6D4",
  },
  semantic: {
    success: "#10B981",
    warning: "#F59E0B",
    danger: "#EF4444",
  },
} as const;

export const radii = {
  sm: "6px",
  md: "8px",
  lg: "12px",
  xl: "16px",
  "2xl": "24px",
  full: "9999px",
} as const;

export const shadows = {
  sm: "0 1px 2px rgba(0,0,0,0.4)",
  md: "0 4px 12px rgba(0,0,0,0.5)",
  lg: "0 12px 32px rgba(0,0,0,0.55)",
  glow: `0 0 32px ${colors.accent.glow}`,
  glowStrong: `0 0 64px ${colors.accent.glow}, 0 0 16px ${colors.accent.glow}`,
} as const;

export const typography = {
  display: { size: "3.5rem", lineHeight: 1.05, weight: 700 },
  h1: { size: "2.5rem", lineHeight: 1.1, weight: 600 },
  h2: { size: "2rem", lineHeight: 1.15, weight: 600 },
  h3: { size: "1.5rem", lineHeight: 1.2, weight: 600 },
  h4: { size: "1.25rem", lineHeight: 1.3, weight: 500 },
  bodyLg: { size: "1.125rem", lineHeight: 1.55, weight: 400 },
  body: { size: "0.9375rem", lineHeight: 1.6, weight: 400 },
  bodySm: { size: "0.8125rem", lineHeight: 1.55, weight: 400 },
  caption: { size: "0.75rem", lineHeight: 1.4, weight: 400 },
} as const;

export const gradients = {
  primary: "linear-gradient(135deg, #7C3AED 0%, #06B6D4 100%)",
  mesh:
    "radial-gradient(at 27% 37%, hsla(265,75%,55%,0.18) 0px, transparent 50%)," +
    "radial-gradient(at 97% 21%, hsla(189,75%,55%,0.12) 0px, transparent 50%)," +
    "radial-gradient(at 52% 99%, hsla(280,75%,55%,0.10) 0px, transparent 50%)",
} as const;
```

### `src/lib/motion.ts`

```ts
import type { Transition, Variants } from "framer-motion";

/**
 * Motion presets — single source of truth for every animation in the app.
 * Source: MASTER_PLAN.md §4 (Motion). Never inline timings or curves.
 */

// Easing curves
export const easeStandard = [0.4, 0, 0.2, 1] as const;
export const easeOutExpo = [0.16, 1, 0.3, 1] as const;

// Spring presets
export const easeSpring: Transition = {
  type: "spring",
  stiffness: 400,
  damping: 30,
};

export const easeSpringBouncy: Transition = {
  type: "spring",
  stiffness: 500,
  damping: 25,
};

// Durations (seconds for Framer Motion)
export const durationFast = 0.15;
export const durationMedium = 0.25;
export const durationSlow = 0.4;
export const durationDeliberate = 0.6;

// Stagger
export const staggerChildren = 0.04;

// Common variants — reuse instead of redefining

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: durationMedium, ease: easeOutExpo },
  },
};

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: durationMedium, ease: easeOutExpo },
  },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: easeSpring,
  },
};

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren,
      delayChildren: 0.05,
    },
  },
};
```

### `src/lib/utils.ts`

```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

There is no `src/styles/` content — the directory exists empty.

---

## 3. Layout shells — full source

The app has four layout shells:

1. Root layout (every page).
2. `(auth)` layout — login / signup / verify-request / onboarding.
3. `(app)/[tenantSlug]` layout — every operator-facing tenant-scoped page.
4. `(admin)` layout — super-admin page.
5. Plus a nested `(app)/[tenantSlug]/settings` layout that adds the settings tabs row.

There is **no** root `(app)` layout — `src/app/(app)/layout.tsx` does not exist. The `[tenantSlug]` segment is the operator-app shell.

### `src/app/layout.tsx`

```tsx
import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider } from "@/components/motion/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "messaging-ai",
    template: "%s · messaging-ai",
  },
  description:
    "Multi-channel AI messaging platform for businesses. WhatsApp, Instagram, web, voice — Arabic, French, English, Darija.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0A0A0B" },
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body suppressHydrationWarning>
        <ThemeProvider attribute="data-theme" defaultTheme="dark" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

`ThemeProvider` is a thin wrapper around `next-themes` (see `src/components/motion/theme-provider.tsx`); the `attribute="data-theme"` setting is what flips the CSS-variable scope between `[data-theme="dark"]` and `[data-theme="light"]`.

### `src/app/(auth)/layout.tsx`

```tsx
import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      {/* Animated mesh gradient backdrop. The slow-shifting motion is in
          AuthMeshBackdrop (client component). */}
      <AuthMeshBackdrop />

      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6 lg:px-8">
        <Link
          href="/"
          className="text-body font-semibold tracking-tight text-[var(--text-primary)]"
        >
          messaging-ai
        </Link>
      </header>

      <div className="relative z-10 flex flex-1 items-center justify-center px-6 pb-16 pt-8">
        {children}
      </div>
    </main>
  );
}

import { AuthMeshBackdrop } from "@/components/auth/auth-mesh-backdrop";
```

### `src/app/(app)/[tenantSlug]/layout.tsx`

```tsx
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { auth } from "@/server/auth";
import { getRoutingUser } from "@/server/db/tenancy";
import { getTenantContext } from "@/server/tenancy/context";
import { Sidebar } from "@/components/app/sidebar";
import { CommandPalette } from "@/components/app/command-palette";

type LayoutParams = { tenantSlug: string };

export default async function TenantLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<LayoutParams>;
}) {
  const { tenantSlug } = await params;

  // Resolve tenant context (auth + membership). This is the single
  // chokepoint for "is this user allowed in this workspace?". Any failure
  // redirects or 404s before we render anything.
  const ctx = await getTenantContext(tenantSlug);

  // Fetch all memberships for the workspace switcher. getRoutingUser is
  // already cached per-request and was likely populated by /post-auth, but
  // re-call is cheap and keeps this layout self-sufficient when the user
  // navigates here directly.
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const routing = await getRoutingUser(session.user.id);
  const memberships = routing?.memberships ?? [];

  return (
    <div className="flex min-h-screen">
      <Sidebar
        tenant={ctx.tenant}
        memberships={memberships}
        user={{
          name: ctx.user.name,
          email: ctx.user.email,
          image: ctx.user.image,
          isSuperAdmin: ctx.user.isSuperAdmin,
        }}
      />
      <main className="flex-1 overflow-y-auto">{children}</main>
      <CommandPalette
        tenantSlug={ctx.tenant.slug}
        currentTenantId={ctx.tenant.id}
        memberships={memberships}
        user={{ isSuperAdmin: ctx.user.isSuperAdmin }}
      />
    </div>
  );
}
```

### `src/app/(app)/[tenantSlug]/settings/layout.tsx`

```tsx
import type { ReactNode } from "react";
import { getTenantContext } from "@/server/tenancy/context";
import { SettingsTabs } from "@/components/app/settings-tabs";

export default async function SettingsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  // Auth + membership; throws to redirect/notFound on miss.
  await getTenantContext(tenantSlug);
  return (
    <div className="mx-auto max-w-4xl px-6 py-10 lg:px-10 lg:py-14">
      <header className="mb-6">
        <h1 className="text-h1 text-[var(--text-primary)]">Settings</h1>
      </header>
      <SettingsTabs tenantSlug={tenantSlug} />
      <div className="pt-8">{children}</div>
    </div>
  );
}
```

### `src/app/(admin)/layout.tsx`

```tsx
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, Shield } from "lucide-react";
import { auth } from "@/server/auth";

/**
 * Super-admin gate. Two-step:
 *   1. No session → /login.
 *   2. Session without isSuperAdmin → notFound() (opaque 404; we don't
 *      reveal that this route exists).
 *
 * isSuperAdmin is set out-of-band (Prisma Studio or scripts/) per the
 * Phase 2 design — there's no self-service surface in v1.
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?next=/admin");
  }
  if (!session.user.isSuperAdmin) {
    notFound();
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-8 items-center justify-center rounded-lg"
              style={{
                backgroundColor:
                  "color-mix(in oklab, var(--accent-base) 18%, transparent)",
                color: "var(--accent-hover)",
              }}
            >
              <Shield className="size-4" />
            </span>
            <div className="leading-tight">
              <p className="text-body-sm font-medium text-[var(--text-primary)]">
                messaging-ai · admin
              </p>
              <p className="text-caption text-[var(--text-tertiary)]">
                Super-admin only
              </p>
            </div>
          </div>
          <Link
            href="/post-auth"
            className="inline-flex items-center gap-1.5 text-body-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <ArrowLeft className="size-3.5" />
            Back to app
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
```

### Sidebar — `src/components/app/sidebar.tsx`

This is a server component that composes four client subcomponents (`WorkspaceSwitcher`, `SidebarNav`, `CommandPaletteTrigger`, `UserMenu`).

```tsx
import Link from "next/link";
import { SidebarNav } from "./sidebar-nav";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { UserMenu } from "./user-menu";
import { CommandPaletteTrigger } from "./command-palette-trigger";

type SidebarProps = {
  tenant: { id: string; slug: string; name: string };
  memberships: Array<{
    tenantId: string;
    tenant: { id: string; slug: string; name: string };
  }>;
  user: {
    name: string | null;
    email: string | null;
    image: string | null;
    isSuperAdmin: boolean;
  };
};

export function Sidebar({ tenant, memberships, user }: SidebarProps) {
  return (
    <aside
      aria-label="Primary navigation"
      className="flex h-screen w-60 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]"
    >
      <div className="px-3 pt-3">
        <Link
          href={`/${tenant.slug}/dashboard`}
          className="mb-2 block px-2 py-1 text-caption uppercase tracking-wider text-[var(--text-tertiary)]"
        >
          messaging-ai
        </Link>
        <WorkspaceSwitcher current={tenant} memberships={memberships} />
      </div>

      <SidebarNav tenantSlug={tenant.slug} />

      <div className="space-y-2 border-t border-[var(--border-subtle)] p-3">
        <CommandPaletteTrigger />
        <UserMenu user={user} />
      </div>
    </aside>
  );
}
```

Width is fixed at `w-60` (240px). Sidebar is full-height, fixed-position via flex. There is **no topbar / page header component** — every page renders its own `<header>` block inline (see §4 for examples).

### Sidebar nav — `src/components/app/sidebar-nav.tsx`

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Building2,
  CreditCard,
  Database,
  HelpCircle,
  LayoutDashboard,
  MessageSquare,
  MessageSquareText,
  Package,
  Plug,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: (slug: string) => string;
  label: string;
  icon: LucideIcon;
  /** Phase the item becomes interactive — used as a tooltip hint for now. */
  phase?: number;
};

// Order: most-used → least-used. Phase 8 added "Business Info" (Operational
// Facts) as a top-level entry per Gate-1 K8 override (flat sidebar — these
// are daily operator actions and deserve top-level visibility, not nesting
// under "Knowledge"). Placed alongside Knowledge so the two
// knowledge-shaped surfaces sit together.
const ITEMS: NavItem[] = [
  { href: (s) => `/${s}/dashboard`, label: "Dashboard", icon: LayoutDashboard },
  { href: (s) => `/${s}/conversations`, label: "Conversations", icon: MessageSquare, phase: 5 },
  { href: (s) => `/${s}/knowledge`, label: "Documents", icon: BookOpen, phase: 3 },
  { href: (s) => `/${s}/knowledge/items`, label: "Products", icon: Package, phase: 8 },
  { href: (s) => `/${s}/knowledge/qna`, label: "Q&A", icon: MessageSquareText, phase: 8 },
  { href: (s) => `/${s}/knowledge/business-info`, label: "Business Info", icon: Building2, phase: 8 },
  { href: (s) => `/${s}/knowledge/live-data`, label: "Live Data Sources", icon: Database, phase: 8 },
  { href: (s) => `/${s}/knowledge/gaps`, label: "Knowledge Gaps", icon: HelpCircle, phase: 8 },
  { href: (s) => `/${s}/channels`, label: "Channels", icon: Plug, phase: 5 },
  { href: (s) => `/${s}/playground`, label: "Playground", icon: Sparkles, phase: 4 },
  { href: (s) => `/${s}/settings`, label: "Settings", icon: Settings },
  { href: (s) => `/${s}/billing`, label: "Billing", icon: CreditCard, phase: 9 },
];

export function SidebarNav({ tenantSlug }: { tenantSlug: string }) {
  const pathname = usePathname();
  const resolved = ITEMS.map((item) => ({ item, href: item.href(tenantSlug) }));

  return (
    <nav className="flex-1 space-y-0.5 px-3 py-2">
      {resolved.map(({ item, href }) => {
        const matchesPrefix = pathname === href || pathname.startsWith(`${href}/`);
        const moreSpecificWins = resolved.some(({ href: other }) => {
          if (other === href) return false;
          if (!other.startsWith(`${href}/`)) return false;
          return pathname === other || pathname.startsWith(`${other}/`);
        });
        const active = matchesPrefix && !moreSpecificWins;
        const Icon = item.icon;
        return (
          <Link
            key={item.label}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex h-9 items-center gap-3 rounded-md px-2.5 text-body-sm font-medium transition-colors duration-150 ease-out",
              active
                ? "bg-[var(--bg-surface-elevated)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface-elevated)] hover:text-[var(--text-primary)]",
            )}
          >
            <Icon
              className={cn(
                "size-4 shrink-0 transition-colors duration-150",
                active ? "text-[var(--accent-hover)]" : "text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]",
              )}
            />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
```

The `NavItem.phase` field is currently used only to flag which phase first lit the item up; it does not gate rendering — every item is rendered and clickable.

The full source for `WorkspaceSwitcher`, `UserMenu`, `CommandPalette`, and `CommandPaletteTrigger` is in §6 below.

---

## 4. Routes & pages

The operator-facing app lives under `src/app/(app)/[tenantSlug]/` (confirmed). All routes are wrapped by the tenant layout in §3, which mounts the sidebar + command palette and resolves auth/membership before rendering. Every `page.tsx` is an async Server Component; client interactivity is delegated to `*-client.tsx` components in `src/components/app/<surface>/`.

### Route inventory

```
src/app/page.tsx                                                     # Phase-1 design-system demo, public root
src/app/post-auth/page.tsx                                           # auth dispatcher (302s based on memberships)

src/app/(auth)/login/page.tsx
src/app/(auth)/signup/page.tsx
src/app/(auth)/verify-request/page.tsx
src/app/(auth)/onboarding/create-tenant/page.tsx

src/app/(admin)/admin/page.tsx                                       # super-admin only

src/app/(app)/[tenantSlug]/dashboard/page.tsx
src/app/(app)/[tenantSlug]/conversations/page.tsx
src/app/(app)/[tenantSlug]/conversations/[conversationId]/page.tsx
src/app/(app)/[tenantSlug]/knowledge/page.tsx
src/app/(app)/[tenantSlug]/knowledge/[sourceId]/page.tsx
src/app/(app)/[tenantSlug]/knowledge/items/page.tsx
src/app/(app)/[tenantSlug]/knowledge/items/import/page.tsx
src/app/(app)/[tenantSlug]/knowledge/qna/page.tsx
src/app/(app)/[tenantSlug]/knowledge/business-info/page.tsx
src/app/(app)/[tenantSlug]/knowledge/live-data/page.tsx              # placeholder
src/app/(app)/[tenantSlug]/knowledge/gaps/page.tsx
src/app/(app)/[tenantSlug]/channels/page.tsx
src/app/(app)/[tenantSlug]/channels/widget/page.tsx
src/app/(app)/[tenantSlug]/channels/whatsapp/page.tsx
src/app/(app)/[tenantSlug]/channels/messenger/page.tsx
src/app/(app)/[tenantSlug]/channels/instagram/page.tsx
src/app/(app)/[tenantSlug]/playground/page.tsx                       # placeholder ("Phase 4")
src/app/(app)/[tenantSlug]/settings/page.tsx                         # 307 → /settings/general
src/app/(app)/[tenantSlug]/settings/general/page.tsx
src/app/(app)/[tenantSlug]/settings/members/page.tsx
src/app/(app)/[tenantSlug]/billing/page.tsx                          # placeholder ("Phase 9"), OWNER-gated

src/app/api/auth/[...nextauth]/route.ts
src/app/api/dev/simulate-meta-message/route.ts
src/app/api/dev/simulate-whatsapp-message/route.ts
src/app/api/meta/webhook/route.ts
src/app/api/whatsapp/webhook/route.ts
src/app/api/widget/messages/route.ts
```

Settings has its own nested layout (see §3) that draws the tabbed nav (`General` / `Members`).

There is **no** `error.tsx` or `not-found.tsx` anywhere in the route tree (confirmed via Glob). All errors fall through to Next.js's default boundaries.

### `src/app/page.tsx` (root demo, not operator-facing)

The demo page exercises every primitive. It's the product's `/` URL today — not a marketing landing page. It loads tokens, glow cards, button variants, type scale, and color swatches.

**Summary:** purely static; no data; uses `Button`, `Card`, `GlowCard`, `FadeIn`/`FadeInItem` plus inline `SectionHeader` / `TypeRow` / `Swatch` / `CheckLine` helpers defined at the bottom of the file. Background is `--gradient-mesh` rendered as a fixed `-z-10` div.

```tsx
import { ArrowRight, Bot, MessageSquare, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GlowCard } from "@/components/motion/glow-card";
import { FadeIn, FadeInItem } from "@/components/motion/fade-in";

export default function DemoPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Subtle mesh-gradient backdrop */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{ background: "var(--gradient-mesh)" }}
      />

      <div className="mx-auto max-w-6xl px-6 py-24 lg:px-8 lg:py-32">
        {/* Hero */}
        <FadeIn stagger>
          <FadeInItem>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1 text-caption text-[var(--text-secondary)]">
              <Sparkles className="size-3 text-[var(--accent-hover)]" aria-hidden />
              Phase 1 — Design system online
            </div>
          </FadeInItem>

          <FadeInItem>
            <h1 className="text-display max-w-3xl text-[var(--text-primary)]">
              The messaging brain for{" "}
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: "var(--gradient-primary)" }}
              >
                modern businesses
              </span>
              .
            </h1>
          </FadeInItem>

          <FadeInItem>
            <p className="text-body-lg mt-6 max-w-2xl text-[var(--text-secondary)]">
              Multi-channel AI that handles WhatsApp, Instagram, web chat, and email — in
              Arabic, French, English, and Algerian Darija. Sounds like your best agent,
              never like a bot.
            </p>
          </FadeInItem>

          <FadeInItem>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Button size="lg">
                Get started <ArrowRight />
              </Button>
              <Button variant="secondary" size="lg">
                See it live
              </Button>
              <Button variant="link" size="lg">
                Read the docs
              </Button>
            </div>
          </FadeInItem>
        </FadeIn>

        {/* Section: Typography scale */}
        <section className="mt-32">
          <SectionHeader
            eyebrow="Typography"
            title="The full Geist scale"
            description="Display through caption. Body defaults to 15px for Linear's denser feel."
          />
          <Card className="mt-8">
            <CardContent className="space-y-6 pt-6">
              <TypeRow label="display" sample="The brain that doesn't sound like a bot" />
              <TypeRow label="h1" sample="The brain that doesn't sound like a bot" />
              <TypeRow label="h2" sample="The brain that doesn't sound like a bot" />
              <TypeRow label="h3" sample="The brain that doesn't sound like a bot" />
              <TypeRow label="h4" sample="The brain that doesn't sound like a bot" />
              <TypeRow label="body-lg" sample="Replies that feel hand-written, not template-driven." />
              <TypeRow label="body" sample="Replies that feel hand-written, not template-driven." />
              <TypeRow label="body-sm" sample="Replies that feel hand-written, not template-driven." />
              <TypeRow label="caption" sample="LABEL · 12PX · UPPERCASE · TRACKED" upper />
            </CardContent>
          </Card>
        </section>

        {/* Section: Color tokens */}
        <section className="mt-32">
          <SectionHeader
            eyebrow="Color"
            title="Direction A — electric violet on charcoal"
            description="Tokens drive everything. Hard-coded hex codes are a code smell."
          />

          <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Swatch name="bg-base" varName="--bg-base" />
            <Swatch name="bg-surface" varName="--bg-surface" />
            <Swatch name="bg-elevated" varName="--bg-surface-elevated" />
            <Swatch name="bg-overlay" varName="--bg-surface-overlay" />
            <Swatch name="accent" varName="--accent-base" />
            <Swatch name="accent-hover" varName="--accent-hover" />
            <Swatch name="accent-secondary" varName="--accent-secondary" />
            <Swatch name="success" varName="--success" />
            <Swatch name="warning" varName="--warning" />
            <Swatch name="danger" varName="--danger" />
            <Swatch name="border-default" varName="--border-default" />
            <Swatch name="border-strong" varName="--border-strong" />
          </div>
        </section>

        {/* Section: Buttons */}
        <section className="mt-32">
          <SectionHeader
            eyebrow="Components"
            title="Button variants"
            description="Six variants, five sizes, focus ring, glow on primary hover, 0.98 active scale."
          />
          <Card className="mt-8">
            <CardContent className="flex flex-wrap items-center gap-3 pt-6">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="link">Link</Button>
              <Button variant="destructive">Destructive</Button>
            </CardContent>
            <CardContent className="flex flex-wrap items-end gap-3 pt-0">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
              <Button size="xl">Extra large</Button>
              <Button size="icon" aria-label="More">
                <Sparkles />
              </Button>
            </CardContent>
          </Card>
        </section>

        {/* Section: Glow cards */}
        <section className="mt-32">
          <SectionHeader
            eyebrow="Motion"
            title="Glow on hover"
            description="Pointer-tracked halo, 2px lift, 150ms ease-out. Move your cursor."
          />

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <GlowCard>
              <Bot className="mb-4 size-6 text-[var(--accent-hover)]" />
              <h3 className="text-h4 text-[var(--text-primary)]">Tenant brain</h3>
              <p className="text-body-sm mt-2 text-[var(--text-secondary)]">
                Per-company AI trained on your site, files, and brand voice. Never a generic
                chatbot.
              </p>
            </GlowCard>

            <GlowCard>
              <MessageSquare className="mb-4 size-6 text-[var(--accent-hover)]" />
              <h3 className="text-h4 text-[var(--text-primary)]">Every channel</h3>
              <p className="text-body-sm mt-2 text-[var(--text-secondary)]">
                WhatsApp, Instagram, web widget, email — one inbox, one source of truth, one
                voice.
              </p>
            </GlowCard>

            <GlowCard>
              <Zap className="mb-4 size-6 text-[var(--accent-hover)]" />
              <h3 className="text-h4 text-[var(--text-primary)]">Smart handoff</h3>
              <p className="text-body-sm mt-2 text-[var(--text-secondary)]">
                Confidence-aware escalation. The AI knows when to call you in. No bluffing.
              </p>
            </GlowCard>
          </div>
        </section>

        {/* Section: Status */}
        <section className="mt-32 mb-12">
          <Card>
            <CardHeader>
              <CardTitle>Phase 1 — Foundation</CardTitle>
              <CardDescription>
                Next 15 + Tailwind v4 + Prisma + design tokens + motion primitives.
                Up next: Phase 2 — auth, multi-tenancy, dashboard shell.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="text-body-sm space-y-2 text-[var(--text-secondary)]">
                <CheckLine>Design tokens wired (colors, type, radius, shadows, motion)</CheckLine>
                <CheckLine>Geist Sans + Mono loaded</CheckLine>
                <CheckLine>shadcn-style primitives restyled to the system</CheckLine>
                <CheckLine>Framer Motion presets centralized in lib/motion.ts</CheckLine>
                <CheckLine>Prisma schema for Tenant / User / TenantUser + NextAuth tables</CheckLine>
                <CheckLine>docker-compose for Postgres+pgvector and Redis (boot pending Docker install)</CheckLine>
              </ul>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="text-caption font-medium uppercase tracking-wider text-[var(--accent-hover)]">
        {eyebrow}
      </p>
      <h2 className="text-h2 mt-2 text-[var(--text-primary)]">{title}</h2>
      <p className="text-body mt-2 text-[var(--text-secondary)]">{description}</p>
    </div>
  );
}

const TYPE_CLASSES: Record<string, string> = {
  display: "text-display",
  h1: "text-h1",
  h2: "text-h2",
  h3: "text-h3",
  h4: "text-h4",
  "body-lg": "text-body-lg",
  body: "text-body",
  "body-sm": "text-body-sm",
  caption: "text-caption",
};

function TypeRow({ label, sample, upper }: { label: string; sample: string; upper?: boolean }) {
  const sizeClass = TYPE_CLASSES[label] ?? "text-body";
  return (
    <div className="flex flex-col gap-1 border-b border-[var(--border-subtle)] pb-6 last:border-0 last:pb-0 md:flex-row md:items-baseline md:gap-6">
      <span className="text-caption w-32 shrink-0 font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
        {label}
      </span>
      <span className={`${sizeClass} text-[var(--text-primary)] ${upper ? "uppercase tracking-wider" : ""}`}>
        {sample}
      </span>
    </div>
  );
}

function Swatch({ name, varName }: { name: string; varName: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)]">
      <div className="h-20" style={{ backgroundColor: `var(${varName})` }} />
      <div className="bg-[var(--bg-surface)] px-3 py-2">
        <p className="text-body-sm text-[var(--text-primary)]">{name}</p>
        <p className="text-caption font-mono text-[var(--text-tertiary)]">{varName}</p>
      </div>
    </div>
  );
}

function CheckLine({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-[var(--accent-base)]" />
      <span>{children}</span>
    </li>
  );
}
```

### `src/app/post-auth/page.tsx` (auth dispatcher)

**Summary:** server component that resolves the user and 302s to either `/onboarding/create-tenant` (no memberships), `/<lastUsedTenant.slug>/dashboard` (if still a member), or `/<first membership>/dashboard`. Never renders UI. `dynamic = "force-dynamic"` so it re-runs every visit.

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getRoutingUser } from "@/server/db/tenancy";

export const dynamic = "force-dynamic";

export default async function PostAuthPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const user = await getRoutingUser(session.user.id);
  if (!user) {
    redirect("/login");
  }

  if (user.memberships.length === 0) {
    redirect("/onboarding/create-tenant");
  }

  const stillMemberOfLastUsed =
    user.lastUsedTenant !== null &&
    user.memberships.some((m) => m.tenant.id === user.lastUsedTenant?.id);

  const slug = stillMemberOfLastUsed
    ? user.lastUsedTenant!.slug
    : user.memberships[0]!.tenant.slug;

  redirect(`/${slug}/dashboard`);
}
```

### Login — `src/app/(auth)/login/page.tsx`

**Summary:** trivial page; mounts `<AuthCard mode="login" />`. The whole login UX (Google button, email magic link form, error states) lives in `AuthCard` (full source in §6). Auth backdrop is provided by the `(auth)` layout.

```tsx
import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function LoginPage() {
  return <AuthCard mode="login" />;
}
```

### Signup — `src/app/(auth)/signup/page.tsx`

**Summary:** identical structure to login; `<AuthCard mode="signup" />` swaps copy.

```tsx
import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";

export const metadata: Metadata = {
  title: "Create your workspace",
};

export default function SignupPage() {
  return <AuthCard mode="signup" />;
}
```

### Verify-request — `src/app/(auth)/verify-request/page.tsx`

**Summary:** static "check your email" card after magic-link request. Glassmorphic surface (88% surface + backdrop-blur), violet-tinted Mail icon in a circle, h2 + body copy + tertiary "didn't get it?" line.

```tsx
import type { Metadata } from "next";
import { Mail } from "lucide-react";

export const metadata: Metadata = {
  title: "Check your email",
};

export default function VerifyRequestPage() {
  return (
    <div className="w-full max-w-[420px]">
      <div
        className="rounded-2xl border border-[var(--border-subtle)] p-8 text-center shadow-[var(--shadow-lg)] backdrop-blur-xl"
        style={{
          backgroundColor: "color-mix(in oklab, var(--bg-surface) 88%, transparent)",
        }}
      >
        <div
          aria-hidden
          className="mx-auto mb-6 flex size-12 items-center justify-center rounded-full"
          style={{
            backgroundColor: "color-mix(in oklab, var(--accent-base) 20%, transparent)",
            color: "var(--accent-hover)",
          }}
        >
          <Mail className="size-6" />
        </div>
        <h1 className="mb-2 text-h2 text-[var(--text-primary)]">
          Check your email
        </h1>
        <p className="text-body text-[var(--text-secondary)]">
          We sent you a magic link. Click it to finish signing in. The link
          expires in 24 hours.
        </p>
        <p className="mt-6 text-body-sm text-[var(--text-tertiary)]">
          Didn&apos;t get it? Check spam, or close this tab and try again.
        </p>
      </div>
    </div>
  );
}
```

### Onboarding (create tenant) — `src/app/(auth)/onboarding/create-tenant/page.tsx`

**Summary:** server component that re-checks auth and mounts `<CreateTenantCard userEmail={…} />`. The card itself lives in `src/components/onboarding/create-tenant-card.tsx`. **There is no multi-step "5-minute setup" wizard yet** — only this single-step "name your workspace" form. Per MASTER_PLAN §9 the full wizard ships in Phase 9.

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { CreateTenantCard } from "@/components/onboarding/create-tenant-card";

export const metadata: Metadata = {
  title: "Create your workspace",
};

export default async function CreateTenantPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?next=/onboarding/create-tenant");
  }
  return <CreateTenantCard userEmail={session.user.email ?? null} />;
}
```

### Admin home — `src/app/(admin)/admin/page.tsx`

**Summary:** static placeholder with three "coming in Phase 10" cards (Tenants / Platform metrics / System health). The route is auth-gated by the `(admin)/layout.tsx` shown above. No live data.

```tsx
import type { Metadata } from "next";
import { Activity, BarChart3, Users } from "lucide-react";

export const metadata: Metadata = { title: "Admin" };

const SECTIONS = [
  {
    icon: Users,
    title: "Tenants",
    description: "Browse every workspace, see plan / usage, suspend or restore.",
    phase: "Phase 10",
  },
  {
    icon: BarChart3,
    title: "Platform metrics",
    description: "Total messages processed, AI tokens, channel volume, growth.",
    phase: "Phase 10",
  },
  {
    icon: Activity,
    title: "System health",
    description: "Queue depth, worker status, channel webhook freshness, error rates.",
    phase: "Phase 10",
  },
];

export default function AdminDashboardPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10 lg:px-8 lg:py-14">
      <header className="mb-10">
        <h1 className="text-h1 text-[var(--text-primary)]">Admin</h1>
        <p className="mt-2 text-body text-[var(--text-secondary)]">
          The platform-wide control panel. Builds out alongside Phase 10
          (observability + ops).
        </p>
      </header>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <li
              key={s.title}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
            >
              <div className="mb-3 flex items-center gap-2">
                <span
                  aria-hidden
                  className="flex size-8 items-center justify-center rounded-md"
                  style={{
                    backgroundColor: "color-mix(in oklab, var(--accent-base) 15%, transparent)",
                    color: "var(--accent-hover)",
                  }}
                >
                  <Icon className="size-4" />
                </span>
                <h2 className="text-body font-medium text-[var(--text-primary)]">
                  {s.title}
                </h2>
              </div>
              <p className="text-body-sm text-[var(--text-secondary)]">
                {s.description}
              </p>
              <p className="mt-4 inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] px-2 py-0.5 text-caption text-[var(--text-tertiary)]">
                {s.phase}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

### Operator dashboard home — `src/app/(app)/[tenantSlug]/dashboard/page.tsx`

**Summary:** static "next steps + this week" placeholder. Greeting derived from `ctx.user.name ?? email-local-part ?? "there"`. Renders four "next step" links (Add knowledge / Connect a channel / Test in playground / Invite a teammate) and a 3-up KPI grid with all `"—"` values. No data is loaded beyond the tenant context. **There is no real KPI / metrics surface yet anywhere in the codebase.** The `available: false` flag on each step is unused (every step is rendered the same way).

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Plug,
  Sparkles,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { getTenantContext } from "@/server/tenancy/context";

export const metadata: Metadata = {
  title: "Dashboard",
};

type NextStep = {
  icon: LucideIcon;
  title: string;
  description: string;
  href: (slug: string) => string;
  ctaLabel: string;
  available: boolean;
};

const NEXT_STEPS: NextStep[] = [
  {
    icon: BookOpen,
    title: "Add knowledge",
    description: "Paste your website URL or upload a PDF — your AI learns from it.",
    href: (s) => `/${s}/knowledge`,
    ctaLabel: "Add knowledge",
    available: false,
  },
  {
    icon: Plug,
    title: "Connect a channel",
    description: "Plug in WhatsApp, Instagram, or drop a widget on your site.",
    href: (s) => `/${s}/channels`,
    ctaLabel: "Connect a channel",
    available: false,
  },
  {
    icon: Sparkles,
    title: "Test in the playground",
    description: "Chat with your AI in any of four languages before customers do.",
    href: (s) => `/${s}/playground`,
    ctaLabel: "Open playground",
    available: false,
  },
  {
    icon: UserPlus,
    title: "Invite a teammate",
    description: "Add an agent so humans can take over when the AI escalates.",
    href: (s) => `/${s}/settings`,
    ctaLabel: "Invite",
    available: false,
  },
];

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const greeting = ctx.user.name ?? ctx.user.email?.split("@")[0] ?? "there";

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 lg:px-10 lg:py-14">
      <header className="mb-10">
        <p className="mb-1 text-body-sm text-[var(--text-tertiary)]">
          {ctx.tenant.name}
        </p>
        <h1 className="text-h1 text-[var(--text-primary)]">
          Welcome, {greeting}.
        </h1>
        <p className="mt-2 text-body text-[var(--text-secondary)]">
          You&apos;re a few steps away from your AI replying to customers.
        </p>
      </header>

      <section aria-labelledby="next-steps-heading" className="mb-12">
        <h2
          id="next-steps-heading"
          className="mb-4 text-body-sm font-medium uppercase tracking-wider text-[var(--text-tertiary)]"
        >
          Next steps
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {NEXT_STEPS.map((step) => {
            const Icon = step.icon;
            const href = step.href(tenantSlug);
            return (
              <li key={step.title}>
                <Link
                  href={href}
                  className="group flex h-full flex-col rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 transition-[border-color,transform] duration-150 ease-out hover:-translate-y-0.5 hover:border-[var(--border-default)]"
                >
                  <div className="mb-4 flex items-center gap-3">
                    <span
                      aria-hidden
                      className="flex size-9 items-center justify-center rounded-lg"
                      style={{
                        backgroundColor:
                          "color-mix(in oklab, var(--accent-base) 15%, transparent)",
                        color: "var(--accent-hover)",
                      }}
                    >
                      <Icon className="size-4.5" />
                    </span>
                    <h3 className="text-body font-medium text-[var(--text-primary)]">
                      {step.title}
                    </h3>
                  </div>
                  <p className="mb-4 flex-1 text-body-sm text-[var(--text-secondary)]">
                    {step.description}
                  </p>
                  <span className="inline-flex items-center gap-1 text-body-sm font-medium text-[var(--accent-hover)] transition-transform duration-150 ease-out group-hover:translate-x-0.5">
                    {step.ctaLabel}
                    <ArrowRight className="size-3.5" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="overview-heading">
        <h2
          id="overview-heading"
          className="mb-4 text-body-sm font-medium uppercase tracking-wider text-[var(--text-tertiary)]"
        >
          This week
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { label: "Conversations", value: "—" },
            { label: "AI replies sent", value: "—" },
            { label: "Avg. response time", value: "—" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
            >
              <p className="text-caption uppercase tracking-wider text-[var(--text-tertiary)]">
                {stat.label}
              </p>
              <p className="mt-2 text-h2 text-[var(--text-primary)]">
                {stat.value}
              </p>
              <p className="mt-1 text-body-sm text-[var(--text-tertiary)]">
                Once channels are connected
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
```

### Conversations list — `src/app/(app)/[tenantSlug]/conversations/page.tsx`

**Summary:** server component fetches the tenant's first 50 `WIDGET` conversations via `listConversationsForTenant` and hands them to the client `<ConversationsListClient>`. The client component owns the channel-filter pills + 4-second polling re-fetch loop via the `listConversations` Server Action. Read-only view; takeover ships in Phase 8.

```tsx
import type { Metadata } from "next";
import { getTenantContext } from "@/server/tenancy/context";
import { listConversationsForTenant } from "@/server/db/conversations";
import { ConversationsListClient } from "@/components/app/conversations/conversations-list-client";

export const metadata: Metadata = {
  title: "Conversations",
};

export default async function ConversationsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const initial = await listConversationsForTenant({
    tenantId: ctx.tenant.id,
    channelType: "WIDGET",
    limit: 50,
  });
  return (
    <ConversationsListClient slug={tenantSlug} initialConversations={initial} />
  );
}
```

### Conversation detail — `src/app/(app)/[tenantSlug]/conversations/[conversationId]/page.tsx`

**Summary:** server component fetches the conversation + messages via `getConversationWithMessages`, 404s on miss, and mounts `<ConversationDetailClient>`. The client owns the 4-second polling loop, scroll-to-bottom-on-new-message, and the citations interaction. Read-only view; "replying as agent" lands in Phase 8.

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/server/tenancy/context";
import { getConversationWithMessages } from "@/server/db/conversations";
import { ConversationDetailClient } from "@/components/app/conversations/conversation-detail-client";

export const metadata: Metadata = {
  title: "Conversation",
};

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; conversationId: string }>;
}) {
  const { tenantSlug, conversationId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const conversation = await getConversationWithMessages({
    tenantId: ctx.tenant.id,
    conversationId,
  });
  if (!conversation) notFound();
  return (
    <ConversationDetailClient
      slug={tenantSlug}
      initialConversation={conversation}
    />
  );
}
```

### Knowledge (Documents) — `src/app/(app)/[tenantSlug]/knowledge/page.tsx`

**Summary:** server component lists every `KnowledgeSource` for the tenant via `listSourcesForTenant`. The client `<KnowledgeListClient>` owns the source table, the "Add source" modal (website / file / manual tabs), 2.5-second polling while any source is `PENDING`/`PROCESSING`, and the inline `<RetrievalTestPanel>`.

```tsx
import type { Metadata } from "next";
import { getTenantContext } from "@/server/tenancy/context";
import { listSourcesForTenant } from "@/server/db/knowledge";
import { KnowledgeListClient } from "@/components/app/knowledge/knowledge-list-client";

export const metadata: Metadata = {
  title: "Knowledge",
};

export default async function KnowledgePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const sources = await listSourcesForTenant(ctx.tenant.id);
  return <KnowledgeListClient slug={tenantSlug} initialSources={sources} />;
}
```

### Knowledge source detail — `src/app/(app)/[tenantSlug]/knowledge/[sourceId]/page.tsx`

**Summary:** loads the source, the first 100 chunks, and the total chunk count in parallel; mounts `<SourceDetailClient>`. The client renders the source header (status pill, last-ingested timestamp, source URL or filename), per-chunk list with token counts, and the row actions (re-ingest / mark verified / delete).

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/server/tenancy/context";
import {
  countChunksForSource,
  getSource,
  listChunksForSource,
} from "@/server/db/knowledge";

const CHUNK_PREVIEW_LIMIT = 100;
import { SourceDetailClient } from "@/components/app/knowledge/source-detail-client";

export const metadata: Metadata = {
  title: "Source",
};

export default async function SourceDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; sourceId: string }>;
}) {
  const { tenantSlug, sourceId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const source = await getSource({ tenantId: ctx.tenant.id, sourceId });
  if (!source) notFound();
  const [chunks, totalChunks] = await Promise.all([
    listChunksForSource({
      tenantId: ctx.tenant.id,
      sourceId,
      limit: CHUNK_PREVIEW_LIMIT,
    }),
    countChunksForSource({ tenantId: ctx.tenant.id, sourceId }),
  ]);
  return (
    <SourceDetailClient
      slug={tenantSlug}
      source={source}
      chunks={chunks}
      totalChunks={totalChunks}
    />
  );
}
```

### Products (Items) — `src/app/(app)/[tenantSlug]/knowledge/items/page.tsx`

**Summary:** server component loads every `KnowledgeItem` + count for the tenant. `canEdit` is derived from role (anyone above VIEWER). Client `<ItemsListClient>` owns the list, search, create/edit modal (`<ItemForm>`), bulk-verify, delete, and links to `/import`.

```tsx
import type { Metadata } from "next";
import { getTenantContext } from "@/server/tenancy/context";
import {
  countItemsForTenant,
  listItemsForTenant,
} from "@/server/db/items";
import { ItemsListClient } from "@/components/app/items/items-list-client";

export const metadata: Metadata = {
  title: "Products",
};

export default async function ItemsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const [items, count] = await Promise.all([
    listItemsForTenant({ tenantId: ctx.tenant.id }),
    countItemsForTenant(ctx.tenant.id),
  ]);
  const canEdit = ctx.membership.role !== "VIEWER";

  return (
    <ItemsListClient
      tenantSlug={tenantSlug}
      initialItems={items}
      initialCount={count}
      canEdit={canEdit}
    />
  );
}
```

### Items import — `src/app/(app)/[tenantSlug]/knowledge/items/import/page.tsx`

**Summary:** thin server shell that gates the page on AGENT+. Mounts `<ItemsImportClient>` which exposes two import paths: paste-text smart import (Claude extracts items) and CSV upload (preview + commit). Owns the side-by-side preview / edit grid with AI-flagged ambiguities.

```tsx
import type { Metadata } from "next";
import { getTenantContext } from "@/server/tenancy/context";
import { ItemsImportClient } from "@/components/app/items/items-import-client";

export const metadata: Metadata = {
  title: "Import products",
};

export default async function ItemsImportPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const canImport = ctx.membership.role !== "VIEWER";
  return <ItemsImportClient tenantSlug={tenantSlug} canImport={canImport} />;
}
```

### Q&A — `src/app/(app)/[tenantSlug]/knowledge/qna/page.tsx`

**Summary:** server component fetches `QnaPair` rows + count. Client `<QnaListClient>` owns the list, language filter, search, create/edit modal (`<QnaForm>`), per-row delete, and bulk delete.

```tsx
import type { Metadata } from "next";
import { getTenantContext } from "@/server/tenancy/context";
import {
  countQnaPairsForTenant,
  listQnaPairsForTenant,
} from "@/server/db/qna";
import { QnaListClient } from "@/components/app/qna/qna-list-client";

export const metadata: Metadata = {
  title: "Q&A",
};

export default async function QnaPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const [pairs, count] = await Promise.all([
    listQnaPairsForTenant({ tenantId: ctx.tenant.id }),
    countQnaPairsForTenant(ctx.tenant.id),
  ]);
  const canEdit = ctx.membership.role !== "VIEWER";

  return (
    <QnaListClient
      tenantSlug={tenantSlug}
      initialPairs={pairs}
      initialCount={count}
      canEdit={canEdit}
    />
  );
}
```

### Business Info (Operational Facts) — `src/app/(app)/[tenantSlug]/knowledge/business-info/page.tsx`

**Summary:** server component loads the tenant's `OperationalFacts` row (or null) via `getOperationalFacts`. Client `<BusinessInfoClient>` is the long structured form: business hours per day-of-week, locations, contact channels, languages spoken, holidays, payment / shipping policies, etc. Mutations route through `saveOperationalFacts`.

```tsx
import type { Metadata } from "next";
import { getTenantContext } from "@/server/tenancy/context";
import { getOperationalFacts } from "@/server/db/operational-facts";
import { BusinessInfoClient } from "@/components/app/operational-facts/business-info-client";

export const metadata: Metadata = {
  title: "Business Info",
};

export default async function BusinessInfoPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const data = await getOperationalFacts({ tenantId: ctx.tenant.id });
  const canEdit = ctx.membership.role !== "VIEWER";

  return (
    <BusinessInfoClient
      tenantSlug={tenantSlug}
      initialData={data}
      canEdit={canEdit}
    />
  );
}
```

### Live Data Sources — `src/app/(app)/[tenantSlug]/knowledge/live-data/page.tsx`

**Summary:** placeholder. "Type 4" of MASTER_PLAN's five-types knowledge taxonomy (live external connectors — Odoo, Google Calendar, e-commerce). Renders an icon + "in development" pill + descriptive copy. No data.

```tsx
import type { Metadata } from "next";
import { Database, Sparkles } from "lucide-react";
import { getTenantContext } from "@/server/tenancy/context";

export const metadata: Metadata = {
  title: "Live Data Sources",
};

export default async function LiveDataPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  await getTenantContext(tenantSlug);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-h2 text-[var(--text-primary)]">Live Data Sources</h1>
        <p className="text-body-sm text-[var(--text-secondary)]">
          Connect external systems so your AI answers from live data instead of
          stored snapshots.
        </p>
      </header>

      <div className="relative overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
        <div className="flex items-start gap-4">
          <div className="rounded-lg border border-[var(--accent-base)]/30 bg-[var(--accent-glow)]/30 p-3 text-[var(--accent-hover)]">
            <Database className="size-6" aria-hidden />
          </div>
          <div className="flex-1 space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-h4 text-[var(--text-primary)]">Coming soon</h2>
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--accent-base)]/40 bg-[var(--accent-glow)]/30 px-2 py-0.5 text-caption text-[var(--accent-hover)]">
                <Sparkles className="size-3" aria-hidden />
                in development
              </span>
            </div>
            <p className="text-body text-[var(--text-secondary)]">
              Connect external systems so the AI answers from live data instead
              of stored snapshots. Inventory from Odoo. Appointments from Google
              Calendar. Order status from your e-commerce platform.
            </p>
            <p className="text-body-sm text-[var(--text-tertiary)]">
              Currently in development — available in a future release.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-dashed border-[var(--border-subtle)] px-4 py-3 text-body-sm text-[var(--text-tertiary)]">
        For now, knowledge that changes frequently is best maintained as
        Products (with the &ldquo;Mark all as verified&rdquo; bulk action after price
        sweeps) or curated Q&amp;A pairs. Stored snapshots, refreshed on a
        schedule you control.
      </div>
    </div>
  );
}
```

### Knowledge Gaps — `src/app/(app)/[tenantSlug]/knowledge/gaps/page.tsx`

**Summary:** server component loads gap clusters + unclustered gaps in parallel. Client `<GapsListClient>` owns the cluster cards (each lists the cluster's recurring questions, sample customer messages, and resolve / dismiss buttons), plus the unclustered tail. Resolve currently dispatches to `createQnaPairAction` to mint a Q&A from the cluster.

```tsx
import type { Metadata } from "next";
import { getTenantContext } from "@/server/tenancy/context";
import {
  loadGapClusters,
  loadUnclusteredGaps,
} from "@/server/db/knowledge-gaps";
import { GapsListClient } from "@/components/app/gaps/gaps-list-client";

export const metadata: Metadata = {
  title: "Knowledge Gaps",
};

export default async function GapsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const [clusters, unclustered] = await Promise.all([
    loadGapClusters({ tenantId: ctx.tenant.id }),
    loadUnclusteredGaps({ tenantId: ctx.tenant.id }),
  ]);
  const canResolve = ctx.membership.role !== "VIEWER";

  return (
    <GapsListClient
      tenantSlug={tenantSlug}
      initialClusters={clusters}
      initialUnclustered={unclustered}
      canResolve={canResolve}
    />
  );
}
```

### Channels list — `src/app/(app)/[tenantSlug]/channels/page.tsx`

**Summary:** server component pulls the four possible Channel rows in parallel (widget / whatsapp / messenger / instagram) and derives `connected`/`paused`/`available` for each. Renders four `<ChannelRow>` items with description copy that branches on whether the channel exists. No client state.

```tsx
import type { Metadata } from "next";
import { Globe, Instagram, MessageCircle } from "lucide-react";
import { getTenantContext } from "@/server/tenancy/context";
import {
  getInstagramChannel,
  getMessengerChannel,
  getWhatsAppChannel,
  getWidgetChannel,
} from "@/server/db/channels";
import {
  ChannelRow,
  type ChannelRowStatus,
} from "@/components/app/channels/channel-row";

export const metadata: Metadata = {
  title: "Channels",
};

export default async function ChannelsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const [widget, whatsapp, messenger, instagram] = await Promise.all([
    getWidgetChannel(ctx.tenant.id),
    getWhatsAppChannel(ctx.tenant.id),
    getMessengerChannel(ctx.tenant.id),
    getInstagramChannel(ctx.tenant.id),
  ]);

  let widgetStatus: ChannelRowStatus = "available";
  if (widget) {
    widgetStatus = widget.status === "CONNECTED" ? "connected" : "paused";
  }
  const widgetDescription = widget
    ? "Embedded chat for your website. Configure origins, theme, and key."
    : "Embedded chat for your website. Enable to mint a public key and embed snippet.";

  let whatsappStatus: ChannelRowStatus = "available";
  if (whatsapp) {
    whatsappStatus =
      whatsapp.status === "CONNECTED" ? "connected" : "paused";
  }
  const whatsappDescription = whatsapp
    ? "Connected via 360dialog. Configure display, rotate webhook secret, or pause."
    : "Connect your 360dialog number for two-way WhatsApp Business messaging.";

  let messengerStatus: ChannelRowStatus = "available";
  if (messenger) {
    messengerStatus =
      messenger.status === "CONNECTED" ? "connected" : "paused";
  }
  const messengerDescription = messenger
    ? `${messenger.displayName} — Page DMs via the Meta Graph API.`
    : "Connect a Facebook Page to handle Messenger DMs through the AI brain.";

  let instagramStatus: ChannelRowStatus = "available";
  if (instagram) {
    instagramStatus =
      instagram.status === "CONNECTED" ? "connected" : "paused";
  }
  const instagramDescription = instagram
    ? `${instagram.displayName} — IG Business DMs via the Meta Graph API.`
    : "Connect an Instagram Business account (linked to a Facebook Page) for DMs.";

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 lg:px-10 lg:py-14">
      <header className="mb-8">
        <h1 className="text-h1 text-[var(--text-primary)]">Channels</h1>
        <p className="mt-2 text-body text-[var(--text-secondary)]">
          Connect the surfaces customers reach you on. Each channel routes
          incoming messages through the same AI brain and conversation thread.
        </p>
      </header>

      <ul className="space-y-2.5">
        <li>
          <ChannelRow
            icon={Globe}
            name="Website widget"
            description={widgetDescription}
            status={widgetStatus}
            href={`/${tenantSlug}/channels/widget`}
          />
        </li>
        <li>
          <ChannelRow
            icon={MessageCircle}
            name="WhatsApp"
            description={whatsappDescription}
            status={whatsappStatus}
            href={`/${tenantSlug}/channels/whatsapp`}
          />
        </li>
        <li>
          <ChannelRow
            icon={MessageCircle}
            name="Messenger"
            description={messengerDescription}
            status={messengerStatus}
            href={`/${tenantSlug}/channels/messenger`}
          />
        </li>
        <li>
          <ChannelRow
            icon={Instagram}
            name="Instagram"
            description={instagramDescription}
            status={instagramStatus}
            href={`/${tenantSlug}/channels/instagram`}
          />
        </li>
      </ul>
    </div>
  );
}
```

### Channel detail pages

The four channel detail pages (`widget`, `whatsapp`, `messenger`, `instagram`) all share the same shape:

1. Fetch the row.
2. Derive `canConnect` / `canEditConfig` / `canRotateOrDisconnect` booleans by role rank.
3. Pull `NEXT_PUBLIC_APP_URL` (and `META_VERIFY_TOKEN` for Meta channels) — throws at render time if env is missing, since shipping a broken embed snippet / webhook URL is a deployment-config error.
4. Render a back-link, a `text-h1` page title, descriptive paragraph, and either the existing channel's `*ConfigCard` or the connect form.

The full Widget page is shown below as the canonical template; the other three follow the same pattern with channel-specific copy and components.

```tsx
// src/app/(app)/[tenantSlug]/channels/widget/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getTenantContext, ROLE_RANK } from "@/server/tenancy/context";
import { getWidgetChannel } from "@/server/db/channels";
import { parseWidgetChannelConfig } from "@/lib/validators";
import { WidgetConfigCard } from "@/components/app/channels/widget-config-card";
import { EnableWidgetForm } from "@/components/app/channels/enable-widget-form";

export const metadata: Metadata = {
  title: "Website widget",
};

export default async function WidgetChannelPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const widget = await getWidgetChannel(ctx.tenant.id);

  const role = ctx.membership.role;
  const canEnable = ROLE_RANK[role] >= ROLE_RANK["AGENT"];
  const canEditConfig = ROLE_RANK[role] >= ROLE_RANK["AGENT"];
  const canRotateKey = ROLE_RANK[role] >= ROLE_RANK["ADMIN"];

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is not set — embed snippet cannot be rendered.",
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 lg:px-10 lg:py-14">
      <Link
        href={`/${tenantSlug}/channels`}
        className="inline-flex items-center gap-1.5 text-body-sm text-[var(--text-tertiary)] transition-colors duration-150 hover:text-[var(--text-secondary)]"
      >
        <ArrowLeft className="size-3.5" />
        Channels
      </Link>
      <header className="mt-3 mb-8">
        <h1 className="text-h1 text-[var(--text-primary)]">Website widget</h1>
        <p className="mt-2 text-body text-[var(--text-secondary)]">
          The widget runs on every page where the embed snippet is loaded.
          Origins below are checked on each request — empty allowlist means
          any site can embed (v1 default).
        </p>
      </header>

      {widget ? (
        (() => {
          const cfg = parseWidgetChannelConfig(widget.config);
          return (
            <WidgetConfigCard
              tenantSlug={tenantSlug}
              publicKey={cfg.publicKey}
              displayName={cfg.displayName ?? widget.displayName}
              themeAccent={cfg.themeAccent}
              originsAllowlist={cfg.originsAllowlist}
              status={widget.status}
              canEditConfig={canEditConfig}
              canRotateKey={canRotateKey}
              appUrl={appUrl}
            />
          );
        })()
      ) : (
        <EnableWidgetForm tenantSlug={tenantSlug} canEnable={canEnable} />
      )}
    </div>
  );
}
```

The WhatsApp page differs in: its header copy (24-hour customer-service window), the components (`WhatsAppConfigCard`, `WhatsAppConnectForm`), and that the connect role floor is ADMIN rather than AGENT. The Messenger and Instagram pages share `<MetaConfigCard>` and `<MetaConnectForm>` (one Page Access Token authorizes both surfaces) and inject channel-specific `readOnlyRows` for the config card.

### Playground — `src/app/(app)/[tenantSlug]/playground/page.tsx`

**Summary:** placeholder using the shared `<PlaceholderPage>` empty-state. **TODO:** the playground page itself ships a chat surface in a later phase; right now this only renders the empty state. The widget already exercises the streaming pipeline against the real brain.

```tsx
import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { getTenantContext } from "@/server/tenancy/context";
import { PlaceholderPage } from "@/components/app/placeholder-page";

export const metadata: Metadata = {
  title: "Playground",
};

export default async function PlaygroundPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  await getTenantContext(tenantSlug);
  return (
    <PlaceholderPage
      icon={Sparkles}
      title="Playground"
      description="Chat with your AI in Arabic, French, English, or Darija. Streams responses, shows which knowledge chunks were used, and exposes the confidence score."
      phaseNote="Phase 4"
    />
  );
}
```

### Settings — index, general, members

**Index:** redirects to `/general`.

```tsx
// src/app/(app)/[tenantSlug]/settings/page.tsx
import { redirect } from "next/navigation";

export default async function SettingsIndexPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  redirect(`/${tenantSlug}/settings/general`);
}
```

**General** — workspace name form, read-only workspace URL display, theme picker. `canEdit` is OWNER/ADMIN.

```tsx
// src/app/(app)/[tenantSlug]/settings/general/page.tsx
import type { Metadata } from "next";
import { getTenantContext } from "@/server/tenancy/context";
import { WorkspaceNameForm } from "@/components/app/workspace-name-form";
import { ThemePicker } from "@/components/ui/theme-picker";

export const metadata: Metadata = { title: "Settings · General" };

export default async function GeneralSettingsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const canEdit = ctx.membership.role === "OWNER" || ctx.membership.role === "ADMIN";

  return (
    <div className="space-y-10">
      <section aria-labelledby="general-heading">
        <h2 id="general-heading" className="mb-4 text-h4 text-[var(--text-primary)]">
          Workspace
        </h2>
        <WorkspaceNameForm
          tenantSlug={tenantSlug}
          initialName={ctx.tenant.name}
          canEdit={canEdit}
        />
      </section>

      <section aria-labelledby="url-heading">
        <h2 id="url-heading" className="mb-4 text-h4 text-[var(--text-primary)]">
          Workspace URL
        </h2>
        <div className="flex h-10 max-w-md items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-body text-[var(--text-tertiary)]">
          <span>messaging-ai.app/</span>
          <span className="text-[var(--text-primary)]">{ctx.tenant.slug}</span>
        </div>
        <p className="mt-2 text-body-sm text-[var(--text-tertiary)]">
          Changing the workspace URL is coming in a future phase. It would
          break existing bookmarks, so we want to handle redirects properly
          first.
        </p>
      </section>

      <section aria-labelledby="theme-heading">
        <h2 id="theme-heading" className="mb-4 text-h4 text-[var(--text-primary)]">
          Theme
        </h2>
        <ThemePicker />
        <p className="mt-2 text-body-sm text-[var(--text-tertiary)]">
          System matches your OS setting. Switching is also available in the
          user menu (bottom-left of the sidebar).
        </p>
      </section>
    </div>
  );
}
```

**Members** — read-only roster. Invite UI lands in Phase 9.

```tsx
// src/app/(app)/[tenantSlug]/settings/members/page.tsx
import type { Metadata } from "next";
import { getTenantContext } from "@/server/tenancy/context";
import { listTenantMembers } from "@/server/db/tenancy";
import { MembersList } from "@/components/app/members-list";

export const metadata: Metadata = { title: "Settings · Members" };

export default async function MembersSettingsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const members = await listTenantMembers(ctx.tenant.id);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-h4 text-[var(--text-primary)]">Members</h2>
          <p className="mt-1 text-body-sm text-[var(--text-secondary)]">
            Everyone with access to {ctx.tenant.name}.
          </p>
        </div>
        <span className="text-body-sm text-[var(--text-tertiary)]">
          {members.length} {members.length === 1 ? "member" : "members"}
        </span>
      </header>

      <MembersList members={members} currentUserId={ctx.user.id} />

      <p className="text-body-sm text-[var(--text-tertiary)]">
        Inviting teammates and changing roles arrives in Phase 9 alongside
        billing — until then this is a read-only roster.
      </p>
    </div>
  );
}
```

### Billing — `src/app/(app)/[tenantSlug]/billing/page.tsx`

**Summary:** placeholder, OWNER-only via `requireTenantContext({ minRole: "OWNER" })`. Reuses `<PlaceholderPage>`.

```tsx
import type { Metadata } from "next";
import { CreditCard } from "lucide-react";
import { requireTenantContext } from "@/server/tenancy/context";
import { PlaceholderPage } from "@/components/app/placeholder-page";

export const metadata: Metadata = {
  title: "Billing",
};

export default async function BillingPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  await requireTenantContext(tenantSlug, { minRole: "OWNER" });
  return (
    <PlaceholderPage
      icon={CreditCard}
      title="Billing"
      description="Plans, usage, invoices, and the Stripe billing portal. Three tiers (Starter / Pro / Business) with usage metering and limit enforcement."
      phaseNote="Phase 9"
    />
  );
}
```

### Onboarding wizard — deferred to Phase 9

There is no multi-step onboarding wizard yet. The only onboarding surface is the single-step `<CreateTenantCard>` (full source in §6). Per MASTER_PLAN §9, the "5-minute setup" wizard ships in Phase 9.

### Customers / contacts surface — does not exist

There is no dedicated customers / contacts route. `Customer` rows are rendered inline as the avatar + display label in the conversations list and conversation header. The schema (`prisma/schema.prisma`) has `Customer` with `name`, `phone`, `email`, `metadata`, but there is no CRM-style customer detail page.

### Escalation queue surface — does not exist

There is no dedicated escalation queue route. Escalation status is currently surfaced inline in the conversation list (status pill = "Escalated") and the conversation detail header (the orange `EscalationCallout` if `metadata.lastEscalationReason` is set). Per MASTER_PLAN §9, the full handoff/takeover UI is Phase 8.

### Voice profile editor — does not exist

There is no UI for editing a tenant's voice profile. The schema, defaults, and seed retrofitting are wired (`src/lib/validators.ts` `voiceProfileSchema`, `defaultVoiceProfile()`), and the brain reads it on every reply — but no operator-facing edit surface. Planned for Phase 9 onboarding wizard per `CLAUDE.md` §7a "Deferred to a later phase".

### Widget chat surface — `widget/src/Widget.tsx`

The widget is a separate Vite/Preact build that ships as a single `widget.js` script. It is **not** part of the Next.js app. Token sync is enforced by the `widget:check-tokens` pre-commit hook. Its operator-facing detail page is `/channels/widget` (above).

```tsx
import { h, Fragment } from "preact";
import { useEffect, useReducer, useRef } from "preact/hooks";
import { subscribe } from "./api-bus";
import { streamMessage, WidgetStreamError, type WidgetStreamErrorKind } from "./api";
import { Launcher } from "./components/Launcher";
import { Panel } from "./components/Panel";
import { DemoControls, type DemoCommand } from "./components/DemoControls";
import { CONVERSATION_RESUME_MAX_AGE_MS } from "./limits";
import type { ConversationState, Message, StreamEvent } from "./types";

/**
 * Top-level widget component. Owns:
 *   - the state machine (open/closed × idle/sending/streaming/error)
 *   - the localStorage-backed customerExternalId
 *   - the conversationId resume window (24h, mirrored server-side in
 *     src/server/channels/widget/limits.ts)
 *   - the bridge from the public window.MessagingAI API (via api-bus)
 *
 * Does NOT own:
 *   - the wire format (types.ts)
 *   - the actual fetch / streaming (api.ts — currently mocked)
 */

type State = {
  open: boolean;
  status: ConversationState;
  messages: Message[];
  draft: string;
  conversationId: string | null;
  errorKind: WidgetStreamErrorKind | null;
};

type Action =
  | { type: "open" }
  | { type: "close" }
  | { type: "toggle" }
  | { type: "draft"; text: string }
  | { type: "send" }
  | { type: "ai/start" }
  | { type: "ai/delta"; text: string }
  | { type: "ai/done"; final: Message; conversationId: string }
  | { type: "ai/error"; kind: WidgetStreamErrorKind }
  | { type: "demo/seed"; messages: Message[]; status?: ConversationState };

const INITIAL: State = {
  open: false,
  status: "idle",
  messages: [],
  draft: "",
  conversationId: null,
  errorKind: null,
};

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "open":   return { ...s, open: true };
    case "close":  return { ...s, open: false };
    case "toggle": return { ...s, open: !s.open };
    case "draft":  return { ...s, draft: a.text };
    case "send": {
      const text = s.draft.trim();
      if (!text) return s;
      const user: Message = { id: rid(), role: "customer", text };
      return { ...s, draft: "", status: "sending", errorKind: null, messages: [...s.messages, user] };
    }
    case "ai/start":
      return {
        ...s,
        status: "streaming",
        messages: [...s.messages, { id: rid(), role: "ai", text: "", streaming: true }],
      };
    case "ai/delta": {
      const last = s.messages[s.messages.length - 1];
      if (!last || last.role !== "ai" || !last.streaming) return s;
      const updated: Message = { ...last, text: last.text + a.text };
      return { ...s, messages: [...s.messages.slice(0, -1), updated] };
    }
    case "ai/done":
      return {
        ...s,
        status: "idle",
        conversationId: a.conversationId,
        messages: [...s.messages.slice(0, -1), a.final],
      };
    case "ai/error":
      return { ...s, status: "error", errorKind: a.kind };
    case "demo/seed":
      return { ...s, messages: a.messages, status: a.status ?? s.status };
  }
}

export function Widget({ widgetKey, tenantName }: { widgetKey: string | null; tenantName: string }) {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const customerExternalId = useRef(getOrMintCustomerId());
  const lastActivityAt = useRef<number>(loadLastActivity());

  useEffect(() => {
    return subscribe((action) => {
      if (action.type === "open" || action.type === "close" || action.type === "toggle") {
        dispatch({ type: action.type });
      }
    });
  }, []);

  useEffect(() => {
    if (state.status !== "sending") return;
    const cancel = runStream({
      widgetKey,
      conversationId: resolveConversationId(state.conversationId, lastActivityAt.current),
      message: state.messages[state.messages.length - 1]?.text ?? "",
      customerExternalId: customerExternalId.current,
      dispatch,
      onActivity: () => {
        lastActivityAt.current = Date.now();
        saveLastActivity(lastActivityAt.current);
      },
    });
    return cancel;
  }, [state.status]);

  const handleDemoCommand = (cmd: DemoCommand) => {
    if (cmd.kind === "seed") {
      dispatch({ type: "demo/seed", messages: cmd.messages, status: cmd.status });
    } else {
      dispatch({ type: "demo/seed", messages: state.messages, status: cmd.status });
    }
  };

  return (
    <Fragment>
      {!state.open ? (
        <Launcher onClick={() => dispatch({ type: "open" })} />
      ) : (
        <Panel
          tenantName={tenantName}
          status={state.status}
          errorKind={state.errorKind}
          messages={state.messages}
          draft={state.draft}
          onClose={() => dispatch({ type: "close" })}
          onDraftChange={(text) => dispatch({ type: "draft", text })}
          onSend={() => dispatch({ type: "send" })}
        />
      )}
      {import.meta.env.DEV ? <DemoControls onCommand={handleDemoCommand} /> : null}
    </Fragment>
  );
}

function runStream(args: {
  widgetKey: string | null;
  conversationId: string | null;
  message: string;
  customerExternalId: string;
  dispatch: (a: Action) => void;
  onActivity: () => void;
}): () => void {
  let cancelled = false;
  (async () => {
    try {
      const stream = streamMessage({
        widgetKey: args.widgetKey ?? "",
        conversationId: args.conversationId,
        message: args.message,
        customerExternalId: args.customerExternalId,
      });

      let started = false;
      for await (const event of stream as AsyncGenerator<StreamEvent>) {
        if (cancelled) return;
        if (event.type === "delta") {
          if (!started) {
            args.dispatch({ type: "ai/start" });
            started = true;
          }
          args.dispatch({ type: "ai/delta", text: event.text });
        } else {
          if (!started) args.dispatch({ type: "ai/start" });
          const final: Message = {
            id: rid(),
            role: "ai",
            text: event.reply,
            lang: event.language,
            citations: event.citations.length > 0 ? event.citations : undefined,
          };
          args.dispatch({
            type: "ai/done",
            final,
            conversationId: event.conversationId,
          });
          args.onActivity();
        }
      }
    } catch (err) {
      if (cancelled) return;
      console.error("[messaging-ai widget] stream error:", err);
      const kind: WidgetStreamErrorKind =
        err instanceof WidgetStreamError ? err.kind : "connection_lost";
      args.dispatch({ type: "ai/error", kind });
    }
  })();
  return () => {
    cancelled = true;
  };
}

const LS_CUSTOMER_KEY = "ma:customerExternalId";
const LS_LAST_ACTIVITY_KEY = "ma:lastActivityAt";

function getOrMintCustomerId(): string {
  try {
    const existing = localStorage.getItem(LS_CUSTOMER_KEY);
    if (existing) return existing;
    const fresh = rid();
    localStorage.setItem(LS_CUSTOMER_KEY, fresh);
    return fresh;
  } catch {
    return rid(); // session-only fallback
  }
}

function loadLastActivity(): number {
  try {
    const raw = localStorage.getItem(LS_LAST_ACTIVITY_KEY);
    return raw ? Number.parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

function saveLastActivity(ts: number): void {
  try {
    localStorage.setItem(LS_LAST_ACTIVITY_KEY, String(ts));
  } catch {
    // ignore — fall through to session-only behavior
  }
}

function resolveConversationId(
  current: string | null,
  lastActivityAt: number,
): string | null {
  if (!current) return null;
  if (Date.now() - lastActivityAt > CONVERSATION_RESUME_MAX_AGE_MS) return null;
  return current;
}

function rid(): string {
  return crypto.randomUUID();
}
```

The widget's components (`Launcher`, `Panel`, `MessageBubble`, `MessageList`, `Composer`, `Citations`, `TypingDots`, `DemoControls`) live in `widget/src/components/`. The widget owns its own styles in `widget/src/styles.css` and tokens in `widget/src/tokens.ts`; the redesign of the operator dashboard does not need to touch the widget bundle.

---

## 5. UI primitives inventory (`src/components/ui/`)

The directory contains exactly **three** files. There is no shadcn `components.json`, no scaffolded primitive set, no Input/Textarea/Select/Badge/Tabs/Dialog/Tooltip/Toast/Sonner/Skeleton primitive. Every page builds those affordances inline against tokens or imports them from Radix directly. This is a real gap — see §12.

```
src/components/ui/button.tsx          (CVA, primary/secondary/outline/ghost/destructive/link × sm/md/lg/xl/icon, asChild via @radix-ui/react-slot)
src/components/ui/card.tsx            (Card / CardHeader / CardTitle / CardDescription / CardContent / CardFooter — token-styled wrappers, no variants)
src/components/ui/theme-picker.tsx    (segmented control radiogroup; reads useThemeSwitcher; light/dark/system)
```

There is no compositional `Section` / `Eyebrow` / `PageHeader` / `KpiCard` / `Stat` primitive. The dashboard's "next steps" cards, KPI tiles, channel rows, and section-headers are all hand-rolled inline in their respective pages.

### `src/components/ui/button.tsx` (full)

```tsx
"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium",
    "transition-[background-color,box-shadow,transform,color] duration-150 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:size-4 [&_svg]:shrink-0",
    "active:scale-[0.98]",
  ],
  {
    variants: {
      variant: {
        primary: [
          "bg-[var(--accent-base)] text-white",
          "hover:bg-[var(--accent-hover)] hover:shadow-[0_0_24px_var(--accent-glow)]",
          "active:bg-[var(--accent-active)]",
        ],
        secondary: [
          "bg-[var(--bg-surface-elevated)] text-[var(--text-primary)]",
          "border border-[var(--border-default)]",
          "hover:bg-[var(--bg-surface-overlay)] hover:border-[var(--border-strong)]",
        ],
        ghost: [
          "bg-transparent text-[var(--text-secondary)]",
          "hover:bg-[var(--bg-surface-elevated)] hover:text-[var(--text-primary)]",
        ],
        outline: [
          "bg-transparent text-[var(--text-primary)]",
          "border border-[var(--border-default)]",
          "hover:border-[var(--accent-base)] hover:text-[var(--accent-hover)]",
        ],
        destructive: [
          "bg-[var(--danger)] text-white",
          "hover:bg-red-500 hover:shadow-[0_0_24px_rgba(239,68,68,0.35)]",
        ],
        link: [
          "bg-transparent text-[var(--accent-hover)] underline-offset-4",
          "hover:underline hover:text-[var(--accent-base)]",
        ],
      },
      size: {
        sm: "h-8 px-3 text-body-sm rounded-md",
        md: "h-9 px-4 text-body rounded-md",
        lg: "h-11 px-6 text-body rounded-lg",
        xl: "h-12 px-8 text-body-lg rounded-lg",
        icon: "size-9 rounded-md",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
```

Note: the destructive variant uses raw `bg-red-500` and `rgba(239,68,68,0.35)` for the hover glow rather than the `--danger` token + a `--danger-glow` token (which doesn't exist). This is one of the few hard-coded color values in the primitives.

### `src/components/ui/card.tsx` (full)

```tsx
import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-sm",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1.5 p-6", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn("text-h4 text-[var(--text-primary)]", className)}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

export const CardDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-body-sm text-[var(--text-secondary)]", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex items-center gap-2 p-6 pt-0", className)}
      {...props}
    />
  ),
);
CardFooter.displayName = "CardFooter";
```

### `src/components/ui/theme-picker.tsx` (full)

```tsx
"use client";

import { Laptop, Moon, Sun, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useThemeSwitcher } from "@/hooks/use-theme-switcher";
import { cn } from "@/lib/utils";

type ThemeValue = "light" | "dark" | "system";
type Option = { value: ThemeValue; label: string; icon: LucideIcon };

const OPTIONS: Option[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Laptop },
];

export function ThemePicker() {
  const { theme, switchTheme } = useThemeSwitcher();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const current: ThemeValue = mounted
    ? ((theme ?? "system") as ThemeValue)
    : "system";

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-0.5"
    >
      {OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const active = mounted && current === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => switchTheme(opt.value)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-body-sm font-medium",
              "transition-[background-color,color,box-shadow] duration-150 ease-out",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)]",
              active
                ? "bg-[var(--bg-surface-elevated)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
            )}
          >
            <Icon className="size-3.5" />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
```

### Motion components (`src/components/motion/`)

These are reusable motion primitives. Two animation surfaces and the theme provider.

`src/components/motion/theme-provider.tsx` — thin `"use client"` wrapper around `next-themes` `ThemeProvider`.

```tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

type Props = ComponentProps<typeof NextThemesProvider>;

export function ThemeProvider({ children, ...props }: Props) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
```

`src/components/motion/fade-in.tsx` — `<FadeIn>` wraps a section with stagger / fade-in-up variants from `lib/motion`. `<FadeInItem>` is a child variant.

```tsx
"use client";

import { motion, type MotionProps } from "framer-motion";
import type { ReactNode } from "react";
import { fadeInUp, staggerContainer } from "@/lib/motion";

interface FadeInProps extends MotionProps {
  children: ReactNode;
  className?: string;
  stagger?: boolean;
  delay?: number;
}

export function FadeIn({ children, className, stagger = false, delay = 0, ...rest }: FadeInProps) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={stagger ? staggerContainer : fadeInUp}
      transition={{ delay }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export function FadeInItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={fadeInUp} className={className}>
      {children}
    </motion.div>
  );
}
```

`src/components/motion/glow-card.tsx` — pointer-tracked violet halo + 2px lift on hover. Used on the marketing demo page; **not used anywhere in the operator dashboard yet**.

```tsx
"use client";

import { motion, useMotionTemplate, useMotionValue } from "framer-motion";
import { type ReactNode, type MouseEvent, useCallback } from "react";
import { cn } from "@/lib/utils";
import { durationFast, easeOutExpo } from "@/lib/motion";

interface GlowCardProps {
  children: ReactNode;
  className?: string;
  intensity?: number;
}

export function GlowCard({ children, className, intensity = 0.6 }: GlowCardProps) {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const handleMouseMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      mouseX.set(e.clientX - rect.left);
      mouseY.set(e.clientY - rect.top);
    },
    [mouseX, mouseY],
  );

  const background = useMotionTemplate`radial-gradient(420px circle at ${mouseX}px ${mouseY}px, rgba(124, 58, 237, ${intensity * 0.25}), transparent 70%)`;

  return (
    <motion.div
      onMouseMove={handleMouseMove}
      whileHover={{ y: -2 }}
      transition={{ duration: durationFast, ease: easeOutExpo }}
      className={cn(
        "group relative overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6",
        "transition-colors duration-150 hover:border-[var(--border-default)]",
        className,
      )}
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background }}
      />
      <div className="relative">{children}</div>
    </motion.div>
  );
}
```

`useThemeSwitcher` (`src/hooks/use-theme-switcher.ts`) — animated theme switcher used by both `ThemePicker` and the user-menu submenu. Tries `document.startViewTransition()` first; falls back to a 220ms `theme-transitioning` class on `<html>` (the CSS for which is in `globals.css`).

```ts
"use client";

import { useCallback } from "react";
import { useTheme } from "next-themes";

const TRANSITION_CLASS = "theme-transitioning";
const FALLBACK_DURATION_MS = 220;

type ThemeValue = "light" | "dark" | "system";

type StartViewTransition = (cb: () => void) => { ready: Promise<void>; finished: Promise<void> };

export function useThemeSwitcher() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  const switchTheme = useCallback(
    (next: ThemeValue) => {
      if (typeof window === "undefined" || typeof document === "undefined") {
        setTheme(next);
        return;
      }

      const start = (
        document as Document & { startViewTransition?: StartViewTransition }
      ).startViewTransition;

      if (typeof start === "function") {
        start.call(document, () => {
          setTheme(next);
        });
        return;
      }

      const root = document.documentElement;
      root.classList.add(TRANSITION_CLASS);
      setTheme(next);
      window.setTimeout(() => {
        root.classList.remove(TRANSITION_CLASS);
      }, FALLBACK_DURATION_MS);
    },
    [setTheme],
  );

  return { theme, resolvedTheme, switchTheme };
}
```

---

## 6. Domain components

`src/components/app/` is grouped by surface, mirroring the route structure under `(app)/[tenantSlug]/`. Plus auth and onboarding live in their own roots.

### Inventory by surface

```
auth (login / signup / verify-request / onboarding screens)
  src/components/auth/auth-card.tsx              (login + signup form, glassmorphic card)
  src/components/auth/auth-mesh-backdrop.tsx     (slowly drifting --gradient-mesh background)
  src/components/auth/google-icon.tsx            (multicolor Google "G" SVG)
  src/components/auth/magnetic-button.tsx        (cursor-tracking magnetic primary CTA, used by AuthCard and CreateTenantCard)

onboarding
  src/components/onboarding/create-tenant-card.tsx  (single-step "name your workspace" form; ALL of the current onboarding UI)

app shell / chrome (used by the tenant layout)
  src/components/app/sidebar.tsx                 (server component composer)
  src/components/app/sidebar-nav.tsx             (12-item tenant nav with active-state longest-prefix wins)
  src/components/app/workspace-switcher.tsx      (Radix DropdownMenu of memberships, gradient initial squares, "Create workspace" foot)
  src/components/app/user-menu.tsx               (Radix DropdownMenu with avatar, theme submenu, super-admin link, sign-out)
  src/components/app/command-palette.tsx         (cmdk palette with navigation/theme/workspace/account groups + recents)
  src/components/app/command-palette-trigger.tsx (sidebar search button + global ⌘K listener dispatching custom event)
  src/components/app/theme-toggle-menu.tsx       (theme submenu inside the user-menu dropdown)
  src/components/app/placeholder-page.tsx        (icon + title + description + phase pill empty-state used by playground/billing)

settings
  src/components/app/settings-tabs.tsx           (border-bottom tab bar; "General" / "Members")
  src/components/app/workspace-name-form.tsx     (useActionState text input with "Saved" success indicator, role-disabled)
  src/components/app/members-list.tsx            (Radix Avatar rows, divider list, role badge, "(you)" tag; renderInvite/renderRowActions slots reserved for Phase 9)
  src/components/app/role-badge.tsx              (gradient-filled OWNER pill, tonal pills for ADMIN/AGENT/VIEWER)

conversations
  src/components/app/conversations/conversations-list-client.tsx    (channel filter pills + 4s-poll list)
  src/components/app/conversations/conversation-detail-client.tsx   (header, escalation callout, read-only banner, 4s-poll message list)
  src/components/app/conversations/message-bubble.tsx               (3-variant bubble: customer/AI/agent, RTL via dir, citations strip, delivery indicator)

knowledge (Documents)
  src/components/app/knowledge/knowledge-list-client.tsx            (sources table, status pills, stale badge, add-source modal with website/file/manual tabs, retrieval test panel)
  src/components/app/knowledge/source-detail-client.tsx             (source header, status, chunk list with token counts, row actions)
  src/components/app/knowledge/retrieval-test-panel.tsx             (text input + ranked chunk results — debug surface inside the Knowledge page)

knowledge / Products (items)
  src/components/app/items/items-list-client.tsx     (search + product list + create/edit modal + bulk verify + delete)
  src/components/app/items/items-import-client.tsx   (paste-text smart import or CSV upload → preview → commit; AI-flagged ambiguities)
  src/components/app/items/item-form.tsx             (create/edit form; specs key/value rows; availability enum; template-id field; Zod-parsed)

knowledge / Q&A
  src/components/app/qna/qna-list-client.tsx         (search + language filter + list + create/edit modal + bulk delete)
  src/components/app/qna/qna-form.tsx                (create/edit form; question + answer + language selector; Zod-parsed)

knowledge / Business Info (operational facts)
  src/components/app/operational-facts/business-info-client.tsx  (long structured form: hours per day, locations, contact channels, languages spoken, holidays, payment/shipping policies)

knowledge / Knowledge Gaps
  src/components/app/gaps/gaps-list-client.tsx       (cluster cards with sample customer messages; resolve→Q&A or dismiss; unclustered tail list)

channels
  src/components/app/channels/channel-row.tsx                 (icon + name + description + status pill; used by /channels list)
  src/components/app/channels/enable-widget-form.tsx          (one-click enable button when no widget Channel row exists yet)
  src/components/app/channels/widget-config-card.tsx          (publicKey display + copy, embed-snippet block, accent override, origin allowlist editor, rotate-key flow)
  src/components/app/channels/whatsapp-connect-form.tsx       (paste 360dialog API key + phoneNumberId + E.164 number + display name; reveals webhook secret on success)
  src/components/app/channels/whatsapp-config-card.tsx        (display config, webhook URL + verify token + secret rotation, test connection, disconnect / reconnect)
  src/components/app/channels/meta-connect-form.tsx           (two-step preview→confirm Page Access Token paste; lights up Messenger and Instagram together when linked)
  src/components/app/channels/meta-config-card.tsx            (shared config card for both Messenger and Instagram detail pages — readOnlyRows differ per platform)

other
  src/components/icons/                          (empty)
  src/components/marketing/                      (empty)
```

### Five most prominent — full source

The five components the operator dashboard depends on most are the layout chrome (sidebar nav + workspace switcher + command palette + user menu) and the conversations list (the highest-traffic operator surface). Sidebar, sidebar-nav, conversations-list-client, and conversation-detail-client / message-bubble are already dumped in §3 / §4 above.

#### `src/components/app/workspace-switcher.tsx` (full)

```tsx
"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";
import { switchWorkspaceAction } from "@/server/tenancy/actions";
import { cn } from "@/lib/utils";

type Membership = {
  tenantId: string;
  tenant: { id: string; slug: string; name: string };
};

export function WorkspaceSwitcher({
  current,
  memberships,
}: {
  current: { id: string; slug: string; name: string };
  memberships: Membership[];
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={cn(
          "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-150 ease-out",
          "hover:bg-[var(--bg-surface-elevated)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)]",
        )}
        aria-label={`Switch workspace. Current: ${current.name}`}
      >
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-body-sm font-semibold text-white"
          style={{ background: "var(--gradient-primary)" }}
        >
          {current.name.charAt(0).toUpperCase()}
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-body-sm font-medium text-[var(--text-primary)]">
            {current.name}
          </span>
          <span className="truncate text-caption text-[var(--text-tertiary)]">
            messaging-ai.app/{current.slug}
          </span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]" />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 min-w-[260px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] p-1 shadow-[var(--shadow-lg)]"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-caption uppercase tracking-wider text-[var(--text-tertiary)]">
            Workspaces
          </DropdownMenu.Label>

          {memberships.map((m) => {
            const isCurrent = m.tenantId === current.id;
            return (
              <form key={m.tenantId} action={switchWorkspaceAction}>
                <input type="hidden" name="tenantId" value={m.tenantId} />
                <input type="hidden" name="slug" value={m.tenant.slug} />
                <DropdownMenu.Item
                  asChild
                  onSelect={(e) => e.preventDefault()}
                >
                  <button
                    type="submit"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-sm",
                      "transition-colors duration-150 ease-out",
                      "hover:bg-[var(--bg-surface-overlay)] focus:bg-[var(--bg-surface-overlay)] focus:outline-none",
                    )}
                  >
                    <span
                      aria-hidden
                      className="flex size-6 shrink-0 items-center justify-center rounded-md text-caption font-semibold text-white"
                      style={{ background: "var(--gradient-primary)" }}
                    >
                      {m.tenant.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="truncate text-[var(--text-primary)]">
                        {m.tenant.name}
                      </span>
                      <span className="truncate text-caption text-[var(--text-tertiary)]">
                        /{m.tenant.slug}
                      </span>
                    </span>
                    {isCurrent ? (
                      <Check className="size-4 shrink-0 text-[var(--accent-hover)]" />
                    ) : null}
                  </button>
                </DropdownMenu.Item>
              </form>
            );
          })}

          <DropdownMenu.Separator className="my-1 h-px bg-[var(--border-subtle)]" />

          <DropdownMenu.Item asChild>
            <Link
              href="/onboarding/create-tenant"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-body-sm text-[var(--text-secondary)] transition-colors duration-150 ease-out hover:bg-[var(--bg-surface-overlay)] hover:text-[var(--text-primary)] focus:bg-[var(--bg-surface-overlay)] focus:outline-none"
            >
              <span
                aria-hidden
                className="flex size-6 shrink-0 items-center justify-center rounded-md border border-dashed border-[var(--border-default)]"
              >
                <Plus className="size-3.5" />
              </span>
              Create workspace
            </Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
```

#### `src/components/app/user-menu.tsx` (full)

```tsx
"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { LogOut, Shield } from "lucide-react";
import Link from "next/link";
import { signOutAction } from "@/server/auth/actions";
import { ThemeToggleSubmenu } from "./theme-toggle-menu";
import { cn } from "@/lib/utils";

export function UserMenu({
  user,
}: {
  user: {
    name: string | null;
    email: string | null;
    image: string | null;
    isSuperAdmin: boolean;
  };
}) {
  const initials = (user.name ?? user.email ?? "?").trim().charAt(0).toUpperCase();
  const display = user.name ?? user.email ?? "Account";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={cn(
          "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-150 ease-out",
          "hover:bg-[var(--bg-surface-elevated)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)]",
        )}
        aria-label="Open user menu"
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.image}
            alt=""
            className="size-7 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--bg-surface-overlay)] text-body-sm font-semibold text-[var(--text-secondary)]"
          >
            {initials}
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-body-sm font-medium text-[var(--text-primary)]">
            {display}
          </span>
          {user.email && user.email !== display ? (
            <span className="truncate text-caption text-[var(--text-tertiary)]">
              {user.email}
            </span>
          ) : null}
        </span>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          side="top"
          sideOffset={6}
          className="z-50 min-w-[220px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] p-1 shadow-[var(--shadow-lg)]"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-caption uppercase tracking-wider text-[var(--text-tertiary)]">
            {user.email ?? "Account"}
          </DropdownMenu.Label>

          <ThemeToggleSubmenu />

          {user.isSuperAdmin ? (
            <DropdownMenu.Item asChild>
              <Link
                href="/admin"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-body-sm text-[var(--text-secondary)] transition-colors duration-150 ease-out hover:bg-[var(--bg-surface-overlay)] hover:text-[var(--text-primary)] focus:bg-[var(--bg-surface-overlay)] focus:outline-none"
              >
                <Shield className="size-4 text-[var(--text-tertiary)]" />
                Admin
              </Link>
            </DropdownMenu.Item>
          ) : null}

          <DropdownMenu.Separator className="my-1 h-px bg-[var(--border-subtle)]" />

          <form action={signOutAction}>
            <DropdownMenu.Item asChild onSelect={(e) => e.preventDefault()}>
              <button
                type="submit"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-sm text-[var(--text-secondary)] transition-colors duration-150 ease-out hover:bg-[var(--bg-surface-overlay)] hover:text-[var(--text-primary)] focus:bg-[var(--bg-surface-overlay)] focus:outline-none"
              >
                <LogOut className="size-4 text-[var(--text-tertiary)]" />
                Sign out
              </button>
            </DropdownMenu.Item>
          </form>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
```

#### `src/components/app/command-palette.tsx` (full — long, ~450 lines)

```tsx
"use client";

import { Command } from "cmdk";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  Building2,
  Check,
  CreditCard,
  Laptop,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Moon,
  Plug,
  Plus,
  Search,
  Settings,
  Shield,
  Sparkles,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useThemeSwitcher } from "@/hooks/use-theme-switcher";
import { signOutAction } from "@/server/auth/actions";
import { switchWorkspaceAction } from "@/server/tenancy/actions";
import { easeSpring } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Membership = {
  tenantId: string;
  tenant: { id: string; slug: string; name: string };
};

type ItemSpec = {
  id: string;
  label: string;
  icon: LucideIcon;
  hint?: string;
  perform: () => void;
  keywords?: string[];
};

const RECENTS_KEY = "messaging-ai:cmdk:recents";
const RECENTS_LIMIT = 3;

function loadRecents(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? (parsed.filter((s) => typeof s === "string") as string[]).slice(
          0,
          RECENTS_LIMIT,
        )
      : [];
  } catch {
    return [];
  }
}

function saveRecent(id: string) {
  if (typeof window === "undefined") return;
  try {
    const current = loadRecents().filter((existing) => existing !== id);
    const next = [id, ...current].slice(0, RECENTS_LIMIT);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* ignore storage errors (private mode, quota) */
  }
}

export function CommandPalette({
  tenantSlug,
  currentTenantId,
  memberships,
  user,
}: {
  tenantSlug: string;
  currentTenantId: string;
  memberships: Membership[];
  user: { isSuperAdmin: boolean };
}) {
  const router = useRouter();
  const { theme, switchTheme } = useThemeSwitcher();
  const [open, setOpen] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const formContainerRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    function onOpen() {
      setRecents(loadRecents());
      setOpen(true);
    }
    window.addEventListener("command-palette:open", onOpen);
    return () => window.removeEventListener("command-palette:open", onOpen);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const navigate = useCallback(
    (href: string) => {
      close();
      startTransition(() => router.push(href));
    },
    [close, router],
  );

  const switchWorkspace = useCallback(
    (membership: Membership) => {
      close();
      const fd = new FormData();
      fd.set("tenantId", membership.tenantId);
      fd.set("slug", membership.tenant.slug);
      void switchWorkspaceAction(fd);
    },
    [close],
  );

  const signOut = useCallback(() => {
    close();
    void signOutAction();
  }, [close]);

  const navigationItems: ItemSpec[] = [
    { id: "nav:dashboard",     label: "Dashboard",      icon: LayoutDashboard, perform: () => navigate(`/${tenantSlug}/dashboard`) },
    { id: "nav:conversations", label: "Conversations",  icon: MessageSquare,   perform: () => navigate(`/${tenantSlug}/conversations`) },
    { id: "nav:knowledge",     label: "Knowledge",      icon: BookOpen,        perform: () => navigate(`/${tenantSlug}/knowledge`) },
    { id: "nav:channels",      label: "Channels",       icon: Plug,            perform: () => navigate(`/${tenantSlug}/channels`) },
    { id: "nav:playground",    label: "Playground",     icon: Sparkles,        perform: () => navigate(`/${tenantSlug}/playground`) },
    { id: "nav:settings",      label: "Settings",       icon: Settings,        perform: () => navigate(`/${tenantSlug}/settings/general`) },
    { id: "nav:billing",       label: "Billing",        icon: CreditCard,      perform: () => navigate(`/${tenantSlug}/billing`) },
  ];

  const themeItems: ItemSpec[] = [
    { id: "theme:light",  label: "Light theme",          icon: Sun,    hint: theme === "light" ? "Active" : undefined,  perform: () => { switchTheme("light"); close(); }, keywords: ["theme", "appearance"] },
    { id: "theme:dark",   label: "Dark theme",           icon: Moon,   hint: theme === "dark" ? "Active" : undefined,   perform: () => { switchTheme("dark"); close(); }, keywords: ["theme", "appearance"] },
    { id: "theme:system", label: "Match system theme",   icon: Laptop, hint: theme === "system" ? "Active" : undefined, perform: () => { switchTheme("system"); close(); }, keywords: ["theme", "auto", "appearance"] },
  ];

  const workspaceItems: ItemSpec[] = [
    ...memberships.map<ItemSpec>((m) => ({
      id: `workspace:${m.tenantId}`,
      label: `Switch to ${m.tenant.name}`,
      icon: Building2,
      hint: m.tenantId === currentTenantId ? "Current" : `/${m.tenant.slug}`,
      perform: () => switchWorkspace(m),
      keywords: ["workspace", "switch", m.tenant.slug],
    })),
    { id: "workspace:create", label: "Create workspace", icon: Plus, perform: () => navigate("/onboarding/create-tenant"), keywords: ["workspace", "new"] },
  ];

  const accountItems: ItemSpec[] = [
    ...(user.isSuperAdmin
      ? [{
          id: "account:admin",
          label: "Open admin",
          icon: Shield,
          perform: () => navigate("/admin"),
          keywords: ["admin", "super"],
        } satisfies ItemSpec]
      : []),
    { id: "account:signout", label: "Sign out", icon: LogOut, perform: signOut, keywords: ["logout", "log out"] },
  ];

  const allItems: ItemSpec[] = [...navigationItems, ...themeItems, ...workspaceItems, ...accountItems];
  const itemMap = new Map(allItems.map((it) => [it.id, it]));
  const recentItems = recents
    .map((id) => itemMap.get(id))
    .filter((x): x is ItemSpec => Boolean(x));

  function runItem(item: ItemSpec) {
    saveRecent(item.id);
    item.perform();
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            aria-hidden
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={easeSpring}
            className="relative w-[640px] max-w-[calc(100vw-32px)]"
          >
            <Command
              label="Command palette"
              shouldFilter
              className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface-elevated)] shadow-[var(--shadow-lg)]"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  close();
                }
              }}
            >
              <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4">
                <Search className="size-4 shrink-0 text-[var(--text-tertiary)]" />
                <Command.Input
                  autoFocus
                  placeholder="Type a command or search…"
                  className={cn(
                    "h-12 flex-1 bg-transparent text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]",
                    "focus:outline-none",
                  )}
                />
                <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-tertiary)]">
                  Esc
                </kbd>
              </div>

              <Command.List className="max-h-[420px] overflow-y-auto p-1.5">
                <Command.Empty className="px-3 py-8 text-center text-body-sm text-[var(--text-tertiary)]">
                  No matches.
                </Command.Empty>

                {recentItems.length > 0 ? (
                  <PaletteGroup heading="Recent">
                    {recentItems.map((it) => (
                      <PaletteItem key={`recent-${it.id}`} item={it} onRun={runItem} />
                    ))}
                  </PaletteGroup>
                ) : null}

                <PaletteGroup heading="Navigation">
                  {navigationItems.map((it) => <PaletteItem key={it.id} item={it} onRun={runItem} />)}
                </PaletteGroup>

                <PaletteGroup heading="Theme">
                  {themeItems.map((it) => <PaletteItem key={it.id} item={it} onRun={runItem} />)}
                </PaletteGroup>

                <PaletteGroup heading="Workspace">
                  {workspaceItems.map((it) => <PaletteItem key={it.id} item={it} onRun={runItem} />)}
                </PaletteGroup>

                <PaletteGroup heading="Account">
                  {accountItems.map((it) => <PaletteItem key={it.id} item={it} onRun={runItem} />)}
                </PaletteGroup>
              </Command.List>

              <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-4 py-2 text-caption text-[var(--text-tertiary)]">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1">
                    <Kbd>↑</Kbd><Kbd>↓</Kbd>Navigate
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Kbd>↵</Kbd>Select
                  </span>
                </div>
                <span className="inline-flex items-center gap-1">
                  <Kbd>⌘</Kbd><Kbd>K</Kbd>Open anywhere
                </span>
              </div>

              <form ref={formContainerRef} className="hidden" />
            </Command>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function PaletteGroup({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="px-1 pb-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--text-tertiary)]"
    >
      {children}
    </Command.Group>
  );
}

function PaletteItem({ item, onRun }: { item: ItemSpec; onRun: (item: ItemSpec) => void }) {
  const Icon = item.icon;
  return (
    <Command.Item
      value={`${item.label} ${(item.keywords ?? []).join(" ")}`}
      onSelect={() => onRun(item)}
      className={cn(
        "flex h-9 cursor-pointer items-center gap-3 rounded-md px-2.5 text-body-sm",
        "text-[var(--text-secondary)]",
        "data-[selected=true]:bg-[var(--bg-surface-overlay)] data-[selected=true]:text-[var(--text-primary)]",
        "transition-colors duration-100 ease-out",
      )}
    >
      <Icon className="size-4 shrink-0 text-[var(--text-tertiary)]" />
      <span className="flex-1 truncate">{item.label}</span>
      {item.hint ? (
        <span className="inline-flex items-center gap-1 text-caption text-[var(--text-tertiary)]">
          {item.hint === "Active" || item.hint === "Current" ? (
            <Check className="size-3 text-[var(--accent-hover)]" />
          ) : null}
          {item.hint}
        </span>
      ) : (
        <ArrowRight className="size-3 opacity-0 transition-opacity duration-100 group-data-[selected=true]:opacity-100" />
      )}
    </Command.Item>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] px-1 text-[10px] font-mono text-[var(--text-tertiary)]">
      {children}
    </kbd>
  );
}
```

#### `src/components/app/command-palette-trigger.tsx` (full)

```tsx
"use client";

import { Search } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

export function CommandPaletteTrigger() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMacMeta = e.metaKey;
      const isOtherCtrl = e.ctrlKey && !e.metaKey;
      if ((isMacMeta || isOtherCtrl) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("command-palette:open"));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function open() {
    window.dispatchEvent(new CustomEvent("command-palette:open"));
  }

  return (
    <button
      type="button"
      onClick={open}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-1.5",
        "text-body-sm text-[var(--text-tertiary)]",
        "transition-colors duration-150 ease-out",
        "hover:border-[var(--border-default)] hover:text-[var(--text-secondary)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-base)]",
      )}
    >
      <Search className="size-3.5" />
      <span className="flex-1 text-left">Search…</span>
      <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-tertiary)]">
        ⌘K
      </kbd>
    </button>
  );
}
```

#### `src/components/app/conversations/conversations-list-client.tsx`

Already provided in §4 above (shown there because it's the dominant operator data surface). Includes the channel filter pills, 4s polling re-fetch loop, conversation row composition with status pill + language flag, customer avatar, last-message preview, relative time, message count.

#### `src/components/app/conversations/message-bubble.tsx`

Already provided in §4 above. Three-variant bubble (customer / AI / human-agent) with RTL via `dir`, citations chip strip with kind badges (chunk / item / qna / operational_fact), inline citation preview panel, delivery status indicator (sent / delivered / read / failed / skipped_outside_window / skipped_unsupported_channel), and media placeholders for IMAGE / VOICE / FILE message types.

### One-paragraph summaries — remaining domain components

**`src/components/auth/auth-card.tsx`** (134 lines, `"use client"`) — login + signup form. Glassmorphic surface with `color-mix(in oklab, var(--bg-surface) 88%, transparent)` and `backdrop-blur-xl`. Renders an h2 title, body subtitle, full-width Google OAuth button (`<form action={signInWithGoogle}>`), an "or" divider, an email input + `<MagneticButton>` submit (via `useActionState(signInWithEmail, …)`), and a footer link toggling between login/signup. Mode prop drives copy; `pending` from action state disables the input.

**`src/components/auth/auth-mesh-backdrop.tsx`** (38 lines, `"use client"`) — fixed `-z-20` `motion.div` whose `backgroundPosition` animates `0% 0% → 100% 100% → 0% 0%` over a 30-second infinite loop, plus a fixed radial-gradient vignette that fades the mesh into `--bg-base` at the edges. Uses `--gradient-mesh` so it adapts to the theme.

**`src/components/auth/magnetic-button.tsx`** (88 lines) — `motion.button` with cursor-tracked spring offset (`stiffness: 400, damping: 30`), 8px max displacement. Renders the violet primary CTA with the `shadow-[0_0_32px_var(--accent-glow)]` halo on hover. Used by `AuthCard` and `CreateTenantCard`.

**`src/components/auth/google-icon.tsx`** — multicolored Google "G" SVG.

**`src/components/onboarding/create-tenant-card.tsx`** (147 lines, `"use client"`) — single-step "name your workspace" form. Same glassmorphic shell as `AuthCard`. Workspace name input + workspace-URL input where the slug auto-syncs from the name until the user manually edits it (`slugTouched` flag + `suggestSlug`). `useActionState(createTenantAction, …)`. Per-field error rendering and a `<MagneticButton>` submit that says "Creating workspace…" while pending.

**`src/components/app/placeholder-page.tsx`** (59 lines, server component) — empty-state body for routes whose feature ships in a later phase. Renders an h1 page title at the top, a centered card with an icon (in a violet-tinted circle), an h4 "<Title> arrives soon", body description, and a phase pill ("Phase N"). Used by `/playground` and `/billing`.

**`src/components/app/settings-tabs.tsx`** (46 lines, `"use client"`) — 2-tab top-bar nav (`General` / `Members`) with active-state border-bottom in `--accent-base`. Reads `usePathname` and uses prefix matching with longest-match wins.

**`src/components/app/workspace-name-form.tsx`** (106 lines, `"use client"`) — `useActionState(updateTenantNameAction, …)`. Single text input + violet "Save changes" button (disabled until dirty), shows a "Saved" success indicator for 2 seconds when state.status === "saved", per-field error, and a "Only owners and admins can edit settings" hint when `!canEdit`. Form posts a hidden `tenantSlug` field.

**`src/components/app/theme-toggle-menu.tsx`** (80 lines, `"use client"`) — Radix `<DropdownMenu.Sub>` with three options (Light / Dark / System). Active option shows the Check icon in `--accent-hover`. Used inside `<UserMenu>`.

**`src/components/app/role-badge.tsx`** (48 lines, server component) — pill badge keyed by Role enum. OWNER is the only one with `--gradient-primary` (violet→cyan); ADMIN is a violet-tinted pill, AGENT is a neutral elevated pill, VIEWER is a muted surface pill.

**`src/components/app/members-list.tsx`** (131 lines, server component) — divided list of avatar + display name + email + "(you)" tag + RoleBadge. Avatars are Radix Avatar with image fallback to initials. Reserves `renderInvite` and `renderRowActions` slots for Phase 9 invite + change-role surfaces.

**`src/components/app/conversations/conversation-detail-client.tsx`** (286 lines, `"use client"`) — owns the conversation detail surface: back-link to `/conversations`, `<DetailHeader>` (h2 customer label, channel icon + label, contextLabel like phone or `@username`, language badge, status pill + "AI replying / paused" sub-text, optional `<EscalationCallout>` orange banner when `metadata.lastEscalationReason` is set), the `<ReadOnlyBanner>` lock-icon strip, then the scrollable message list (border + bg-surface card with px-5 py-5 padding, 5-unit `space-y-5`). Polls `getConversationDetail(slug, conversationId)` every 4s and auto-scrolls when the trailing message id changes.

**`src/components/app/knowledge/knowledge-list-client.tsx`** (~580 lines, `"use client"`) — owns the Documents page. Header with Plus button → modal. SourcesTable with columns Source / Status / Chunks / Last ingested / actions. Status pills (Queued / Processing / Ready / Error) and a "stale" amber pill when both lastIngestedAt and lastVerifiedAt are older than 45 days. Per-row actions: Mark verified today, Re-ingest, Delete. AddSourceModal has 3 tabs: website (URL input), file (drop-zone PDF/DOCX/TXT up to 25 MB), manual (title + textarea). Polls every 2.5 seconds while any source is `PENDING`/`PROCESSING`. Inline `<RetrievalTestPanel>` below the table.

**`src/components/app/knowledge/source-detail-client.tsx`** (~258 lines, `"use client"`) — source detail surface. Header with type icon + name + status pill + last-ingested + source URL (if WEBSITE) / filename (if FILE). Per-chunk list with token counts. Re-ingest, mark verified, delete actions.

**`src/components/app/knowledge/retrieval-test-panel.tsx`** (~165 lines, `"use client"`) — debug panel below the sources table. Text input + button → calls `runRetrieval` Server Action → renders the top-K chunks with vector + lexical scores (using `<0.01` rendering for ts_rank near-zero values).

**`src/components/app/items/items-list-client.tsx`** (~534 lines, `"use client"`) — Products page client. Header with Plus button + search input + Upload-CSV button. Item list (rendered as a table) with row hover, edit pencil, delete trash. Bulk-verify ("Mark all as verified" — clears stale-after-45-days indicator without re-importing). Create/edit modal mounts `<ItemForm>`.

**`src/components/app/items/items-import-client.tsx`** (~653 lines, `"use client"`) — Smart-import + CSV upload page. Two flows: paste-text → calls `smartImportItemsAction` (Claude extracts items via tool-use), or upload CSV → `previewCsvImportAction`. Shows extracted items in an editable preview grid with per-row error/warning chips for ambiguous fields. Operator confirms → `commitImportedItemsAction` writes the rows.

**`src/components/app/items/item-form.tsx`** (~475 lines, `"use client"`) — single create/edit form. Fields: name / brand / SKU / description / price + currency / availability enum (in_stock / low_stock / out_of_stock / discontinued) / specs (key/value rows that the operator can add or remove with the Plus / Trash buttons) / template_id. Zod-parsed before submit.

**`src/components/app/qna/qna-list-client.tsx`** (~610 lines, `"use client"`) — Q&A page. Header + search + language filter pills. List of cards (question + answer preview + language badge), edit/delete actions, bulk delete. Create/edit modal mounts `<QnaForm>`.

**`src/components/app/qna/qna-form.tsx`** (~419 lines, `"use client"`) — create/edit form. Question textarea + answer textarea + language radio (Arabic MSA / French / English / Darija). Zod-parsed.

**`src/components/app/operational-facts/business-info-client.tsx`** (~652 lines, `"use client"`) — long structured form. Card sections for Business Hours (one row per `DAY_OF_WEEK` with open/close + "closed" toggle), Locations (add multiple, each with name + address + phone + map link), Contact channels, Languages spoken, Holidays / closures, Payment methods / shipping policies. Submits via `saveOperationalFacts`.

**`src/components/app/gaps/gaps-list-client.tsx`** (~465 lines, `"use client"`) — Knowledge Gaps page. Cluster cards: each shows the cluster's representative question, sample customer messages, count, last-occurred timestamp, and two buttons — "Resolve" (opens an inline Q&A creation form pre-filled from the cluster) and "Dismiss" (calls `dismissGapAction`). Unclustered tail list at the bottom for stragglers that haven't yet been clustered.

**`src/components/app/channels/channel-row.tsx`** (115 lines, server component) — single row in the `/channels` list. Icon + name + description + status pill ("Connected" / "Paused" / "Available") + chevron link.

**`src/components/app/channels/widget-config-card.tsx`** (~592 lines, `"use client"`) — full widget config surface. publicKey display with copy-to-clipboard, embed-snippet code block, accent-color override input, origin-allowlist editor (add / remove canonicalized origins), rotate-key flow with dual-confirmation modal. Status pill, "Pause" / "Resume" via reconnect-style action.

**`src/components/app/channels/whatsapp-config-card.tsx`** (~573 lines, `"use client"`) — config surface for connected WhatsApp channels. Display config (phone number, phoneNumberId, displayName), webhook URL + verify token + secret rotation flow, test-connection button, disconnect / reconnect.

**`src/components/app/channels/whatsapp-connect-form.tsx`** (~273 lines, `"use client"`) — initial-connect form. Fields: 360dialog API key, phoneNumberId, E.164 phone number, display name. On success returns the freshly-minted webhook secret which the form reveals once for the operator to paste into 360dialog.

**`src/components/app/channels/meta-config-card.tsx`** (~529 lines, `"use client"`) — shared config surface for both Messenger and Instagram. Renders read-only platform-specific rows (page name + page id for Messenger; @username + ig user id + linked page id for Instagram), webhook URL + verify token, test-connection, disconnect / reconnect, displayName edit.

**`src/components/app/channels/meta-connect-form.tsx`** (~528 lines, `"use client"`) — two-step preview→confirm Page Access Token paste flow. Phase 1 (preview) calls `previewFacebookPage` to validate the token + fetch Page details; Phase 2 (confirm) calls `confirmFacebookPage` to create both `MESSENGER` and `INSTAGRAM` Channel rows when the Page has a linked IG Business Account.

**`src/components/app/channels/enable-widget-form.tsx`** (86 lines, `"use client"`) — one-click enable button (not a form with fields). Calls `enableWidgetChannel` which mints a publicKey + creates the Channel row. The page revalidates and re-renders into the configured state.

---

## 7. Data flow into the UI

**Pattern:** every operator page is an **async Server Component** that reads via `src/server/db/<feature>.ts` helpers and passes initial data as props to a `*-client.tsx` component for interactivity.

- **No tRPC, no SWR, no React Query.** The client side either re-calls a Server Action on a polling interval (conversations, knowledge) or relies on `router.refresh()` after mutating actions to re-trigger the server render.
- **Mutations** go through Server Actions in `src/server/<feature>/actions.ts` (e.g. `src/server/tenancy/actions.ts`, `src/server/knowledge/actions.ts`, `src/server/channels/widget/actions.ts`, etc.). Client components import them directly and call them via `useActionState(action, initialState)`, `<form action={action}>`, or plain `void action(...)` for fire-and-forget cases. State shapes for `useActionState` are co-located in `<feature>/state.ts` files.
- **Polling** (no websocket / SSE on the operator side):
  - Conversations list: 4-second `setInterval` polling `listConversations(slug, { channelType })`.
  - Conversation detail: 4-second polling `getConversationDetail(slug, conversationId)`. Auto-scroll fires only when the trailing message id changes.
  - Knowledge sources list: 2.5-second polling `listSources(slug)`, but only mounted while any source is `PENDING`/`PROCESSING`.
  - The widget itself uses `POST + ReadableStream` SSE for the customer chat (per `CLAUDE.md` §3 streaming-endpoint rule). The operator dashboard does not consume the stream — it polls the persisted Message rows.
- **Suspense / loading.tsx:** none. There is no `loading.tsx` anywhere in the route tree (confirmed by Glob). Every page renders synchronously after its server reads. Skeletons exist nowhere — only the `<Loader2 className="animate-spin">` icon + `pending` button states inside individual forms.
- **Page transitions:** none beyond Next.js's default. Framer Motion is used at the **component** level (`<FadeIn>` wrapping the demo page hero, `<motion.div>` initial-y-16 fade-in on the AuthCard / CreateTenantCard, command palette spring-in via `easeSpring`, command palette modal fade), not at the route level.
- **Theatrical motion in operator surfaces today:**
  - `AuthMeshBackdrop` (login / signup / verify-request / onboarding) — slow-drifting mesh gradient (theatrical moment #1 in §4.7).
  - `MagneticButton` (login / signup / onboarding submit CTAs) — cursor-pulled magnetic effect.
  - `CommandPalette` (any tenant page, ⌘K) — Linear-style spring-in (theatrical moment #6).
  - `useThemeSwitcher` (theme picker + user menu) — `document.startViewTransition()` crossfade with CSS-variable fallback (theatrical moment #5).
  - `GlowCard` exists in the motion components but is currently used **only** on the `/` Phase-1 demo, not in the operator dashboard.
  - The dashboard, conversations, knowledge, items, channels, settings surfaces use plain CSS transitions (`transition-colors duration-150 ease-out`, `hover:-translate-y-0.5` on cards) without Framer Motion. Daily-use pages stay calm per MASTER_PLAN §4.7.
- **State management:** all client state is component-local (`useState`, `useReducer`, `useRef`). No Zustand / Jotai / Redux / Context (other than `ThemeProvider`).

### Data flow trace, dashboard load (worked example)

1. Browser hits `/<slug>/dashboard`.
2. Middleware (`middleware.ts`) checks for the auth cookie; redirects to `/login?next=…` if absent.
3. `(app)/[tenantSlug]/layout.tsx` runs `getTenantContext(slug)` → `auth()` from NextAuth (JWT decode, no DB hit) → `prisma.tenantUser.findFirst({ userId, tenant: { slug } })`. Throws `redirect("/login")` on no session, `notFound()` on no membership. Result is per-request memoized via React `cache()`.
4. Layout also runs `getRoutingUser(session.user.id)` for the workspace switcher's memberships.
5. Sidebar + CommandPalette + main render. Children render.
6. `dashboard/page.tsx` re-runs `getTenantContext(slug)` (cache hit). Renders static markup. No further data.
7. Client hydrates `SidebarNav`, `CommandPaletteTrigger`, `CommandPalette`, `WorkspaceSwitcher`, `UserMenu`, `ThemeToggleSubmenu`. None of these auto-fire data fetches.

The dashboard does no Suspense / streaming / progressive rendering — it's a single SSR pass.

---

## 8. Tenant + auth context in the UI

### Tenant resolution

The active tenant is resolved by URL slug. There is no header-based or subdomain-based tenant selection.

`src/server/tenancy/context.ts` exposes:

- `getTenantContext(slug)` — used by every `(app)/[tenantSlug]/**` server file. Per-request memoized via `cache()`. Redirects to `/login?next=...` on no session, calls `notFound()` on missing membership. Returns `{ user, tenant, membership: { role } }`.
- `requireTenantContext(slug, { minRole })` — same as above + a role-floor check. Throws `ForbiddenError` if the role is insufficient. Used by `/billing` (`OWNER` floor) and most mutating Server Actions.
- `ROLE_RANK` — `{ OWNER: 4, ADMIN: 3, AGENT: 2, VIEWER: 1 }`. Imported by client components that need to enable/disable affordances based on role; the same check is re-enforced server-side at the action layer.

The hard rule "never trust client-provided `tenantId`" (CLAUDE.md §3) is enforced because every action calls `requireTenantContext(formData.get("tenantSlug"))` and uses the resolved `ctx.tenant.id` rather than reading any client-supplied id.

### Sidebar nav — items + role-conditional rendering

The sidebar shows **all 12 items unconditionally**. There is no role-conditional hiding. The role gate happens at the **action / route page** layer (e.g. `/billing` is OWNER-only via `requireTenantContext({ minRole: "OWNER" })`; `/knowledge/items` page passes `canEdit = role !== "VIEWER"` down to `ItemsListClient` which disables the "Add product" button accordingly).

Items, in display order:

```
1.  Dashboard         → /<slug>/dashboard
2.  Conversations     → /<slug>/conversations           (Phase 5)
3.  Documents         → /<slug>/knowledge               (Phase 3) — labeled "Documents" in sidebar though route is /knowledge
4.  Products          → /<slug>/knowledge/items         (Phase 8)
5.  Q&A               → /<slug>/knowledge/qna           (Phase 8)
6.  Business Info     → /<slug>/knowledge/business-info (Phase 8)
7.  Live Data Sources → /<slug>/knowledge/live-data     (Phase 8 — placeholder)
8.  Knowledge Gaps    → /<slug>/knowledge/gaps          (Phase 8)
9.  Channels          → /<slug>/channels                (Phase 5)
10. Playground        → /<slug>/playground              (Phase 4 — placeholder)
11. Settings          → /<slug>/settings (→ /settings/general)
12. Billing           → /<slug>/billing                 (Phase 9 — placeholder, OWNER-only)
```

Active state uses longest-prefix wins (`/knowledge/business-info` does not also light up `/knowledge`).

### Command palette items

Programmatic surface only: ⌘K opens. Groups: Recent (last 3) / Navigation (the 7 top-level items, not the four Knowledge sub-pages) / Theme (Light/Dark/System) / Workspace (per-membership switch + Create workspace) / Account (Open admin if super-admin, Sign out).

### Auth flows

- `/login`, `/signup`, `/verify-request`, `/onboarding/create-tenant` — public via the `(auth)` route group + `middleware.ts` allowlist.
- `/post-auth` — dispatcher: redirects to `/onboarding/create-tenant` (no memberships), `/<lastUsedSlug>/dashboard` (still a member), or `/<firstMembership.slug>/dashboard`.
- `signInWithEmail`, `signInWithGoogle`, `signOutAction` live in `src/server/auth/actions.ts`.
- `auth()` is the NextAuth session resolver in `src/server/auth/index.ts`; config in `src/server/auth/config.ts`. Strategy is `jwt` (no DB Session row used at runtime — see `CLAUDE.md` §6 "Auth-gated test inspection").

### Admin vs operator routes

| Surface | Route group | Layout | Gate | Renders |
|---|---|---|---|---|
| Operator workspace | `(app)` | `(app)/[tenantSlug]/layout.tsx` | `getTenantContext` (membership required, any role) | Sidebar + main |
| Super-admin | `(admin)` | `(admin)/layout.tsx` | `auth()` + `session.user.isSuperAdmin === true`; otherwise `notFound()` (opaque 404) | Topbar + main |
| Auth flows | `(auth)` | `(auth)/layout.tsx` | Public (middleware allowlists); 302 to `/post-auth` if signed-in user lands on `/login` or `/signup` | Mesh-gradient backdrop + centered card |
| Marketing | `(marketing)` | (no layout file) | n/a | (no `page.tsx` exists yet) |

The admin layout has its own simple topbar (icon + "messaging-ai · admin" / "Super-admin only" + "Back to app" link). It does not use the sidebar.

The `Tenant.settings.voiceProfile` Zod schema lives in `src/lib/validators.ts` (full source available in §9 below). Per-tenant branding fields on `Tenant` per the Prisma schema are `name`, `slug`, `logoUrl`, `accentColor`, `plan`, `stripeCustomerId`, plus the JSON `settings`. The current UI **does not** use `logoUrl` or `accentColor` for any operator-facing rendering — the workspace switcher's avatar is a gradient initial square; the design accent stays on the global `--accent-base`.

---

## 9. Branding & theming

### Platform name in UI

Strings the user sees:

- **Browser title template:** `"%s · messaging-ai"` (default `"messaging-ai"`) — `src/app/layout.tsx`.
- **Description meta:** `"Multi-channel AI messaging platform for businesses. WhatsApp, Instagram, web, voice — Arabic, French, English, Darija."` — `src/app/layout.tsx`.
- **Sidebar wordmark:** `"messaging-ai"` in `text-caption uppercase tracking-wider text-[var(--text-tertiary)]` — `src/components/app/sidebar.tsx`.
- **Auth header:** `"messaging-ai"` in `text-body font-semibold tracking-tight` — `src/app/(auth)/layout.tsx`.
- **Admin header:** `"messaging-ai · admin"` — `src/app/(admin)/layout.tsx`.
- **Workspace URL fragment:** `"messaging-ai.app/<slug>"` — used in `src/components/app/workspace-switcher.tsx` and `src/app/(app)/[tenantSlug]/settings/general/page.tsx`. (This is a placeholder host; production domain is configured via `NEXT_PUBLIC_APP_URL`.)
- **Phase-1 demo headline:** `"The messaging brain for modern businesses."` — `src/app/page.tsx`.
- **Auth card titles:** `"Welcome back"` (login) / `"Create your workspace"` (signup) — `src/components/auth/auth-card.tsx`.

There is no logo asset. `public/fonts/` and `public/images/` are empty (`.gitkeep` only). All brand expression is typographic (the `messaging-ai` wordmark in Geist Sans) plus the gradient initial squares (`--gradient-primary` 135° violet→cyan) used for tenant avatars in the workspace switcher.

The workspace switcher's "tenant avatar" is just the first letter of `tenant.name.toUpperCase()` rendered in white over `var(--gradient-primary)`. No support for uploaded `Tenant.logoUrl` images yet, even though the schema column exists.

### Per-tenant branding

`Tenant.settings.voiceProfile` (schema in `src/lib/validators.ts`):

```ts
export const SUPPORTED_LANGUAGES = ["ar", "fr", "en", "darija"] as const;

export const voiceToneSchema = z.enum(["formal", "friendly", "casual", "expert"]);
export const emojiPolicySchema = z.enum(["none", "minimal", "expressive"]);

export const fewShotExampleSchema = z.object({
  customer: z.string().trim().min(1).max(500),
  reply: z.string().trim().min(1).max(2000),
});

export const voiceProfileSchema = z.object({
  tone: voiceToneSchema.default("friendly"),
  formality: z.number().int().min(1).max(5).default(3),    // 1 = very casual, 5 = very formal
  signaturePhrases: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
  avoid: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  emojiPolicy: emojiPolicySchema.default("minimal"),
  defaultLanguage: z.enum(SUPPORTED_LANGUAGES).default("fr"),
  fallbackLanguage: z.enum(SUPPORTED_LANGUAGES).default("en"),
  fewShot: z.array(fewShotExampleSchema).max(20).default([]),
});

export const tenantSettingsSchema = z
  .object({
    defaultLanguage: z.string().optional(),
    brandVoice: z.string().optional(),
    businessHours: z.object({ tz: z.string() }).optional(),
    voiceProfile: voiceProfileSchema.optional(),
  })
  .passthrough();
```

The voice profile is read by the brain (`src/server/ai/orchestrator.ts`) to inject Block B of the system prompt. **No operator-facing UI edits the voice profile yet** — defaults via `defaultVoiceProfile()` and `prisma/seed.ts` retrofitting only.

`Tenant.accentColor` and `Tenant.logoUrl` exist in the schema but are not consumed by any UI. The `WidgetChannelConfig.themeAccent` is the only per-tenant accent override surfaced today (in the widget config card), and it applies to the **embedded widget**, not the operator dashboard.

`OperationalFacts` (Phase 8b) is the structured per-tenant profile edited via the Business Info page — business hours, locations, contact channels, languages spoken, holidays, payment / shipping. It is consumed by the brain and does not affect the dashboard's branding.

### Light theme

Light theme tokens are defined in `globals.css` (`[data-theme="light"]` block) — full mirror of dark with inverted neutrals, slightly darker accent (`#6D28D9` instead of `#7C3AED`), and softer shadow alphas. **It is wired up:**

- `next-themes` `ThemeProvider` is configured with `attribute="data-theme" defaultTheme="dark" enableSystem`.
- `useThemeSwitcher` is consumed by both `<ThemePicker>` (settings/general) and `<ThemeToggleSubmenu>` (user menu) and the command palette.
- `globals.css` defines a `theme-transitioning` CSS class with crossfade transitions on `bg/color/border/fill/stroke`, gated on `prefers-reduced-motion`.
- `html { color-scheme: dark }` + `[data-theme="light"] { color-scheme: light }` handles native scrollbars / form controls.

Whether the operator dashboard actually **looks good** in light mode is not visually validated in this report; tokens exist but no screenshots have been captured. The widget bundle has its own light/dark handling driven by `widget/src/tokens.ts`.

---

## 10. Constraints to repeat verbatim for the recipient

The four blocks below are pasted verbatim from the source documents (`MASTER_PLAN.md` and `CLAUDE.md`). Do not paraphrase them when proposing changes — they are the contract.

### 10.1 — MASTER_PLAN.md §4 design system (verbatim)

```markdown
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
```

### 10.2 — MASTER_PLAN.md §13 hard rules (verbatim)

```markdown
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
```

### 10.3 — CLAUDE.md §3 hard rules (verbatim)

```markdown
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
```

### 10.4 — CLAUDE.md §4 conventions (verbatim)

```markdown
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
```

---

## 11. Screenshots

Screenshots: **skipped** — would require non-trivial setup. Playwright/Puppeteer is not in the dependency list; capturing meaningful operator-page screenshots would also require running the dev server, forging an auth cookie (per the JWT-mint recipe in `CLAUDE.md` §6), and seeding fixture data on a tenant. The full source dumps in §3–§6 are the more valuable artifact.

---

## 12. Gap analysis vs MASTER_PLAN

### Phase deliverables not yet present in the codebase

Format: `<surface name> — <introducing phase> — <deferred | not yet started | partial>`

- **Marketing landing page** — Phase 1 §5 lists `(marketing)/page.tsx` — **not yet started.** The `(marketing)` route group is empty; `/` is the Phase-1 design-system demo (`src/app/page.tsx`).
- **Playground chat surface** (streaming, citations sidebar, breathing-cursor, language switcher) — Phase 4 — **deferred.** `CLAUDE.md` §7a explicitly lists "Playground UI" as deferred to a later phase; today the route is a `<PlaceholderPage>`. The widget already exercises the streaming pipeline against the real brain end-to-end.
- **Voice-profile editor** (per-tenant tone / formality / signature phrases / avoid / fewShot) — Phase 4 / Phase 9 — **deferred.** Schema and defaults are wired (`voiceProfileSchema` in `src/lib/validators.ts`, brain consumes it in every reply); no edit surface exists. `CLAUDE.md` §7a notes "Sidebar voice-profile preset switcher" as part of the deferred Phase 4 partial — to be folded into the Phase 9 onboarding wizard.
- **5-minute onboarding wizard** (paste URL → live website-crawl visualization with animated graph nodes → review → connect first channel → particle-burst on completion) — Phase 9 — **partial.** Current onboarding is a single-step "name your workspace" form (`<CreateTenantCard>`); the wizard described in MASTER_PLAN §4.7 (theatrical moment #2) has not been started.
- **Stripe billing surface** (plan tiers, usage metering, billing portal, invoices, plan-limit enforcement) — Phase 9 — **not yet started.** `/billing` route is a `<PlaceholderPage>`, `src/server/billing/` is an empty directory, no Stripe SDK is in `package.json`.
- **Human-handoff / takeover UI** (agent can pause AI on a conversation and reply manually, in-app + email notifications, shared inbox) — Phase 8 — **not yet started.** Conversation detail is read-only with a "ReadOnlyBanner" lock; conversation list shows the "Escalated" status pill from Phase 8g's gap-logging changes but there is no agent-action workflow. `src/server/escalation/` is an empty directory. Members invite + role change UI is also flagged as Phase 8/9 in `<MembersList>`'s reserved slots.
- **Sentry / PostHog observability + accessibility & performance audit** — Phase 10 — **not yet started.** Neither SDK is in `package.json`; admin route renders three "Coming in Phase 10" cards.
- **Railway production deployment + custom domain + Stripe live mode** — Phase 10 — **not yet started.**
- **Live Data Sources connectors** (Odoo, Google Calendar, e-commerce order status) — Phase 8f / future — **deferred placeholder.** Route exists with "Coming soon" copy; "Type 4" of the five-types knowledge taxonomy is reserved but not implemented.
- **Stagger-in dashboard with animated number counters and charts** (theatrical moment #3) — implied Phase 2/3 — **not yet started.** The dashboard renders all-static cards with `"—"` placeholder values; no charts, no counters, no stagger.
- **Animated empty-state illustrations** (theatrical moment #7) — cross-cutting — **not yet started.** Empty states render lucide icons in muted circles; no SVG illustrations, no animation.
- **Customer detail / contacts surface (CRM-style)** — not in MASTER_PLAN §9 directly — **does not exist.** Schema has `Customer.name`, `phone`, `email`, `metadata` but no detail page or list view.

### Components / utilities mentioned in MASTER_PLAN or CLAUDE.md but not present in the codebase

The redesign described in this brief calls for **eyebrow section labels, KPI grid, right-rail timeline, and expandable detail rows.** None of these primitives exist. They will need to be introduced rather than re-skinned.

- **`Eyebrow` / `SectionLabel` primitive** — does not exist. The Phase-1 demo defines a local inline `SectionHeader` (`src/app/page.tsx`); the dashboard inlines `text-body-sm font-medium uppercase tracking-wider text-[var(--text-tertiary)]` for "Next steps" / "This week"; the channels page has no eyebrow. There's no shared component.
- **`PageHeader` primitive** — does not exist. Every page renders its own `<header>` block with `text-h1 text-[var(--text-primary)]` + an optional subtitle paragraph. Some pages add a back-link inline; some use `flex items-end justify-between` for a polling indicator badge. The pattern is consistent enough to abstract, but is not abstracted today.
- **`KpiCard` / `Stat` primitive** — does not exist. The dashboard's "This week" tiles are inlined in `src/app/(app)/[tenantSlug]/dashboard/page.tsx` (rounded-xl border bg-surface, caption label, h2 value). Values are hard-coded `"—"`. No real metrics anywhere.
- **`TimelineRail` / right-rail layout primitive** — does not exist. There is no two-pane layout with sidebar + main + right rail; current pages are single-column with `mx-auto max-w-{3xl,4xl,5xl}`.
- **Expandable / accordion / detail-row primitive** — does not exist. The closest existing pattern is the citation chip → inline preview in `<DashboardMessageBubble>`, which manages an open index manually with `useState<number | null>`. There is no Radix Collapsible or Accordion in use, no shared expandable row primitive.
- **Generic data-table primitive** — does not exist. Each table-shaped surface (knowledge sources, items, members) is hand-rolled HTML `<table>` or `<ul>`+rows. No virtualization, no sort, no pagination.
- **Dialog / Modal primitive** — does not exist as a shared component. Modals are inline (e.g. the Add-source modal in `<KnowledgeListClient>`) using `fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm`. There is no Radix Dialog wrapper.
- **Tabs primitive** — does not exist as a shared component. Settings tabs are bespoke; the Add-source modal's tabs are bespoke. `@radix-ui/react-tabs` is **not** in dependencies.
- **Tooltip primitive** — does not exist as a shared component. `@radix-ui/react-tooltip` **is** installed but not currently consumed anywhere (confirmed by grepping for the import). Some places use plain HTML `title="…"` for hovers.
- **Input / Textarea / Select / Checkbox / Switch / RadioGroup primitives** — none exist. Every form field is a hand-styled `<input>` / `<textarea>` / `<select>` against tokens (consistent class string repeated across forms). `@radix-ui/react-select`, `@radix-ui/react-checkbox`, `@radix-ui/react-switch` are not installed.
- **Badge primitive** — does not exist. `RoleBadge` is the only badge component (specific to Role); other "badges" are inline pills (status pills in `<ConversationsListClient>`, `<KnowledgeListClient>`, `<DashboardMessageBubble>` citation chips, etc.) repeating their own variant maps.
- **Skeleton primitive** — does not exist. Loading states are spinner icons + `pending` button states.
- **Toast / Sonner** — does not exist. Errors and successes are inline (per-form `state.message` rendered as a paragraph with `role="alert"`, or a transient "Saved" green badge after success).
- **Avatar primitive** — Radix `@radix-ui/react-avatar` is used directly inside `<MembersList>`. It is not wrapped in a shared `<Avatar>` component. The conversation list and workspace switcher render avatars by hand (not via Radix).

The redesign should expect to **introduce** the missing primitives (Eyebrow, PageHeader, KpiCard, TimelineRail, ExpandableRow, plus the Dialog/Tabs/Tooltip/Badge/Skeleton/Input shared layer) rather than re-skin them. The token system + `cn()` + `cva()` + Geist + lucide-react + `lib/motion` are already in place to support those additions cleanly.

---

## 13. Git state

```
$ git status --short
(clean — no output)

$ git log --oneline -20
e30c7ae feat(ai): Phase 4 P4r-7 — Sonnet 4.5 pin + Algerian Darija coaching
ca0e6e7 feat(ai): Phase 4 P4r-6 — brain-eval harness + [brain-cache-warn] log
eca91b7 feat(ai): Phase 4 P4r-5 — smart-import real wiring + cache-effectiveness probe finding
4625ba8 feat(ai): Phase 4 P4r-4 — schema probe + revert P4r-3 split + streaming + abort propagation
f1241b3 feat(ai): Phase 4 P4r-3 — prompt caching + tool-use schema split + log channel split + smart-import placeholder
35f7436 feat(ai): Phase 4 P4r-2 — RealClaudeClient.sendReply, retries, cost log, refusal fallback
c403a57 feat(ai): Phase 4 P4r-1 — RealClaudeClient foundation (pricing, config, errors, test isolation)
65825c5 feat(knowledge): Phase 8g — gap logging + clustering UI + freshness
b69dc22 feat(knowledge): Phase 8g-1 — gap embed + cluster-on-write worker
f15919c feat(knowledge): Phase 8f — Live Data Sources placeholder + Documents rename
25b6447 feat(knowledge): Phase 8e-3 — two-tier Q&A threshold + cross-language indicator
656430e feat(knowledge): Phase 8e — Q&A admin (list + CRUD + bulk delete)
31123b2 docs+refactor: codify server-only/lib split rule; lift QnaPair schemas
8d8708f feat(conversations): Phase 8c — citation kind badges
5b812e1 feat(knowledge): Phase 8c — smart import + CSV upload for items
02fa2bd feat(knowledge): Phase 8c — Items admin (list + CRUD + verify)
1139920 feat(ai): Phase 8c — typed knowledge in Block C with budget guards
f69eda5 feat(knowledge): Phase 8c — embed worker + retrieval for items/qna/tier-2 facts
940af64 feat(knowledge): Phase 8b — Business Info admin page (Operational Facts UI)
ab8dd69 feat(ai): Phase 8b — render tier-1 operational facts in Block B
```

Working tree is clean. There is no uncommitted WBP-onboarding work in flight despite the prior session's mention of a freshly-created `wbp` tenant — that work was only a database row plus an investigation; no source files were modified or staged. The current branch is `main`.

---

End of report.





