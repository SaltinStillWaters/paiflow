import { PrismaClient, EmailNotificationStatus } from "@prisma/client";

const TERMINAL_STATUSES: EmailNotificationStatus[] = [
  EmailNotificationStatus.SENT,
  EmailNotificationStatus.FAILED,
  EmailNotificationStatus.CANCELLED,
];

/**
 * How long a RUNNING email job can stay unupdated before we assume the previous
 * cron invocation crashed or was killed. After this timeout the cron handler
 * resets the job back to PENDING so it can be retried.
 */
export const STALE_RUNNING_EMAIL_JOB_TIMEOUT_MS = 10 * 60 * 1_000;

export type ScheduleEmailNotificationInput = {
  deploymentId: string;
  contractEventId: string;
  nodeId: string;
  address: string;
  recipient: string;
  subject: string;
  html: string;
  text: string;
};

/**
 * Schedule an email notification job if one does not already exist for the same
 * event, node, and recipient address. Idempotent on the unique key.
 */
export async function scheduleEmailNotification(
  prisma: PrismaClient,
  input: ScheduleEmailNotificationInput,
): Promise<{ id: string; runAt: Date } | null> {
  const existing = await prisma.emailNotification.findUnique({
    where: {
      contractEventId_nodeId_address: {
        contractEventId: input.contractEventId,
        nodeId: input.nodeId,
        address: input.address,
      },
    },
  });

  if (existing) {
    return { id: existing.id, runAt: existing.runAt };
  }

  const job = await prisma.emailNotification.create({
    data: {
      deploymentId: input.deploymentId,
      contractEventId: input.contractEventId,
      nodeId: input.nodeId,
      address: input.address,
      recipient: input.recipient,
      subject: input.subject,
      html: input.html,
      text: input.text,
      status: EmailNotificationStatus.PENDING,
      runAt: new Date(),
    },
  });

  return { id: job.id, runAt: job.runAt };
}

/**
 * Return pending email notification jobs that are due, oldest first.
 */
export async function getDueEmailNotifications(prisma: PrismaClient, limit = 50) {
  return prisma.emailNotification.findMany({
    where: {
      status: EmailNotificationStatus.PENDING,
      runAt: { lte: new Date() },
    },
    orderBy: { runAt: "asc" },
    take: limit,
  });
}

/**
 * Reschedule or update an existing email notification job.
 */
export async function rescheduleEmailJob(
  prisma: PrismaClient,
  jobId: string,
  updates: {
    runAt?: Date | null;
    status: EmailNotificationStatus;
    lastError?: string | null;
    sentAt?: Date | null;
  },
) {
  const data: Record<string, unknown> = { status: updates.status };
  if (updates.runAt !== undefined) data.runAt = updates.runAt;
  if (updates.lastError !== undefined) data.lastError = updates.lastError;
  if (updates.sentAt !== undefined) data.sentAt = updates.sentAt;

  return prisma.emailNotification.update({
    where: { id: jobId },
    data,
  });
}

/**
 * Cancel all active email notification jobs for a deployment.
 */
export async function cancelPendingEmailJobs(
  prisma: PrismaClient,
  deploymentId: string,
): Promise<number> {
  const result = await prisma.emailNotification.updateMany({
    where: {
      deploymentId,
      status: {
        in: [EmailNotificationStatus.PENDING, EmailNotificationStatus.RUNNING],
      },
    },
    data: {
      status: EmailNotificationStatus.CANCELLED,
      lastError: "Deployment is no longer active",
    },
  });

  return result.count;
}

/**
 * Reset RUNNING email jobs that have not been updated recently back to PENDING.
 * This recovers from cron crashes, pod kills, or timeouts that occurred after a
 * job was marked RUNNING but before it reached a terminal state.
 */
export async function resetStaleRunningEmailJobs(
  prisma: PrismaClient,
  staleBefore: Date = new Date(Date.now() - STALE_RUNNING_EMAIL_JOB_TIMEOUT_MS),
): Promise<number> {
  const result = await prisma.emailNotification.updateMany({
    where: {
      status: EmailNotificationStatus.RUNNING,
      updatedAt: { lt: staleBefore },
    },
    data: {
      status: EmailNotificationStatus.PENDING,
      lastError: "Reset from stale RUNNING state",
    },
  });

  return result.count;
}
