// Initial state + types for tenancy server actions. Lives outside actions.ts
// because Next.js requires "use server" files to export only async functions —
// no constants, no plain objects. Importing from here is safe from both
// client and server modules; types are erased and the constants are inert.

export type CreateTenantState =
  | { status: "idle" }
  | { status: "error"; field?: "name" | "slug" | "form"; message: string };

export const createTenantInitialState: CreateTenantState = { status: "idle" };

export type UpdateTenantState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; field?: "name"; message: string };

export const updateTenantInitialState: UpdateTenantState = { status: "idle" };
