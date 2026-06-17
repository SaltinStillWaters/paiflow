import { PrismaClient, TimelockReleaseJobStatus } from "@prisma/client";
import type { TimelockNodeParams } from "@/lib/flows/to-params";

export type TimelockJobParams = Pick<TimelockNodeParams, "unlockTime" | "mode">;

const TERMINAL_STATUSES: TimelockReleaseJobStatus[] = [
  TimelockReleaseJobStatus.RELEASED,
  TimelockReleaseJobStatus.SKIPPED,
  TimelockReleaseJobStatus.FAILED,
  TimelockReleaseJobStatus.CANCELLED,
];

const BEFORE_MODE_BUFFER_MS = 60_000;

/**
 * How long a RUNNING job can stay unupdated before we assume the previous cron
 * invocation crashed or was killed. After this timeout the cron handler resets
 * the job back to PENDING so it can be retried.
 */
export const STALE_RUNNING_JOB_TIMEOUT_MS = 10 * 60 * 1_000;

/**
 * Compute the initial runAt for a timelock release job.
 *
 * - After mode: release at or after unlockTime. If unlockTime is already in the
 *   past, run immediately.
 * - Before mode: release before unlockTime. Schedule one minute before the
 *   deadline, but never in the past, so we still attempt if the deadline is
 *   very close.
 */
export function computeTimelockRunAt(
  unlockTime: number,
  mode: "after" | "before",
  fromDate: Date = new Date(),
): Date {
  const unlockDate = new Date(unlockTime * 1000);

  if (mode === "before") {
    const target = new Date(unlockDate.getTime() - BEFORE_MODE_BUFFER_MS);
    return target > fromDate ? target : fromDate;
  }

  return unlockDate > fromDate ? unlockDate : fromDate;
}

/**
 * Schedule a timelock release job if one is not already pending or running for
 * the same deployment/node. Returns the existing active job if present.
 */
export async function scheduleTimelockReleaseJob(
  prisma: PrismaClient,
  deploymentId: string,
  nodeId: string,
  contractAddress: string,
  params: TimelockJobParams,
  fromDate: Date = new Date(),
): Promise<{ id: string; runAt: Date } | null> {
  const existing = await prisma.timelockReleaseJob.findFirst({
    where: {
      deploymentId,
      nodeId,
      status: { notIn: TERMINAL_STATUSES },
    },
  });

  if (existing) {
    return { id: existing.id, runAt: existing.runAt };
  }

  const runAt = computeTimelockRunAt(params.unlockTime, params.mode, fromDate);

  const job = await prisma.timelockReleaseJob.create({
    data: {
      deploymentId,
      nodeId,
      contractAddress,
      runAt,
      status: TimelockReleaseJobStatus.PENDING,
    },
  });

  return { id: job.id, runAt: job.runAt };
}

/**
 * Reschedule or update an existing job.
 */
export async function rescheduleTimelockJob(
  prisma: PrismaClient,
  jobId: string,
  updates: {
    runAt?: Date | null;
    status: TimelockReleaseJobStatus;
    lastError?: string | null;
    releasedAt?: Date | null;
  },
) {
  const data: Record<string, unknown> = { status: updates.status };
  if (updates.runAt !== undefined) data.runAt = updates.runAt;
  if (updates.lastError !== undefined) data.lastError = updates.lastError;
  if (updates.releasedAt !== undefined) data.releasedAt = updates.releasedAt;

  return prisma.timelockReleaseJob.update({
    where: { id: jobId },
    data,
  });
}

/**
 * Return pending timelock jobs that are due, oldest first.
 */
export async function getDueTimelockJobs(prisma: PrismaClient, limit = 50) {
  return prisma.timelockReleaseJob.findMany({
    where: {
      status: TimelockReleaseJobStatus.PENDING,
      runAt: { lte: new Date() },
    },
    orderBy: { runAt: "asc" },
    take: limit,
  });
}

/**
 * Cancel all active jobs for a deployment. Called when a deployment is no
 * longer CONFIRMED or is being archived.
 */
export async function cancelPendingTimelockJobs(
  prisma: PrismaClient,
  deploymentId: string,
): Promise<number> {
  const result = await prisma.timelockReleaseJob.updateMany({
    where: {
      deploymentId,
      status: {
        in: [TimelockReleaseJobStatus.PENDING, TimelockReleaseJobStatus.RUNNING],
      },
    },
    data: {
      status: TimelockReleaseJobStatus.CANCELLED,
      lastError: "Deployment is no longer CONFIRMED",
    },
  });

  return result.count;
}

/**
 * Reset RUNNING jobs that have not been updated recently back to PENDING. This
 * recovers from cron crashes, pod kills, or timeouts that occurred after a job
 * was marked RUNNING but before it reached a terminal state.
 */
export async function resetStaleRunningTimelockJobs(
  prisma: PrismaClient,
  staleBefore: Date = new Date(Date.now() - STALE_RUNNING_JOB_TIMEOUT_MS),
): Promise<number> {
  const result = await prisma.timelockReleaseJob.updateMany({
    where: {
      status: TimelockReleaseJobStatus.RUNNING,
      updatedAt: { lt: staleBefore },
    },
    data: {
      status: TimelockReleaseJobStatus.PENDING,
      lastError: "Reset from stale RUNNING state",
    },
  });

  return result.count;
}
