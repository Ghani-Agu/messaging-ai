/**
 * Per-tenant brand-asset manifest.
 *
 * Convention: a tenant's logo lives at `public/<slug>.png` and is served
 * at `/<slug>.png`. Logos are NOT looked up via filesystem stat at request
 * time — that would require server-only code on a hot path. Instead, the
 * project lead opts a tenant in here when they drop the asset in `public/`.
 *
 * Future work (Phase 9 / multi-tenant logo upload): replace this manual
 * manifest with a DB-backed `Tenant.logoUrl` lookup. For now, the manual
 * Record-in-source pattern is acceptable — every new tenant is operator
 * lead-onboarded so a manifest update is part of the onboarding checklist.
 *
 * Look up via `getTenantBrand(slug)`. Unknown slugs → `{ hasLogo: false }`,
 * and the consuming UI falls back to the gradient-square + initial.
 */

export type TenantBrand = {
  /** Whether `public/<slug>.png` exists. When true, the operator-app
   *  brand block renders an <Image> at `/<slug>.png`; otherwise, the
   *  gradient-square + initial fallback. */
  hasLogo: boolean;
};

const TENANT_BRANDS: Record<string, TenantBrand> = {
  wbp: { hasLogo: true },
};

const DEFAULT_BRAND: TenantBrand = { hasLogo: false };

export function getTenantBrand(slug: string): TenantBrand {
  return TENANT_BRANDS[slug] ?? DEFAULT_BRAND;
}
