-- CreateEnum
CREATE TYPE "DeploymentFinalizeJobStatus" AS ENUM ('PENDING', 'RUNNING', 'FINALIZED', 'SKIPPED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EmailNotificationStatus" AS ENUM ('PENDING', 'RUNNING', 'SENT', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Deployment" ADD COLUMN "submittedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DeploymentFinalizeJob" (
    "id" UUID NOT NULL,
    "deploymentId" UUID NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL,
    "status" "DeploymentFinalizeJobStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeploymentFinalizeJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeploymentFinalizeJob_status_runAt_idx" ON "DeploymentFinalizeJob"("status", "runAt");

-- CreateIndex
CREATE INDEX "DeploymentFinalizeJob_deploymentId_status_idx" ON "DeploymentFinalizeJob"("deploymentId", "status");

-- AddForeignKey
ALTER TABLE "DeploymentFinalizeJob" ADD CONSTRAINT "DeploymentFinalizeJob_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing SUBMITTED deployments with a submittedAt timestamp.
UPDATE "Deployment" SET "submittedAt" = "createdAt" WHERE "status" = 'SUBMITTED' AND "submittedAt" IS NULL;

-- Backfill existing EmailNotification string statuses to the new enum values.
UPDATE "EmailNotification" SET "status" = 'SENT' WHERE "status" = 'sent';
UPDATE "EmailNotification" SET "status" = 'FAILED' WHERE "status" = 'failed';

-- AlterTable
ALTER TABLE "EmailNotification" DROP COLUMN "error",
ADD COLUMN "deploymentId" UUID,
ADD COLUMN "subject" TEXT,
ADD COLUMN "html" TEXT,
ADD COLUMN "text" TEXT,
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastError" TEXT,
ADD COLUMN "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill deploymentId from the related ContractEvent so the foreign key is valid.
UPDATE "EmailNotification" e
SET "deploymentId" = ce."deploymentId"
FROM "ContractEvent" ce
WHERE e."contractEventId" = ce."id" AND e."deploymentId" IS NULL;

-- AlterTable: make deploymentId non-nullable now that it is backfilled.
ALTER TABLE "EmailNotification" ALTER COLUMN "deploymentId" SET NOT NULL;

-- AlterTable
ALTER TABLE "EmailNotification" ALTER COLUMN "status" TYPE "EmailNotificationStatus" USING "status"::"EmailNotificationStatus";

-- Backfill runAt for existing rows so they are not reprocessed.
UPDATE "EmailNotification" SET "runAt" = COALESCE("sentAt", "createdAt") WHERE "runAt" = CURRENT_TIMESTAMP;

-- AddForeignKey
ALTER TABLE "EmailNotification" ADD CONSTRAINT "EmailNotification_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "EmailNotification_status_runAt_idx" ON "EmailNotification"("status", "runAt");

-- CreateIndex
CREATE INDEX "EmailNotification_deploymentId_idx" ON "EmailNotification"("deploymentId");
