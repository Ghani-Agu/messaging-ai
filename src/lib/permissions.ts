import type { Role } from "@prisma/client";

/**
 * Page-permission slugs. Two halves per page: `:view` gates whether the
 * sidebar shows the link and whether the page-route loader allows the
 * request through; `:edit` gates the mutating Server Actions on that
 * page. New pages added later append to this list.
 *
 * Keep slugs lowercase + kebab-cased. New entries must also be added to
 * the relevant role preset(s) below AND to the migration's backfill
 * CASE expressions (20260511003438_invitations_and_member_permissions).
 */
export const PERMISSION_SLUGS = [
  "dashboard:view",
  "conversations:view",
  "conversations:edit",
  "documents:view",
  "documents:edit",
  "products:view",
  "products:edit",
  "qna:view",
  "qna:edit",
  "business-info:view",
  "business-info:edit",
  "live-data:view",
  "live-data:edit",
  "knowledge-gaps:view",
  "knowledge-gaps:edit",
  "channels:view",
  "channels:edit",
  "playground:view",
  "settings:view",
  "settings:edit",
  "contacts:view",
  "contacts:edit",
  "members:view",
  "members:edit",
] as const;

export type PermissionSlug = (typeof PERMISSION_SLUGS)[number];

const PERMISSION_SLUG_SET: ReadonlySet<string> = new Set(PERMISSION_SLUGS);

/**
 * Type guard so a `string` lookup (e.g., persisted permission slugs from
 * the DB) can be narrowed to PermissionSlug for membership checks.
 */
export function isPermissionSlug(value: string): value is PermissionSlug {
  return PERMISSION_SLUG_SET.has(value);
}

/**
 * Role presets — what a member of each role gets by default at invite
 * time. Admins can customize per-member afterward.
 *
 * - OWNER:  everything. requireTenantContext short-circuits OWNER on any
 *           requiredPermission check; this list is for display only.
 * - ADMIN:  everything except `members:edit` (we want one OWNER-floor so
 *           multi-admin orgs don't accidentally remove the OWNER).
 * - AGENT:  conversations + view-only on knowledge surfaces + playground.
 * - VIEWER: read-only across every page they can see.
 */
export const ROLE_PRESETS: Record<Role, readonly PermissionSlug[]> = {
  OWNER: [...PERMISSION_SLUGS],
  ADMIN: PERMISSION_SLUGS.filter((p) => p !== "members:edit"),
  AGENT: [
    "dashboard:view",
    "conversations:view",
    "conversations:edit",
    "products:view",
    "qna:view",
    "business-info:view",
    "knowledge-gaps:view",
    "playground:view",
    "contacts:view",
  ],
  VIEWER: [
    "dashboard:view",
    "conversations:view",
    "products:view",
    "qna:view",
    "business-info:view",
    "knowledge-gaps:view",
    "playground:view",
    "contacts:view",
  ],
};

/**
 * Pure check against an already-resolved permission list. Use this in UI
 * code that already has the user's permissions in hand (sidebar render,
 * conditional buttons). Server-side trust boundary checks should go
 * through requireTenantContext({ requiredPermission }) instead.
 */
export function hasPermission(
  userPermissions: readonly string[],
  required: PermissionSlug,
): boolean {
  return userPermissions.includes(required);
}

/**
 * Resolve a member's effective permission list. OWNER gets everything
 * regardless of what's persisted (defense-in-depth — even if a row's
 * permission array got corrupted, an OWNER can still recover). Non-OWNER
 * gets the stored list filtered down to known slugs (so a deleted slug
 * doesn't keep granting access from old rows).
 */
export function getEffectivePermissions(args: {
  role: Role;
  permissions: readonly string[];
}): PermissionSlug[] {
  if (args.role === "OWNER") return [...PERMISSION_SLUGS];
  return args.permissions.filter(isPermissionSlug);
}

/**
 * UX grouping for the invite / edit modal. Permissions are flat in the
 * DB but operators read them by surface (e.g. "Knowledge" with six
 * checkboxes vs "Workspace" with four). Edit grouping here updates the
 * modal in lockstep.
 */
export type PermissionGroup = {
  label: string;
  slugs: readonly PermissionSlug[];
};

export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    label: "Conversations",
    slugs: ["conversations:view", "conversations:edit"],
  },
  {
    label: "Knowledge",
    slugs: [
      "products:view",
      "products:edit",
      "documents:view",
      "documents:edit",
      "qna:view",
      "qna:edit",
      "business-info:view",
      "business-info:edit",
      "live-data:view",
      "live-data:edit",
      "knowledge-gaps:view",
      "knowledge-gaps:edit",
    ],
  },
  {
    label: "Channels & Playground",
    slugs: ["channels:view", "channels:edit", "playground:view"],
  },
  {
    label: "Contacts",
    slugs: ["contacts:view", "contacts:edit"],
  },
  {
    label: "Workspace",
    slugs: [
      "dashboard:view",
      "settings:view",
      "settings:edit",
      "members:view",
      "members:edit",
    ],
  },
];

/**
 * Pretty label for an individual permission slug, used in the modal
 * checkbox list. Keeps the slug as the authoritative key and the label
 * cosmetic only.
 */
const PERMISSION_LABELS: Record<PermissionSlug, string> = {
  "dashboard:view": "View dashboard",
  "conversations:view": "View conversations",
  "conversations:edit": "Reply / take over conversations",
  "documents:view": "View documents",
  "documents:edit": "Manage documents",
  "products:view": "View products",
  "products:edit": "Manage products",
  "qna:view": "View Q&A",
  "qna:edit": "Manage Q&A",
  "business-info:view": "View business info",
  "business-info:edit": "Edit business info",
  "live-data:view": "View live-data sources",
  "live-data:edit": "Manage live-data sources",
  "knowledge-gaps:view": "View knowledge gaps",
  "knowledge-gaps:edit": "Resolve knowledge gaps",
  "channels:view": "View channels",
  "channels:edit": "Connect / disconnect channels",
  "playground:view": "Use the AI playground",
  "settings:view": "View workspace settings",
  "settings:edit": "Edit workspace settings",
  "contacts:view": "View contacts",
  "contacts:edit": "Manage contacts",
  "members:view": "View members",
  "members:edit": "Invite / manage members",
};

export function labelForPermission(slug: PermissionSlug): string {
  return PERMISSION_LABELS[slug];
}
