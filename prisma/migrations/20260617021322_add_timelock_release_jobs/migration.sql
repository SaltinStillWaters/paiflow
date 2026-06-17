-- CreateEnum
CREATE TYPE "TimelockReleaseJobStatus" AS ENUM ('PENDING', 'RUNNING', 'RELEASED', 'SKIPPED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "TimelockReleaseJob" (
    "id" UUID NOT NULL,
    "deploymentId" UUID NOT NULL,
    "nodeId" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL,
    "status" "TimelockReleaseJobStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimelockReleaseJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimelockReleaseJob_status_runAt_idx" ON "TimelockReleaseJob"("status", "runAt");

-- CreateIndex
CREATE INDEX "TimelockReleaseJob_deploymentId_nodeId_status_idx" ON "TimelockReleaseJob"("deploymentId", "nodeId", "status");

-- CreateIndex
CREATE INDEX "TimelockReleaseJob_contractAddress_status_idx" ON "TimelockReleaseJob"("contractAddress", "status");

-- AddForeignKey
ALTER TABLE "TimelockReleaseJob" ADD CONSTRAINT "TimelockReleaseJob_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
