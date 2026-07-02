-- Add a nullable unique idempotency key on Deployment so retries of
-- POST /api/deployments/dev-payroll do not double-deploy contracts.
ALTER TABLE "Deployment" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "Deployment_idempotencyKey_key" ON "Deployment"("idempotencyKey");
