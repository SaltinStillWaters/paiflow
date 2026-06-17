-- CreateTable
CREATE TABLE "PollState" (
    "deploymentId" UUID NOT NULL,
    "backoffSeconds" INTEGER NOT NULL DEFAULT 10,
    "lastPolledAt" TIMESTAMP(3),
    "lastEventsFoundAt" TIMESTAMP(3),

    CONSTRAINT "PollState_pkey" PRIMARY KEY ("deploymentId")
);

-- CreateIndex
CREATE INDEX "PollState_backoffSeconds_idx" ON "PollState"("backoffSeconds");

-- CreateIndex
CREATE INDEX "PollState_lastPolledAt_idx" ON "PollState"("lastPolledAt");

-- AddForeignKey
ALTER TABLE "PollState" ADD CONSTRAINT "PollState_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
