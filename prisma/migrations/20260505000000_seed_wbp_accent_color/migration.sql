-- Seed WBP's accentColor to platform-orange. Phase 11-2: per-tenant theming
-- reads Tenant.accentColor (existing nullable column) and emits a scoped
-- override; this migration makes WBP the first tenant to opt in.
--
-- Idempotent: only writes when the column is currently NULL, so re-running
-- after manual operator edits doesn't clobber them. A no-op when the wbp
-- slug doesn't exist (e.g. on a fresh deploy that never seeded wbp).
UPDATE "Tenant"
SET "accentColor" = '#ea580c'
WHERE "slug" = 'wbp' AND "accentColor" IS NULL;
