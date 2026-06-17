import "server-only";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { getQueue, closeQueue } from "@/lib/queue";
import { schedulePoll, POLL_JOB_ID } from "@/lib/queue-utils";
import { createPollDeploymentEventsWorker } from "./poll-deployment-events";

let worker: ReturnType<typeof createPollDeploymentEventsWorker> | null = null;
let workersStarted = false;

const SEED_JOB_CHECK_BATCH_SIZE = 50;
const SEED_SCHEDULE_CONCURRENCY = 10;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function workerFn(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]!);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => workerFn()));
  return results;
}

async function seedInitialPollJobs(): Promise<void> {
  const queue = getQueue();
  if (!queue) return;

  const confirmed = await db.deployment.findMany({
    where: { status: "CONFIRMED" },
    select: { id: true },
  });

  // Check for existing jobs in batches to avoid serial Redis round-trips.
  const existing = new Set<string>();
  for (let i = 0; i < confirmed.length; i += SEED_JOB_CHECK_BATCH_SIZE) {
    const batch = confirmed.slice(i, i + SEED_JOB_CHECK_BATCH_SIZE);
    const jobs = await Promise.all(batch.map((d) => queue.getJob(POLL_JOB_ID(d.id))));
    batch.forEach((d, idx) => {
      if (jobs[idx]) existing.add(d.id);
    });
  }

  // Schedule missing jobs with a concurrency cap to avoid overwhelming Redis/DB.
  const missing = confirmed.filter((d) => !existing.has(d.id));
  const scheduled = await mapWithConcurrency(missing, SEED_SCHEDULE_CONCURRENCY, async (d) => {
    await schedulePoll(d.id, 5000, true);
    return d.id;
  });

  log.info(
    { totalConfirmed: confirmed.length, seeded: scheduled.length },
    "Seeded initial deployment poll jobs",
  );
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
