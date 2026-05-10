-- Commit B (employee invitations): adds Invitation + InvitationStatus enum,
-- a TenantUser.permissions text-array column, and backfills the column for
-- every existing TenantUser row from the role-preset table defined in
-- src/lib/permissions.ts. The backfill CASE expressions duplicate the
-- preset arrays from that file deliberately — the seed only runs once, and
-- carrying the lists in SQL keeps the migration self-contained.

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED');

-- AlterTable: TenantUser gains the per-member permissions array.
ALTER TABLE "TenantUser" ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Backfill existing rows from role presets. OWNER's list is informational
-- (requireTenantContext short-circuits OWNER), but we still populate it for
-- display consistency in the Members UI.
UPDATE "TenantUser"
   SET "permissions" = CASE "role"
     WHEN 'OWNER'  THEN ARRAY[
       'dashboard:view',
       'conversations:view','conversations:edit',
       'documents:view','documents:edit',
       'products:view','products:edit',
       'qna:view','qna:edit',
       'business-info:view','business-info:edit',
       'live-data:view','live-data:edit',
       'knowledge-gaps:view','knowledge-gaps:edit',
       'channels:view','channels:edit',
       'playground:view',
       'settings:view','settings:edit',
       'contacts:view','contacts:edit',
       'members:view','members:edit'
     ]::TEXT[]
     WHEN 'ADMIN'  THEN ARRAY[
       'dashboard:view',
       'conversations:view','conversations:edit',
       'documents:view','documents:edit',
       'products:view','products:edit',
       'qna:view','qna:edit',
       'business-info:view','business-info:edit',
       'live-data:view','live-data:edit',
       'knowledge-gaps:view','knowledge-gaps:edit',
       'channels:view','channels:edit',
       'playground:view',
       'settings:view','settings:edit',
       'contacts:view','contacts:edit',
       'members:view'
     ]::TEXT[]
     WHEN 'AGENT'  THEN ARRAY[
       'dashboard:view',
       'conversations:view','conversations:edit',
       'products:view',
       'qna:view',
       'business-info:view',
       'knowledge-gaps:view',
       'playground:view',
       'contacts:view'
     ]::TEXT[]
     WHEN 'VIEWER' THEN ARRAY[
       'dashboard:view',
       'conversations:view',
       'products:view',
       'qna:view',
       'business-info:view',
       'knowledge-gaps:view',
       'playground:view',
       'contacts:view'
     ]::TEXT[]
   END;

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "name" TEXT,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");

-- CreateIndex
CREATE INDEX "Invitation_tenantId_status_idx" ON "Invitation"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Invitation_email_tenantId_idx" ON "Invitation"("email", "tenantId");

-- CreateIndex
CREATE INDEX "Invitation_expiresAt_idx" ON "Invitation"("expiresAt");

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedBy_fkey" FOREIGN KEY ("invitedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
