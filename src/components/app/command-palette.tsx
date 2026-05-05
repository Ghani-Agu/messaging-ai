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

  // Listen for the trigger event from the sidebar button + global hotkey.
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
      // Submit the workspace-switch action via a synthetic form so the same
      // server-side path runs (lastUsedTenantId update + redirect).
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

  // ---------- Item catalog ----------
  const navigationItems: ItemSpec[] = [
    {
      id: "nav:dashboard",
      label: "Dashboard",
      icon: LayoutDashboard,
      perform: () => navigate(`/${tenantSlug}/dashboard`),
    },
    {
      id: "nav:conversations",
      label: "Conversations",
      icon: MessageSquare,
      perform: () => navigate(`/${tenantSlug}/conversations`),
    },
    {
      id: "nav:knowledge",
      label: "Knowledge",
      icon: BookOpen,
      perform: () => navigate(`/${tenantSlug}/knowledge`),
    },
    {
      id: "nav:channels",
      label: "Channels",
      icon: Plug,
      perform: () => navigate(`/${tenantSlug}/channels`),
    },
    {
      id: "nav:playground",
      label: "Playground",
      icon: Sparkles,
      perform: () => navigate(`/${tenantSlug}/playground`),
    },
    {
      id: "nav:settings",
      label: "Settings",
      icon: Settings,
      perform: () => navigate(`/${tenantSlug}/settings/general`),
    },
    {
      id: "nav:billing",
      label: "Billing",
      icon: CreditCard,
      perform: () => navigate(`/${tenantSlug}/billing`),
    },
  ];

  const themeItems: ItemSpec[] = [
    {
      id: "theme:light",
      label: "Light theme",
      icon: Sun,
      hint: theme === "light" ? "Active" : undefined,
      perform: () => {
        switchTheme("light");
        close();
      },
      keywords: ["theme", "appearance"],
    },
    {
      id: "theme:dark",
      label: "Dark theme",
      icon: Moon,
      hint: theme === "dark" ? "Active" : undefined,
      perform: () => {
        switchTheme("dark");
        close();
      },
      keywords: ["theme", "appearance"],
    },
    {
      id: "theme:system",
      label: "Match system theme",
      icon: Laptop,
      hint: theme === "system" ? "Active" : undefined,
      perform: () => {
        switchTheme("system");
        close();
      },
      keywords: ["theme", "auto", "appearance"],
    },
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
    {
      id: "workspace:create",
      label: "Create workspace",
      icon: Plus,
      perform: () => navigate("/onboarding/create-tenant?intent=add"),
      keywords: ["workspace", "new"],
    },
  ];

  const accountItems: ItemSpec[] = [
    ...(user.isSuperAdmin
      ? [
          {
            id: "account:admin",
            label: "Open admin",
            icon: Shield,
            perform: () => navigate("/admin"),
            keywords: ["admin", "super"],
          } satisfies ItemSpec,
        ]
      : []),
    {
      id: "account:signout",
      label: "Sign out",
      icon: LogOut,
      perform: signOut,
      keywords: ["logout", "log out"],
    },
  ];

  const allItems: ItemSpec[] = [
    ...navigationItems,
    ...themeItems,
    ...workspaceItems,
    ...accountItems,
  ];
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

              <Command.List className="custom-scrollbar max-h-[420px] overflow-y-auto p-1.5">
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
                  {navigationItems.map((it) => (
                    <PaletteItem key={it.id} item={it} onRun={runItem} />
                  ))}
                </PaletteGroup>

                <PaletteGroup heading="Theme">
                  {themeItems.map((it) => (
                    <PaletteItem key={it.id} item={it} onRun={runItem} />
                  ))}
                </PaletteGroup>

                <PaletteGroup heading="Workspace">
                  {workspaceItems.map((it) => (
                    <PaletteItem key={it.id} item={it} onRun={runItem} />
                  ))}
                </PaletteGroup>

                <PaletteGroup heading="Account">
                  {accountItems.map((it) => (
                    <PaletteItem key={it.id} item={it} onRun={runItem} />
                  ))}
                </PaletteGroup>
              </Command.List>

              <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-4 py-2 text-caption text-[var(--text-tertiary)]">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1">
                    <Kbd>↑</Kbd>
                    <Kbd>↓</Kbd>
                    Navigate
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Kbd>↵</Kbd>
                    Select
                  </span>
                </div>
                <span className="inline-flex items-center gap-1">
                  <Kbd>⌘</Kbd>
                  <Kbd>K</Kbd>
                  Open anywhere
                </span>
              </div>

              {/* Hidden ref kept for potential future imperative use. */}
              <form ref={formContainerRef} className="hidden" />
            </Command>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function PaletteGroup({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <Command.Group
      heading={heading}
      className="px-1 pb-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--text-tertiary)]"
    >
      {children}
    </Command.Group>
  );
}

function PaletteItem({
  item,
  onRun,
}: {
  item: ItemSpec;
  onRun: (item: ItemSpec) => void;
}) {
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
