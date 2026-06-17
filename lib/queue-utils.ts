import "server-only";
import { db } from "@/lib/db";
import { getQueue } from "@/lib/queue";
import { log } from "@/lib/log";

export const POLL_JOB_NAME = "poll";
export const POLL_JOB_ID = (deploymentId: string) => `poll:${deploymentId}`;

const DEFAULT_BACKOFF_SECONDS = 10;

/**
 * Schedules (or reschedules) a per-deployment event-polling job.
 *
 * Uses a stable BullMQ jobId so duplicate jobs for the same deployment are
 * automatically collapsed. When `resetBackoff` is true, the deployment's
 * PollState backoff is reset to the minimum so the worker climbs the backoff
 * ladder from the start again.
 */
export async function schedulePoll(
  deploymentId: string,
  delayMs: number,
  resetBackoff = false,
): Promise<void> {
  const queue = getQueue();
  if (!queue) return;

  if (resetBackoff) {
    await db.pollState
      .upsert({
        where: { deploymentId },
        update: { backoffSeconds: DEFAULT_BACKOFF_SECONDS },
        create: { deploymentId, backoffSeconds: DEFAULT_BACKOFF_SECONDS },
      })
      .catch((err) => {
        log.warn({ err, deploymentId }, "Failed to reset poll backoff state");
      });
  }

  try {
    await queue.add(
      POLL_JOB_NAME,
      { deploymentId },
      {
        delay: Math.max(0, Math.round(delayMs)),
        jobId: POLL_JOB_ID(deploymentId),
      },
    );
    log.info({ deploymentId, delayMs, resetBackoff }, "Scheduled deployment event poll");
  } catch (err) {
    log.warn({ err, deploymentId, delayMs }, "Failed to schedule deployment event poll");
  }
}

/**
 * Removes any pending poll jobs for a deployment. Useful when a deployment is
 * no longer CONFIRMED.
 */
export async function removePollJobs(deploymentId: string): Promise<void> {
  const queue = getQueue();
  if (!queue) return;

  try {
    const job = await queue.getJob(POLL_JOB_ID(deploymentId));
    if (job) {
      await job.remove();
      log.info({ deploymentId }, "Removed pending deployment event poll");
    }
  } catch (err) {
    log.warn({ err, deploymentId }, "Failed to remove pending deployment event poll");
  }
}
