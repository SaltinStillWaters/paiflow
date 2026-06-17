/**
 * One-off backfill script for issue #204.
 *
 * Creates an initial TimelockReleaseJob for every TIMELOCK node in every
 * CONFIRMED deployment. Run this once after deploying the new schema and the
 * process-timelock-jobs cron.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/backfill-timelock-release-jobs.ts
 */

import { PrismaClient } from "@prisma/client";
import { scheduleTimelockReleaseJob } from "@/lib/timelock-jobs";
import type { TimelockNodeParams } from "@/lib/flows/to-params";

const db = new PrismaClient();

type PipelineSnapshotEntry = {
  nodeId: string;
  contractAddress: string;
  templateKind: string;
};

type ParamsSnapshotEntry = {
  nodeId: string;
  templateKind: string;
  params: { kind: string } | TimelockNodeParams;
};

async function main() {
  const deployments = await db.deployment.findMany({
    where: { status: "CONFIRMED" },
  });

  let scheduled = 0;
  let skipped = 0;

  for (const deployment of deployments) {
    const pipeline = (deployment.pipelineSnapshot as PipelineSnapshotEntry[] | null) ?? [];
    const paramsArr = (deployment.paramsSnapshot as ParamsSnapshotEntry[] | null) ?? [];

    for (const node of paramsArr) {
      if (node.templateKind !== "TIMELOCK" || node.params.kind !== "timelock") {
        continue;
      }

      const pipelineNode = pipeline.find((p) => p.nodeId === node.nodeId);
      if (!pipelineNode?.contractAddress) {
        console.warn(
          `Missing contract address for timelock ${node.nodeId} in deployment ${deployment.id}`,
        );
        skipped++;
        continue;
      }

      const result = await scheduleTimelockReleaseJob(
        db,
        deployment.id,
        node.nodeId,
        pipelineNode.contractAddress,
        node.params as TimelockNodeParams,
      );

      if (result) {
        console.log(
          `Scheduled job ${result.id} for deployment ${deployment.id} / ${node.nodeId} at ${result.runAt.toISOString()}`,
        );
        scheduled++;
      } else {
        console.log(
          `Skipped scheduling for deployment ${deployment.id} / ${node.nodeId} (already scheduled)`,
        );
        skipped++;
      }
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
