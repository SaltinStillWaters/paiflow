-- Store a hash of the request payload alongside the idempotency key so a
-- reused key with different parameters is rejected instead of returning a
-- mismatched deployment.
ALTER TABLE "Deployment" ADD COLUMN "idempotencyPayload" TEXT;
