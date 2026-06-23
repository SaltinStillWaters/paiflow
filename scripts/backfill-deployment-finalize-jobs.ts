/**
 * One-off backfill for existing SUBMITTED deployments.
 *
 * Creates a DeploymentFinalizeJob for every deployment currently in SUBMITTED
 * status so the new queue-based finalization cron can clean them up if they
 * time out. Run once after deploying the new schema and the
 * process-deployment-finalize-jobs cron.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/backfill-deployment-finalize-jobs.ts
 */

import { PrismaClient } from "@prisma/client";
import { scheduleDeploymentFinalizeJob } from "@/lib/deployment-jobs";

const db = new PrismaClient();

async function main() {
  const deployments = await db.deployment.findMany({
    where: { status: "SUBMITTED" },
  });

  let scheduled = 0;
  let skipped = 0;

  for (const deployment of deployments) {
    const submittedAt = deployment.submittedAt ?? deployment.createdAt;
    const result = await scheduleDeploymentFinalizeJob(db, deployment.id, submittedAt);

    if (result) {
      console.log(
        `Scheduled job ${result.id} for deployment ${deployment.id} at ${result.runAt.toISOString()}`,
      );
      scheduled++;
    } else {
      console.log(`Skipped scheduling for deployment ${deployment.id} (already scheduled)`);
      skipped++;
    }
  }

  console.log(`\nDone. Scheduled: ${scheduled}, skipped: ${skipped}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
