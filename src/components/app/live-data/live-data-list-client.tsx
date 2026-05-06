"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import type { LiveDataSource } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { ConnectOdooModal } from "./connect-odoo-modal";
import { LiveDataEmptyState } from "./empty-state";
import { LiveDataSourceCard } from "./source-card";

/**
 * Client-side composition for /knowledge/live-data. Owns modal-open
 * state and the create/edit toggle. Delegates per-source actions
 * (sync now / disconnect) to the source-card; modal save → router
 * refresh so the server component re-fetches the list.
 */
export function LiveDataListClient({
  tenantSlug,
  tenantName,
  sources,
  canEdit,
}: {
  tenantSlug: string;
  tenantName: string;
  sources: LiveDataSource[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<LiveDataSource | null>(null);

  const handleSaved = () => {
    setCreateOpen(false);
    setEditing(null);
    router.refresh();
  };

  return (
    <PageShell width="5xl">
      <PageHeader
        eyebrow={<Eyebrow>{tenantName}</Eyebrow>}
        title="Live Data Sources"
        description="Auto-sync your product catalog from Odoo. Synced products live alongside manual ones, and the AI uses both when answering customers."
        actions={
          canEdit && sources.length > 0 ? (
            <Button onClick={() => setCreateOpen(true)} size="md">
              <Plus className="size-4" aria-hidden />
              Connect Odoo
            </Button>
          ) : null
        }
      />

      {sources.length === 0 ? (
        <LiveDataEmptyState
          canConnect={canEdit}
          onConnectOdoo={() => setCreateOpen(true)}
        />
      ) : (
        <div className="space-y-4">
          {sources.map((source) => (
            <LiveDataSourceCard
              key={source.id}
              source={source}
              canEdit={canEdit}
              tenantSlug={tenantSlug}
              onEdit={setEditing}
            />
          ))}
        </div>
      )}

      <ConnectOdooModal
        tenantSlug={tenantSlug}
        mode={{ kind: "create" }}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={handleSaved}
      />
      {editing ? (
        <ConnectOdooModal
          tenantSlug={tenantSlug}
          mode={{ kind: "edit", source: editing }}
          open={true}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      ) : null}
    </PageShell>
  );
}
