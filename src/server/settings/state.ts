// Initial state + types for the AI Behavior form action. Lives outside
// actions.ts because Next.js requires "use server" files to export only
// async functions — no constants, no plain objects. Importing from here
// is safe from both client and server modules.

export type UpdateAiBehaviorState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; message: string };

export const updateAiBehaviorInitialState: UpdateAiBehaviorState = {
  status: "idle",
};
