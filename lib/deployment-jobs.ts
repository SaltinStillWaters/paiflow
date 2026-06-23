import { PrismaClient, DeploymentFinalizeJobStatus } from "@prisma/client";

const TERMINAL_STATUSES: DeploymentFinalizeJobStatus[] = [
  DeploymentFinalizeJobStatus.FINALIZED,
  DeploymentFinalizeJobStatus.SKIPPED,
  DeploymentFinalizeJobStatus.FAILED,
  DeploymentFinalizeJobStatus.CANCELLED,
];

const FINALIZE_TIMEOUT_MS = 5 * 60 * 1_000;

/**
 * Schedule a deployment finalization job if one is not already active for the
 * deployment. The job runs after the submission timeout has elapsed and marks
 * stale SUBMITTED deployments as FAILED.
 */
export async function scheduleDeploymentFinalizeJob(
  prisma: PrismaClient,
  deploymentId: string,
  submittedAt: Date,
): Promise<{ id: string; runAt: Date } | null> {
  const existing = await prisma.deploymentFinalizeJob.findFirst({
    where: {
      deploymentId,
      status: { notIn: TERMINAL_STATUSES },
    },
  });

  if (existing) {
    return { id: existing.id, runAt: existing.runAt };
  }

  const runAt = new Date(submittedAt.getTime() + FINALIZE_TIMEOUT_MS);

  const job = await prisma.deploymentFinalizeJob.create({
    data: {
      deploymentId,
      runAt,
      status: DeploymentFinalizeJobStatus.PENDING,
    },
  });

  return { id: job.id, runAt: job.runAt };
}

/**
 * Return pending finalization jobs that are due, oldest first.
 */
export async function getDueDeploymentFinalizeJobs(prisma: PrismaClient, limit = 50) {
  return prisma.deploymentFinalizeJob.findMany({
    where: {
      status: DeploymentFinalizeJobStatus.PENDING,
      runAt: { lte: new Date() },
    },
    orderBy: { runAt: "asc" },
    take: limit,
  });
}

/**
 * Reschedule or update an existing finalization job.
 */
export async function rescheduleDeploymentFinalizeJob(
  prisma: PrismaClient,
  jobId: string,
  updates: {
    runAt?: Date | null;
    status: DeploymentFinalizeJobStatus;
    lastError?: string | null;
  },
) {
  const data: Record<string, unknown> = { status: updates.status };
  if (updates.runAt !== undefined) data.runAt = updates.runAt;
  if (updates.lastError !== undefined) data.lastError = updates.lastError;

  return prisma.deploymentFinalizeJob.update({
    where: { id: jobId },
    data,
  });
}

/**
 * Cancel all active finalization jobs for a deployment. Called when a deployment
 * is no longer SUBMITTED.
 */
export async function cancelPendingDeploymentFinalizeJobs(
  prisma: PrismaClient,
  deploymentId: string,
): Promise<number> {
  const result = await prisma.deploymentFinalizeJob.updateMany({
    where: {
      deploymentId,
      status: {
        in: [DeploymentFinalizeJobStatus.PENDING, DeploymentFinalizeJobStatus.RUNNING],
      },
    },
    data: {
      status: DeploymentFinalizeJobStatus.CANCELLED,
      lastError: "Deployment is no longer SUBMITTED",
    },
  });

  return result.count;
}
