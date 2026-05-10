import {
  BookOpen,
  Building2,
  HelpCircle,
  MessageSquareText,
  Package,
  Phone,
  type LucideIcon,
} from "lucide-react";

/**
 * Citation-kind metadata + resolution helpers shared by playground-citations.tsx.
 *
 * Split off from the component so node-environment unit tests can verify the
 * kind→icon/label resolution without pulling framer-motion or JSX through
 * the import graph. The component owns the rendering; this file owns the
 * lookup tables and the unknown-kind fallback.
 *
 * The wire shape (sent by /api/playground/messages and /api/widget/messages)
 * mirrors the server-side BrainCitation discriminated union, flattened with
 * `kind` carried as a string. New kinds may land on the server before this
 * file is updated — when that happens, the fallback keeps the UI from
 * crashing rather than throwing on a missing icon lookup.
 */

export type CitationKind =
  | "chunk"
  | "item"
  | "qna"
  | "operational_fact"
  | "contact";

const KIND_ICON: Record<CitationKind, LucideIcon> = {
  chunk: BookOpen,
  item: Package,
  qna: MessageSquareText,
  operational_fact: Building2,
  contact: Phone,
};

const KIND_LABEL: Record<CitationKind, string> = {
  chunk: "Source",
  item: "Product",
  qna: "Q&A",
  operational_fact: "Fact",
  contact: "Contact",
};

const FALLBACK_ICON: LucideIcon = HelpCircle;
const FALLBACK_LABEL = "Citation";

function isKnownKind(kind: unknown): kind is CitationKind {
  return typeof kind === "string" && kind in KIND_ICON;
}

export function iconForKind(kind: string | null | undefined): LucideIcon {
  return isKnownKind(kind) ? KIND_ICON[kind] : FALLBACK_ICON;
}

export function labelForKind(kind: string | null | undefined): string {
  return isKnownKind(kind) ? KIND_LABEL[kind] : FALLBACK_LABEL;
}
