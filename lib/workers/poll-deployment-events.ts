import "server-only";
import { Worker, type Job } from "bullmq";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { env } from "@/lib/env";
import { pollEventsFor } from "@/lib/stellar/events";
import { createWorkerRedisConnection, POLL_DEPLOYMENT_EVENTS_QUEUE } from "@/lib/queue";
import { schedulePoll } from "@/lib/queue-utils";

export const BACKOFF_STEPS = [10, 30, 60, 300] as const;

export function computeNextBackoff(currentSeconds: number, eventsFound: number) {
  if (eventsFound > 0) {
    return { delayMs: 5000, backoffSeconds: BACKOFF_STEPS[0] };
  }

  const nextIndex = BACKOFF_STEPS.findIndex((s) => s > currentSeconds);
  const backoffSeconds =
    nextIndex === -1 ? BACKOFF_STEPS[BACKOFF_STEPS.length - 1] : BACKOFF_STEPS[nextIndex];

  return { delayMs: currentSeconds * 1000, backoffSeconds };
}

async function processPollJob(job: Job) {
  const { deploymentId } = job.data as { deploymentId: string };

  log.info({ deploymentId, jobId: job.id }, "Worker polling deployment events");

  try {
    const state = await db.pollState.findUnique({ where: { deploymentId } });
    const currentBackoff = state?.backoffSeconds ?? BACKOFF_STEPS[0];

    const written = await pollEventsFor(deploymentId);

    const { delayMs, backoffSeconds } = computeNextBackoff(currentBackoff, written);

    await db.pollState.upsert({
      where: { deploymentId },
      update: {
        backoffSeconds,
        lastPolledAt: new Date(),
        ...(written > 0 ? { lastEventsFoundAt: new Date() } : {}),
      },
      create: {
        deploymentId,
        backoffSeconds,
        lastPolledAt: new Date(),
        ...(written > 0 ? { lastEventsFoundAt: new Date() } : {}),
      },
    });

    await schedulePoll(deploymentId, delayMs);

    log.info(
      { deploymentId, written, backoffSeconds, nextDelayMs: delayMs },
      "Worker finished polling deployment events",
    );

    return { written, backoffSeconds, nextDelayMs: delayMs };
  } catch (err) {
    log.error({ err, deploymentId, jobId: job.id }, "Worker polling failed");
    // Schedule a retry at the minimum backoff so a transient error does not
    // stall the deployment indefinitely, then let this job complete.
    await schedulePoll(deploymentId, BACKOFF_STEPS[0] * 1000);
  }
}

export function createPollDeploymentEventsWorker(): Worker | null {
  const conn = createWorkerRedisConnection();
  if (!conn) {
    log.warn("Cannot create poll-deployment-events worker: no Redis connection");
    return null;
  }

  return new Worker(POLL_DEPLOYMENT_EVENTS_QUEUE, processPollJob, {
    connection: conn,
    concurrency: env().EVENT_QUEUE_CONCURRENCY,
    autorun: false,
  });
}
