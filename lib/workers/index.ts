import "server-only";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { getQueue, closeQueue } from "@/lib/queue";
import { schedulePoll, POLL_JOB_ID } from "@/lib/queue-utils";
import { createPollDeploymentEventsWorker } from "./poll-deployment-events";

let worker: ReturnType<typeof createPollDeploymentEventsWorker> | null = null;
let workersStarted = false;

async function seedInitialPollJobs(): Promise<void> {
  const queue = getQueue();
  if (!queue) return;

  const confirmed = await db.deployment.findMany({
    where: { status: "CONFIRMED" },
    select: { id: true },
  });

  let seeded = 0;
  for (const d of confirmed) {
    const existing = await queue.getJob(POLL_JOB_ID(d.id));
    if (!existing) {
      await schedulePoll(d.id, 5000, true);
      seeded += 1;
    }
  }

  log.info({ totalConfirmed: confirmed.length, seeded }, "Seeded initial deployment poll jobs");
}

export async function startWorkers(): Promise<boolean> {
  if (workersStarted) return true;
  workersStarted = true;

  const queue = getQueue();
  if (!queue) {
    log.info("Event queue is disabled; workers not started");
    return false;
  }

  worker = createPollDeploymentEventsWorker();
  if (!worker) {
    log.warn("Failed to create poll-deployment-events worker");
    return false;
  }

  await seedInitialPollJobs();
  await worker.run();
  log.info("Started poll-deployment-events worker");
  return true;
}

export async function stopWorkers(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  await closeQueue();
  workersStarted = false;
  log.info("Stopped poll-deployment-events worker");
}
