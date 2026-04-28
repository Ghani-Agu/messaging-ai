/**
 * Thrown by updateWidgetConfig / rotateWidgetKey when the tenant has no
 * WIDGET channel yet — the UI is expected to call enableWidgetChannel
 * first. Surfaces as a user-facing error in the form's `formMessage`
 * rather than a 500. Lives outside actions.ts because "use server" files
 * cannot export non-async values (classes, constants).
 */
export class NotEnabledError extends Error {
  constructor() {
    super("Widget channel is not enabled for this workspace yet.");
    this.name = "NotEnabledError";
  }
}
