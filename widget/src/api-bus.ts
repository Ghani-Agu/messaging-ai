/**
 * Tiny pub-sub bus connecting the widget's public window.MessagingAI API
 * (defined in main.ts) to the Widget component (defined in Widget.tsx).
 * Module-scope listener registry — intentionally NOT EventTarget; this
 * avoids the DOMException semantics of dispatchEvent and keeps the
 * surface small enough to inline in any test.
 *
 * Single direction: external code dispatches actions; Widget subscribes
 * inside useEffect and dispatches reducer actions in response. No reverse
 * channel from Widget to host — if we ever need that, add a second bus.
 */

export type BusAction =
  | { type: "open" }
  | { type: "close" }
  | { type: "toggle" }
  | { type: "identify"; user: { name?: string; email?: string; phone?: string } };

type Listener = (action: BusAction) => void;

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function dispatch(action: BusAction): void {
  for (const listener of listeners) listener(action);
}

/** Test affordance — production code never calls this. */
export function __resetForTests(): void {
  listeners.clear();
}
